import time
from dataclasses import dataclass, field
from typing import List, Optional

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.query_rewriter import QueryRewriter, QueryRewriteResult
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.grounding.models import (
    GroundedAnswer,
    GroundedCitation,
    GroundedQuote,
    GroundedSource,
)
from src.grounding.validator import GroundingValidator, ValidationResult
from src.reranking.pipeline import TwoStageRetrievalPipeline, PipelineResult
from src.storage.vector_store import SearchResult, VectorStore


@dataclass
class RetrievedSource:
    rank: int
    score: float
    source: str
    section: str
    start_line: Optional[int]
    end_line: Optional[int]
    content: str
    rerank_score: Optional[float] = None

    @property
    def citation(self) -> str:
        s_line = f":L{self.start_line}" if self.start_line is not None else ""
        e_line = f"-L{self.end_line}" if self.end_line is not None else ""
        return f"[Source: {self.source}{s_line}{e_line}]"


@dataclass
class RAGResult:
    question: str
    answer: str
    use_rag: bool
    sources: List[RetrievedSource] = field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_seconds: float = 0.0
    retrieval_latency: float = 0.0
    llm_latency: float = 0.0
    context_text: str = ""
    rewritten_query: Optional[str] = None
    rewrite_latency: float = 0.0
    rerank_latency: float = 0.0
    initial_sources_count: int = 0
    dropped_by_filter_count: int = 0
    pipeline_result: Optional[PipelineResult] = None
    grounded_answer: Optional[GroundedAnswer] = None


class RAGAgent:
    """Agent executing dual-mode (RAG vs No-RAG) questions against the CryptoTrack knowledge base."""

    def __init__(
        self,
        vector_store: VectorStore,
        embedder: OllamaEmbedder,
        llm_client: OpenRouterClient,
        default_top_k: int = 5,
        query_rewriter: Optional[QueryRewriter] = None,
        rerank_pipeline: Optional[TwoStageRetrievalPipeline] = None,
        initial_top_k: int = 15,
        similarity_threshold: float = 0.45,
        grounded_threshold: float = 0.58,
    ):
        self.vector_store = vector_store
        self.embedder = embedder
        self.llm_client = llm_client
        self.default_top_k = default_top_k
        self.query_rewriter = query_rewriter or QueryRewriter(llm_client=llm_client)
        self.rerank_pipeline = rerank_pipeline or TwoStageRetrievalPipeline(default_threshold=similarity_threshold)
        self.initial_top_k = initial_top_k
        self.similarity_threshold = similarity_threshold
        self.grounded_threshold = grounded_threshold

    def build_rag_prompt(self, question: str, sources: List[RetrievedSource]) -> List[dict]:
        """Construct system and user messages containing retrieved context chunks."""
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

        context_block = "\n\n".join(context_parts)

        system_instruction = (
            "Вы — экспертный AI-архитектор кодовой базы проекта CryptoTrack "
            "(Android-приложение: Kotlin, Jetpack Compose, Room, Hilt, Clean Architecture, Gradle Convention Plugins).\n\n"
            "Ваша задача — предоставить точный, конкретный и исчерпывающий ответ на вопрос пользователя, "
            "опираясь СТРОГО на предоставленный ниже проверенный контекст из кодовой базы.\n\n"
            "Правила ответа:\n"
            "1. Опирайтесь на предоставленный контекст. Называйте точные имена классов, методов, типов и пакетов, "
            "присутствующие в сниппетах.\n"
            "2. Обязательно подтверждайте утверждения ссылками на источники в формате `[Source: path/to/file:Lstart-Lend]`.\n"
            "3. Если в предоставленных фрагментах отсутствует требуемая информация, прямо и честно напишите: "
            "«В предоставленном контексте кодовой базы отсутствуют сведения о...» и укажите, чего именно не хватает, "
            "не придумывая детали реализации.\n"
            "4. Ответ должен быть на русском языке, технический код и названия сущностей — на языке оригинала."
        )

        user_content = (
            f"КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:\n\n"
            f"{context_block}\n\n"
            f"----------------------------------------\n"
            f"ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n{question}\n\n"
            f"Сформируйте структурированный ответ со ссылками на источники из контекста:"
        )

        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content},
        ]

    def build_grounded_rag_prompt(self, question: str, sources: List[RetrievedSource]) -> List[dict]:
        """Construct prompt enforcing structured JSON with answer, sources, exact quotes, and refusal rules."""
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

        context_block = "\n\n".join(context_parts)

        system_instruction = (
            "Вы — экспертный AI-архитектор кодовой базы проекта CryptoTrack "
            "(Android-приложение: Kotlin, Jetpack Compose, Room, Hilt, Clean Architecture, Gradle Convention Plugins).\n\n"
            "Ваша задача — предоставить точный и правдивый ответ на вопрос пользователя, "
            "опираясь СТРОГО на предоставленный проверенный контекст из кодовой базы.\n\n"
            "СТРОГИЕ ПРАВИЛА ВЫВОДА (JSON ONLY):\n"
            "Вы ОБЯЗАНЫ вернуть валидный JSON без лишнего форматирования и markdown-тегов вокруг, содержащий поля:\n"
            "{\n"
            '  "status": "grounded" или "refusal",\n'
            '  "answer": "Подробный ответ на русском языке...",\n'
            '  "sources": [\n'
            '    {\n'
            '      "source": "путь к файлу (например core/data/.../CryptoTrackDatabase.kt)",\n'
            '      "section": "имя класса/функции",\n'
            '      "chunk_id": "L10-L40"\n'
            '    }\n'
            '  ],\n'
            '  "quotes": [\n'
            '    "Точная ДОСЛОВНАЯ цитата (фрагмент текста из сниппета)...",\n'
            '    "Вторая точная ДОСЛОВНАЯ цитата..."\n'
            '  ],\n'
            '  "needs_clarification": false,\n'
            '  "clarification_prompt": null\n'
            "}\n\n"
            "ПРАВИЛО АНТИ-ГАЛЛЮЦИНАЦИЙ И ОТКАЗА:\n"
            "- Если в предоставленном контексте НЕТ достаточной информации для ответа на вопрос, "
            'или вопрос касается тем, отсутствующих в CryptoTrack (например, сторонние платежные шлюзы Apple Pay, ML-прогноз курсов, Solidity):\n'
            '  * Установите "status": "refusal", "needs_clarification": true.\n'
            '  * В поле "answer" прямо напишите: «В кодовой базе проекта CryptoTrack отсутствуют сведения о ... Не могу ответить на данный вопрос без домыслов.»\n'
            '  * В поле "clarification_prompt" вежливо попросите пользователя уточнить вопрос.\n'
            '  * Поля "sources" и "quotes" верните пустыми: [].\n\n'
            "ПРАВИЛО ЦИТИРОВАНИЯ:\n"
            "- Каждое ключевое утверждение ответа должно подтверждаться дословной цитатой в массиве `quotes`.\n"
            "- Запрещено выдумывать текст цитат: они обязаны быть фрагментами из переданного контекста.\n"
            "- В массиве `sources` укажите все использованные файлы."
        )

        user_content = (
            f"КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:\n\n"
            f"{context_block}\n\n"
            f"----------------------------------------\n"
            f"ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n{question}\n\n"
            f"Сформируйте ответ строго в указанном JSON-формате:"
        )

        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content},
        ]

    def _fallback_parse_markdown(
        self,
        raw_text: str,
        sources: List[RetrievedSource],
        model: str = "",
        cutoff_threshold: float = 0.58,
        top_score: float = 0.0,
    ) -> GroundedAnswer:
        """Fallback parser when LLM returns Markdown or plain text instead of raw JSON."""
        import re

        refusal_keywords = [
            "не знаю",
            "не найден",
            "отсутствуют сведения",
            "не содержит",
            "нет достаточной информации",
            "не нашел",
            "не удалось найти",
            "нет информации",
        ]
        is_refusal = any(kw in raw_text.lower() for kw in refusal_keywords)

        # Extract quotes: lines starting with '>' or enclosed in quotes
        quote_matches = re.findall(r"^>\s*(.+)$", raw_text, re.MULTILINE)
        if not quote_matches:
            # Try finding quoted strings
            quote_matches = re.findall(r'["«]([^"»\n]{15,})["»]', raw_text)

        quotes = [GroundedQuote(text=q.strip()) for q in quote_matches if q.strip()]

        # Extract sources from text or use retrieved sources
        found_sources = []
        source_paths = re.findall(r"\[Source:\s*([^:\]]+)(?::L\d+(?:-L\d+)?)?\]", raw_text)
        for sp in source_paths:
            found_sources.append(GroundedSource(source=sp.strip()))

        if not found_sources and not is_refusal:
            # Map top retrieved sources
            for s in sources[:3]:
                found_sources.append(
                    GroundedSource(
                        source=s.source,
                        section=s.section,
                        start_line=s.start_line,
                        end_line=s.end_line,
                        score=s.score,
                        rerank_score=s.rerank_score,
                        rank=s.rank,
                    )
                )

        status = "refusal" if is_refusal else "grounded"
        needs_clarification = is_refusal
        clarification = (
            "Пожалуйста, уточните интересующий вас компонент, класс или модуль кодовой базы CryptoTrack."
            if is_refusal else None
        )

        return GroundedAnswer(
            answer=raw_text.strip(),
            sources=found_sources,
            quotes=quotes,
            status=status,
            needs_clarification=needs_clarification,
            clarification_prompt=clarification,
            top_relevance_score=top_score,
            cutoff_threshold=cutoff_threshold,
            model=model,
            raw_response_text=raw_text,
        )

    def parse_grounded_response(
        self,
        raw_text: str,
        sources: List[RetrievedSource],
        model: str = "",
        cutoff_threshold: float = 0.58,
        top_score: float = 0.0,
    ) -> GroundedAnswer:
        """Parse structured JSON LLM output into a GroundedAnswer and execute GroundingValidator."""
        import json, re

        clean_text = raw_text.strip()
        if clean_text.startswith("```"):
            clean_text = re.sub(r"^```(?:json)?\s*", "", clean_text, flags=re.IGNORECASE)
            clean_text = re.sub(r"\s*```$", "", clean_text)
            clean_text = clean_text.strip()

        parsed = None
        try:
            parsed = json.loads(clean_text)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", clean_text)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                except Exception:
                    pass

        if isinstance(parsed, dict) and "answer" in parsed:
            raw_sources = parsed.get("sources", [])
            sources_list = []
            for s in raw_sources:
                if isinstance(s, dict):
                    sources_list.append(
                        GroundedSource(
                            source=s.get("source", ""),
                            section=s.get("section", ""),
                            chunk_id=s.get("chunk_id"),
                        )
                    )
                elif isinstance(s, str) and s.strip():
                    sources_list.append(GroundedSource(source=s.strip()))

            raw_quotes = parsed.get("quotes", [])
            quotes_list = []
            for q in raw_quotes:
                if isinstance(q, str) and q.strip():
                    quotes_list.append(GroundedQuote(text=q.strip()))
                elif isinstance(q, dict) and "text" in q:
                    quotes_list.append(
                        GroundedQuote(
                            text=q["text"].strip(),
                            source=q.get("source"),
                            section=q.get("section"),
                            chunk_id=q.get("chunk_id"),
                        )
                    )

            status = parsed.get("status", "grounded")
            needs_clarification = parsed.get("needs_clarification", False)
            clarification = parsed.get("clarification_prompt")

            refusal_kw = ["отсутствуют сведения", "не знаю", "не нашел", "нет информации", "не содержится"]
            if any(kw in parsed["answer"].lower() for kw in refusal_kw):
                status = "refusal"
                needs_clarification = True
                if not clarification:
                    clarification = "Пожалуйста, уточните интересующий вас компонент или модуль кодовой базы CryptoTrack."

            ans = GroundedAnswer(
                answer=parsed.get("answer", "").strip(),
                sources=sources_list,
                quotes=quotes_list,
                status=status,
                needs_clarification=needs_clarification,
                clarification_prompt=clarification,
                top_relevance_score=top_score,
                cutoff_threshold=cutoff_threshold,
                model=model,
                raw_response_text=raw_text,
            )
        else:
            ans = self._fallback_parse_markdown(raw_text, sources, model, cutoff_threshold, top_score)

        # Run verification and calculation of scores
        validator = GroundingValidator()
        validator.validate(ans, sources)
        return ans

    def build_no_rag_prompt(self, question: str) -> List[dict]:
        """Construct standard prompt without any codebase context."""
        system_instruction = (
            "Вы — полезный AI-ассистент по программированию и архитектуре Android-приложений.\n"
            "Ответьте на вопрос пользователя на основе ваших общих знаний об Android, Kotlin, Clean Architecture, "
            "Room, Jetpack Compose и Hilt.\n"
            "Если вопрос касается внутренней или приватной кодовой базы конкретного неизвестного проекта, "
            "отвечайте в меру своих общих предположений и общепринятых паттернов индустрии."
        )
        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": question},
        ]

    def retrieve_chunks(
        self,
        question: str,
        top_k: int,
        filter_source: Optional[str] = None,
    ) -> List[RetrievedSource]:
        """Retrieve most relevant chunks from the vector store with asymmetric query prefix and RRF fusion."""
        # 1. Primary semantic query with Nomic search_query prefix
        q_clean = question.strip()
        q_formatted = f"search_query: {q_clean}" if not q_clean.startswith("search_query:") else q_clean
        q_vec = self.embedder.embed_query(q_formatted)
        results1 = self.vector_store.search(q_vec, top_k=max(top_k * 2, 8), filter_source=filter_source)

        # 2. Secondary search for explicit technical/code identifiers if present
        import re
        latin_terms = [
            w for w in re.findall(r"[A-Za-z0-9_]{3,}", question)
            if w.lower() not in {"how", "the", "and", "for", "cryptotrack"}
        ]
        results2 = []
        if latin_terms:
            tech_q = f"search_query: {' '.join(latin_terms)}"
            tech_vec = self.embedder.embed_query(tech_q)
            results2 = self.vector_store.search(tech_vec, top_k=max(top_k * 2, 8), filter_source=filter_source)

        # 3. Reciprocal Rank Fusion (RRF) with production source and symbol awareness
        rrf_scores = {}
        chunk_map = {}
        is_test_query = any(w in question.lower() for w in ["test", "тест", "проверк", "mock", "фейк"])

        for rank, r in enumerate(results1, 1):
            cid = r.chunk.chunk_id
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.0 / (60.0 + rank))
            chunk_map[cid] = (r.chunk, r.score)

        for rank, r in enumerate(results2, 1):
            cid = r.chunk.chunk_id
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.5 / (60.0 + rank))
            if cid not in chunk_map:
                chunk_map[cid] = (r.chunk, r.score)

        # Apply source & symbol weighting
        weighted_scores = {}
        for cid, base_score in rrf_scores.items():
            chunk, _ = chunk_map[cid]
            multiplier = 1.0
            norm_source = chunk.source.replace("\\", "/")

            # Prefer production code over test fixtures unless query explicitly asks for tests
            if not is_test_query:
                if "/src/main/" in norm_source:
                    multiplier *= 1.25
                elif "/src/test/" in norm_source:
                    multiplier *= 0.70

            # Symbol match bonus: specific code identifiers matching file stem or section
            if latin_terms:
                from pathlib import Path
                stem = Path(chunk.source).stem.lower()
                symbol_score = 0.0
                for t in latin_terms:
                    t_low = t.lower()
                    if len(t) >= 4:
                        if t_low == stem:
                            symbol_score += 2.0
                        elif t_low in stem or t_low in chunk.section.lower():
                            symbol_score += 0.5 * (len(t) / 10.0)
                if symbol_score > 0:
                    multiplier *= (1.0 + symbol_score)

            weighted_scores[cid] = base_score * multiplier

        sorted_cids = sorted(weighted_scores.keys(), key=lambda cid: weighted_scores[cid], reverse=True)[:top_k]

        sources = []
        for idx, cid in enumerate(sorted_cids, 1):
            chunk, score = chunk_map[cid]
            sources.append(
                RetrievedSource(
                    rank=idx,
                    score=score,
                    source=chunk.source,
                    section=chunk.section,
                    start_line=chunk.metadata.get("start_line"),
                    end_line=chunk.metadata.get("end_line"),
                    content=chunk.content,
                )
            )
        return sources


    def query(
        self,
        question: str,
        use_rag: bool = True,
        use_rewrite: bool = False,
        use_rerank: bool = False,
        use_grounded: bool = False,
        top_k: Optional[int] = None,
        initial_top_k: Optional[int] = None,
        similarity_threshold: Optional[float] = None,
        grounded_threshold: Optional[float] = None,
        model: Optional[str] = None,
        filter_source: Optional[str] = None,
        temperature: float = 0.2,
    ) -> RAGResult:
        """Execute full pipeline: question -> optional rewrite -> retrieval -> optional filter & rerank -> prompt assembly -> LLM response -> optional grounding verification."""
        t_start = time.time()
        k_final = top_k or self.default_top_k
        sources: List[RetrievedSource] = []
        retrieval_latency = 0.0
        rewrite_latency = 0.0
        rerank_latency = 0.0
        context_text = ""
        rewritten_q = None
        pipeline_res = None
        initial_count = 0
        dropped_count = 0
        grounded_ans: Optional[GroundedAnswer] = None

        if use_rag:
            search_query = question
            # 1. Optional Query Rewrite
            if use_rewrite and self.query_rewriter:
                rw_res = self.query_rewriter.rewrite(question)
                rewritten_q = rw_res.rewritten_query
                search_query = rw_res.rewritten_query
                rewrite_latency = rw_res.latency_seconds

            # 2. Retrieval & optional Stage 2 reranking
            t_r0 = time.time()
            if use_rerank and self.rerank_pipeline:
                k_initial = initial_top_k or self.initial_top_k
                thresh = similarity_threshold if similarity_threshold is not None else self.similarity_threshold
                raw_sources = self.retrieve_chunks(search_query, top_k=k_initial, filter_source=filter_source)
                retrieval_latency = time.time() - t_r0

                pipeline_res = self.rerank_pipeline.process(
                    query=search_query,
                    candidates=raw_sources,
                    threshold=thresh,
                    final_top_k=k_final,
                )
                sources = pipeline_res.final_sources
                initial_count = pipeline_res.initial_count
                dropped_count = pipeline_res.dropped_by_filter
                rerank_latency = pipeline_res.total_latency
            else:
                sources = self.retrieve_chunks(search_query, top_k=k_final, filter_source=filter_source)
                retrieval_latency = time.time() - t_r0
                initial_count = len(sources)
                dropped_count = 0

            # Level 1 Anti-Hallucination Guard (Day 24)
            top_score = max([s.score for s in sources], default=0.0)
            g_thresh = grounded_threshold if grounded_threshold is not None else self.grounded_threshold

            if use_grounded and (not sources or top_score < g_thresh):
                refusal_answer = (
                    "В кодовой базе проекта CryptoTrack отсутствуют релевантные сведения для ответа на данный вопрос "
                    f"(наивысшая релевантность {top_score:.4f} ниже допустимого порога {g_thresh:.2f}). "
                    "Ассистент переведен в режим анти-галлюцинаций («не знаю»)."
                )
                clarification_p = (
                    "Пожалуйста, уточните ваш запрос: назовите конкретный класс, экран, модуль или сценарий Android-проекта CryptoTrack."
                )
                grounded_ans = GroundedAnswer(
                    answer=refusal_answer,
                    sources=[],
                    quotes=[],
                    status="refusal",
                    needs_clarification=True,
                    clarification_prompt=clarification_p,
                    grounding_score=0.0,
                    faithfulness_score=1.0,
                    top_relevance_score=top_score,
                    cutoff_threshold=g_thresh,
                    model=model or self.llm_client.default_model,
                    raw_response_text="[LEVEL 1 RELEVANCE CUTOFF]",
                )
                total_latency = time.time() - t_start
                return RAGResult(
                    question=question,
                    answer=grounded_ans.answer,
                    use_rag=use_rag,
                    sources=[],
                    model=grounded_ans.model,
                    prompt_tokens=0,
                    completion_tokens=0,
                    total_tokens=0,
                    latency_seconds=total_latency,
                    retrieval_latency=retrieval_latency,
                    llm_latency=0.0,
                    context_text="",
                    rewritten_query=rewritten_q,
                    rewrite_latency=rewrite_latency,
                    rerank_latency=rerank_latency,
                    initial_sources_count=initial_count,
                    dropped_by_filter_count=dropped_count,
                    pipeline_result=pipeline_res,
                    grounded_answer=grounded_ans,
                )

            if use_grounded:
                messages = self.build_grounded_rag_prompt(question, sources)
            else:
                messages = self.build_rag_prompt(question, sources)
            context_text = messages[1]["content"]
        else:
            messages = self.build_no_rag_prompt(question)

        llm_resp: OpenRouterResponse = self.llm_client.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
        )

        total_latency = time.time() - t_start
        final_answer = llm_resp.content

        if use_grounded and use_rag:
            g_thresh = grounded_threshold if grounded_threshold is not None else self.grounded_threshold
            top_score = max([s.score for s in sources], default=0.0)
            grounded_ans = self.parse_grounded_response(
                raw_text=llm_resp.content,
                sources=sources,
                model=llm_resp.model,
                cutoff_threshold=g_thresh,
                top_score=top_score,
            )
            final_answer = grounded_ans.answer

        return RAGResult(
            question=question,
            answer=final_answer,
            use_rag=use_rag,
            sources=sources,
            model=llm_resp.model,
            prompt_tokens=llm_resp.prompt_tokens,
            completion_tokens=llm_resp.completion_tokens,
            total_tokens=llm_resp.total_tokens,
            latency_seconds=total_latency,
            retrieval_latency=retrieval_latency,
            llm_latency=llm_resp.latency_seconds,
            context_text=context_text,
            rewritten_query=rewritten_q,
            rewrite_latency=rewrite_latency,
            rerank_latency=rerank_latency,
            initial_sources_count=initial_count,
            dropped_by_filter_count=dropped_count,
            pipeline_result=pipeline_res,
            grounded_answer=grounded_ans,
        )
