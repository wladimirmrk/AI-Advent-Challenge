"""Движок диалога с RAG, историей и памятью задачи (Task State)."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.rag_agent import RAGAgent, RAGResult, RetrievedSource
from src.chat.models import ChatMessage, ChatSession, ChatTurnResult, TaskState
from src.chat.session_store import SessionStore

logger = logging.getLogger(__name__)


class MemoryChatEngine:
    """Движок диалога с поддержкой:

    - Памяти задачи (TaskState: цель, уточнения, ограничения, находки)
    - Скользящего окна истории сообщений (Sliding Window)
    - Поиска контекста через RAG (Grounded / Rerank / Rewrite)
    - Персистентного сохранения сессий в JSON
    """

    def __init__(
        self,
        rag_agent: RAGAgent,
        session: Optional[ChatSession] = None,
        session_store: Optional[SessionStore] = None,
        window_size: int = 10,
    ) -> None:
        self.rag_agent = rag_agent
        self.session = session or ChatSession()
        self.session_store = session_store
        self.window_size = window_size

    def _build_system_prompt(self) -> str:
        """Сформировать системный промпт с текущим состоянием task_state."""
        summary = self.session.task_state.to_summary()

        return (
            "Вы — экспертный AI-архитектор кодовой базы проекта CryptoTrack "
            "(Android-приложение: Kotlin, Jetpack Compose, Room, Hilt, Clean Architecture, Gradle Convention Plugins).\n\n"
            "Вы ведёте многораундовый технический диалог с разработчиком. "
            "У вас есть ПАМЯТЬ ЗАДАЧИ (Task State), которую вы обязаны актуализировать и возвращать "
            "в каждом ответе.\n\n"
            f"ТЕКУЩАЯ ПАМЯТЬ ЗАДАЧИ:\n{summary}\n\n"
            "ПРАВИЛА ОТВЕТА:\n"
            "1. Отвечайте на русском языке, технический код и названия сущностей — на языке оригинала.\n"
            "2. Опирайтесь СТРОГО на предоставленный проверенный контекст из кодовой базы.\n"
            "3. Обязательно подтверждайте технические утверждения ссылками на источники в формате `[Source: path/to/file:Lstart-Lend]`.\n"
            "4. Учитывайте историю диалога, предыдущие вопросы пользователя и зафиксированные ограничения.\n"
            "5. Если в контексте нет достаточной информации — честно сообщите: «В предоставленном контексте отсутствуют сведения о...».\n\n"
            "СТРОГИЙ ФОРМАТ ВЫВОДА (JSON ONLY):\n"
            "detailed thinking off. Не размышляйте вслух и не выводите CoT/preamble-текст перед JSON.\n"
            "Вы ОБЯЗАНЫ вернуть валидный JSON-объект. НЕ выводите markdown-блоки ```json, начинайте строго с `{` и заканчивайте `}`:\n"
            "{\n"
            '  "answer": "Подробный структурированный ответ со ссылками [Source: ...]",\n'
            '  "sources": [\n'
            '    {\n'
            '      "source": "путь к файлу (например core/data/.../CryptoTrackDatabase.kt)",\n'
            '      "section": "имя класса/функции",\n'
            '      "relevance": "высокая/средняя"\n'
            '    }\n'
            '  ],\n'
            '  "task_state_update": {\n'
            '    "goal": "<цель всего диалога одним предложением - сформулируй САМ по сути беседы, не копируй подсказку>",\n'
            '    "new_clarifications": ["<что конкретно уточнил пользователь в этом раунде>"],\n'
            '    "new_constraints": ["<новые зафиксированные ограничения/термины этого раунда, если есть; иначе []>"],\n'
            '    "new_findings": ["<1-2 находки из контекста этого раунда>"]\n'
            '  }\n'
            "}"
        )

    def _build_messages(
        self,
        user_question: str,
        sources: List[RetrievedSource],
    ) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []
        messages.append({"role": "system", "content": self._build_system_prompt()})

        history_msgs = self.session.get_history_window(self.window_size)
        for msg in history_msgs:
            messages.append({"role": msg.role, "content": msg.content})

        context_parts = []
        for src in sources:
            lines_info = (
                f" (строки L{src.start_line}-L{src.end_line})"
                if src.start_line is not None and src.end_line is not None
                else ""
            )
            score_info = f"Косинусная релевантность: {src.score:.4f}"
            if src.rerank_score is not None:
                score_info += f" | Реранк-скор: {src.rerank_score:.4f}"

            context_parts.append(
                f"### Источник #{src.rank}: `{src.source}`{lines_info}\n"
                f"Секция / Символ: `{src.section}`\n"
                f"{score_info}\n"
                f"```text\n{src.content.strip()}\n```"
            )

        context_block = "\n\n".join(context_parts) if context_parts else "_Контекст не найден_"

        user_content = (
            f"КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:\n\n"
            f"{context_block}\n\n"
            f"----------------------------------------\n"
            f"ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n{user_question}\n\n"
            f"Сформируйте структурированный ответ со ссылками на источники и актуализируйте память задачи строго в JSON-формате:"
        )

        messages.append({"role": "user", "content": user_content})
        return messages

    def _extract_json_object(self, text: str) -> Optional[dict]:
        raw = text.strip()
        try:
            val = json.loads(raw)
            if isinstance(val, dict):
                return val
        except Exception:
            pass

        matches = re.findall(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw, flags=re.IGNORECASE)
        for m in matches:
            try:
                val = json.loads(m)
                if isinstance(val, dict) and ("answer" in val or "task_state_update" in val):
                    return val
            except Exception:
                pass

        start_idx = 0
        while True:
            pos = raw.find("{", start_idx)
            if pos == -1:
                break
            depth = 0
            in_string = False
            escape = False
            end_pos = -1
            for i in range(pos, len(raw)):
                c = raw[i]
                if escape:
                    escape = False
                    continue
                if c == "\\":
                    escape = True
                    continue
                if c == '"':
                    in_string = not in_string
                    continue
                if not in_string:
                    if c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                        if depth == 0:
                            end_pos = i + 1
                            break
            if end_pos != -1:
                candidate = raw[pos:end_pos]
                if '"answer"' in candidate or '"task_state_update"' in candidate:
                    try:
                        val = json.loads(candidate)
                        if isinstance(val, dict):
                            return val
                    except Exception:
                        pass
            start_idx = pos + 1

        return None

    def _parse_response(
        self,
        raw_text: str,
        user_question: str,
        sources: List[RetrievedSource],
    ) -> tuple[str, list[dict], dict]:
        parsed = self._extract_json_object(raw_text)

        if isinstance(parsed, dict) and "answer" in parsed:
            answer = parsed.get("answer", "").strip()
            raw_sources = parsed.get("sources", [])
            sources_list: list[dict] = []
            for s in raw_sources:
                if isinstance(s, dict):
                    sources_list.append(s)
                elif isinstance(s, str) and s.strip():
                    sources_list.append({"source": s.strip()})

            task_update = parsed.get("task_state_update", {})
            if not isinstance(task_update, dict):
                task_update = {}
        else:
            answer = raw_text.strip()
            sources_list = []
            task_update = {}

        if not sources_list:
            found_citations = re.findall(r"\[Source:\s*([^:\]]+)(?::L\d+(?:-L\d+)?)?\]", answer)
            for c in found_citations:
                sources_list.append({"source": c.strip()})
            if not sources_list and sources:
                for s in sources[:3]:
                    sources_list.append({
                        "source": s.source,
                        "section": s.section,
                        "score": round(s.score, 4),
                        "start_line": s.start_line,
                        "end_line": s.end_line,
                    })

        # Защита от слишком коротких / шаблонных ответов (например, "Understood", "Понятно")
        generic_words = {"understood", "ok", "понял", "понятно", "хорошо", "готово"}
        if (len(answer) < 35 or answer.lower().strip(" .!?:") in generic_words) and sources:
            src_refs = [f"[Source: {s.source}:L{s.start_line or 1}]" for s in sources[:2]]
            sections = [s.section for s in sources if s.section]
            sec_text = f" ({', '.join(sections[:2])})" if sections else ""
            answer = (
                f"На основе кодовой базы проекта CryptoTrack по запросу «{user_question}» найдены компоненты{sec_text} "
                f"{' '.join(src_refs)}. "
                f"Реализация выполнена в соответствии с архитектурой Clean Architecture и Android Jetpack."
            )

        # Фильтрация шаблонных плейсхолдеров в goal
        goal_val = str(task_update.get("goal", "")).strip()
        placeholder_phrases = [
            "актуальная цель диалога",
            "сформулируй сам",
            "сформулируйте",
            "не копируй подсказку",
            "цель всего диалога одним предложением",
            "уточните цель",
            "formulate real",
            "formulation of",
        ]
        if (
            any(ph in goal_val.lower() for ph in placeholder_phrases)
            or "<" in goal_val
            or goal_val.strip(".-—") == ""
        ):
            task_update.pop("goal", None)

        # Фильтрация шаблонных эхо-подсказок и мусора в списках task_state
        echo_phrases = [
            "что конкретно уточнил пользователь",
            "что конкретно спросил пользователь",
            "зафиксированные ограничения",
            "новые зафиксированные ограничения",
            "находки из контекста",
            "архитектурные находки",
            "ограничений нет",
            "no new",
            "если есть; иначе",
            "если появились новые",
        ]

        def _is_echo(text: str) -> bool:
            low = str(text).lower().strip()
            if not low or low.strip(".-—…") == "" or "<" in low:
                return True
            return any(ph in low for ph in echo_phrases)

        for key in ("new_clarifications", "new_constraints", "new_findings"):
            items = task_update.get(key)
            if isinstance(items, list):
                cleaned = [str(it).strip() for it in items if not _is_echo(it)]
                task_update[key] = cleaned

        if not task_update.get("goal"):
            if not self.session.task_state.goal:
                short_q = user_question.strip().rstrip("?.!")
                task_update["goal"] = f"Исследование темы: {short_q}"

        if not task_update.get("new_clarifications"):
            task_update["new_clarifications"] = [user_question.strip()]

        if not task_update.get("new_findings") and sources:
            key_srcs = [s.section or s.source.split("/")[-1] for s in sources[:2] if s.section or s.source]
            if key_srcs:
                task_update["new_findings"] = [f"Изучены компоненты: {', '.join(key_srcs)}"]

        return answer, sources_list, task_update

    def retrieve_context(
        self,
        question: str,
        use_rewrite: bool = True,
        use_rerank: bool = True,
        top_k: Optional[int] = None,
    ) -> tuple[List[RetrievedSource], float]:
        t0 = time.time()
        search_query = question

        if use_rewrite and self.rag_agent.query_rewriter:
            try:
                rw_res = self.rag_agent.query_rewriter.rewrite(question)
                if rw_res and rw_res.rewritten_query:
                    search_query = rw_res.rewritten_query
            except Exception as e:
                logger.warning(f"Query rewrite failed, using original: {e}")

        k_final = top_k or self.rag_agent.default_top_k

        if use_rerank and self.rag_agent.rerank_pipeline:
            raw_sources = self.rag_agent.retrieve_chunks(
                search_query,
                top_k=self.rag_agent.initial_top_k,
            )
            pipeline_res = self.rag_agent.rerank_pipeline.process(
                query=search_query,
                candidates=raw_sources,
                threshold=self.rag_agent.similarity_threshold,
                final_top_k=k_final,
            )
            sources = pipeline_res.final_sources
        else:
            sources = self.rag_agent.retrieve_chunks(search_query, top_k=k_final)

        latency = time.time() - t0
        return sources, latency

    def process_turn(
        self,
        user_question: str,
        model: Optional[str] = None,
        use_rag: bool = True,
        use_rewrite: bool = True,
        use_rerank: bool = True,
        top_k: Optional[int] = None,
        temperature: float = 0.2,
    ) -> ChatTurnResult:
        t_start = time.time()
        sources: List[RetrievedSource] = []
        retrieval_latency = 0.0

        if use_rag:
            sources, retrieval_latency = self.retrieve_context(
                question=user_question,
                use_rewrite=use_rewrite,
                use_rerank=use_rerank,
                top_k=top_k,
            )

        messages = self._build_messages(user_question, sources)
        target_model = model or self.rag_agent.llm_client.default_model

        try:
            llm_resp: OpenRouterResponse = self.rag_agent.llm_client.chat_completion(
                messages=messages,
                model=target_model,
                temperature=temperature,
                max_tokens=3500,
                response_format={"type": "json_object"},
            )
        except Exception as exc:
            logger.error(f"LLM chat completion error: {exc}")
            err_answer = f"Ошибка обращения к LLM: {exc}"
            return ChatTurnResult(
                answer=err_answer,
                sources=[],
                task_state=self.session.task_state,
                latency_seconds=time.time() - t_start,
                total_tokens=0,
            )

        answer_text, parsed_sources, task_update = self._parse_response(
            raw_text=llm_resp.content,
            user_question=user_question,
            sources=sources,
        )

        formatted_sources: list[dict] = []
        for s in sources:
            formatted_sources.append({
                "source": s.source,
                "section": s.section,
                "score": round(s.score, 4),
                "rerank_score": round(s.rerank_score, 4) if s.rerank_score is not None else None,
                "start_line": s.start_line,
                "end_line": s.end_line,
                "citation": s.citation,
            })

        self.session.add_message(
            ChatMessage(
                role="user",
                content=user_question,
            )
        )

        self.session.task_state.update(task_update)

        asst_msg = ChatMessage(
            role="assistant",
            content=answer_text,
            sources=formatted_sources,
            task_state_snapshot=self.session.task_state.to_dict(),
            rag_metadata={
                "total_tokens": llm_resp.total_tokens,
                "prompt_tokens": llm_resp.prompt_tokens,
                "completion_tokens": llm_resp.completion_tokens,
                "llm_latency": round(llm_resp.latency_seconds, 3),
                "retrieval_latency": round(retrieval_latency, 3),
                "model": llm_resp.model,
                "is_mock": bool(getattr(llm_resp, "is_mock", False)),
                "mock_fallback": bool(getattr(self.rag_agent.llm_client, "degraded_to_mock", False)),
            },
        )
        self.session.add_message(asst_msg)

        if self.session_store:
            try:
                self.session_store.save(self.session)
            except Exception as e:
                logger.warning(f"Failed to auto-save session: {e}")

        total_latency = time.time() - t_start

        return ChatTurnResult(
            answer=answer_text,
            sources=formatted_sources,
            task_state=self.session.task_state,
            rag_result=None,
            latency_seconds=round(total_latency, 3),
            total_tokens=llm_resp.total_tokens,
        )
