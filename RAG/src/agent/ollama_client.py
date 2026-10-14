"""Ollama LLM client for local model execution in RAG pipeline (Day 28)."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
import requests

from src.agent.base_llm import BaseLLMClient, LLMResponse, StreamChunk

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    """Exception raised for errors during Ollama API interactions."""

    def __init__(self, message: str, status_code: Optional[int] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.details = details or {}


class OllamaClient(BaseLLMClient):
    """Client for local chat completions via Ollama API."""

    provider: str = "ollama"

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11434",
        default_model: str = "qwen3:8b",
        timeout: Optional[int] = None,
        max_retries: int = 1,
        mock_mode: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model or os.getenv("OLLAMA_CHAT_MODEL", "qwen3:8b")
        if timeout is not None:
            self.timeout = timeout
        elif os.getenv("OLLAMA_TIMEOUT", "").strip().isdigit():
            self.timeout = int(os.getenv("OLLAMA_TIMEOUT"))
        else:
            self.timeout = None
        self.max_retries = max_retries
        self.mock_mode = mock_mode or os.getenv("OLLAMA_MOCK", "").lower() in {"1", "true", "yes"}

    def is_configured(self) -> bool:
        """Check if Ollama service is reachable or mock mode is active."""
        if self.mock_mode:
            return True
        try:
            res = requests.get(f"{self.base_url}/api/tags", timeout=3)
            return res.status_code == 200
        except Exception:
            return False

    def list_models(self) -> List[str]:
        """Fetch list of available models from local Ollama instance."""
        if self.mock_mode:
            return [self.default_model, "tinyllama:latest", "nomic-embed-text:latest"]

        try:
            res = requests.get(f"{self.base_url}/api/tags", timeout=5)
            if res.status_code == 200:
                data = res.json()
                models = [m["name"] for m in data.get("models", []) if "name" in m]
                # Filter out pure embedding models for chat suggestions if possible
                chat_models = [m for m in models if "embed" not in m]
                return chat_models if chat_models else models
        except Exception as exc:
            logger.warning("Could not list Ollama models: %s", exc)

        return [self.default_model]

    def _extract_thinking(self, text: str) -> tuple[str, Optional[str]]:
        """Extract and separate <think>...</think> reasoning tags from response text."""
        think_match = re.search(r"<think>(.*?)</think>", text, flags=re.DOTALL)
        if think_match:
            thinking = think_match.group(1).strip()
            clean_content = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
            return clean_content, thinking

        # If text has an unclosed <think> tag
        if "<think>" in text:
            parts = text.split("<think>", 1)
            before_think = parts[0].strip()
            thinking = parts[1].strip()
            return before_think, thinking

        return text, None

    def _extract_ollama_metrics(self, data: Dict[str, Any], base_duration: float = 0.0) -> Dict[str, Any]:
        """Extract duration and token metrics from Ollama API response body."""
        prompt_eval_dur = (data.get("prompt_eval_duration", 0) or 0) / 1e9
        eval_dur = (data.get("eval_duration", 0) or 0) / 1e9
        comp_toks = data.get("eval_count", 0)
        prompt_toks = data.get("prompt_eval_count", 0)

        if eval_dur > 0:
            tok_per_sec = comp_toks / eval_dur
        elif base_duration > 0:
            tok_per_sec = comp_toks / base_duration
        else:
            tok_per_sec = 0.0

        return {
            "prompt_eval_duration_seconds": round(prompt_eval_dur, 3),
            "eval_duration_seconds": round(eval_dur, 3),
            "tokens_per_second": round(tok_per_sec, 2),
            "prompt_tokens": prompt_toks,
            "completion_tokens": comp_toks,
            "total_tokens": prompt_toks + comp_toks,
        }

    def _generate_mock_response(
        self,
        messages: List[Dict[str, str]],
        target_model: str,
        num_ctx: Optional[int] = None,
    ) -> LLMResponse:
        """Deterministic high-fidelity mock response for local testing and CI/CD."""
        user_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        is_rag = (
            "КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:" in user_msg
            or "### Источник #" in user_msg
            or "КОНТЕКСТ КОДОВОЙ БАЗЫ" in user_msg
            or "[FILE:" in user_msg
        )

        # Extract citations
        sources_found = re.findall(r"### Источник #(\d+):\s*`([^`]+)`(?:\s*\(строки\s*([^)]+)\))?", user_msg)
        if not sources_found:
            for fm in re.findall(r"\[FILE:\s*([^:|\]\n]+)(?::L([^|\]\n]+))?", user_msg):
                sources_found.append((0, fm[0], fm[1]))

        citations = []
        for sf in sources_found:
            path = sf[1]
            lines = sf[2].replace(" ", "").replace("L", "") if sf[2] else ""
            lines_tag = f":L{lines}" if lines else ""
            citations.append(f"[Source: {path}{lines_tag}]")

        c0 = citations[0] if citations else "[Source: core/data/database/CryptoTrackDatabase.kt:L12-L35]"

        if is_rag:
            if "AssetAmountValidator" in user_msg or "валидация" in user_msg:
                body = (
                    f"Валидация пользовательского ввода в CryptoTrack реализована в классе `AssetAmountValidator` {c0}.\n\n"
                    "1. Функция `sanitize(raw: String)` заменяет запятые на точки и удаляет лишние символы.\n"
                    "2. Функция `validate(raw: String)` выполняет проверку через regex `^(\\d+(\\.\\d*)?|\\.\\d+)$` и возвращает `AssetAmountValidation.Valid`."
                )
            elif "CryptoTrackDatabase" in user_msg or "Room" in user_msg or "баз" in user_msg:
                body = (
                    f"Локальное хранилище CryptoTrack построено на `RoomDatabase` в абстрактном классе `CryptoTrackDatabase` {c0}.\n\n"
                    "Основные сущности:\n"
                    "- `AssetEntity`: котировки и балансы активов\n"
                    "- `TransactionEntity`: журнал операций\n"
                    "- `PriceAlertEntity`: настроенные ценовые алерты\n"
                    "Доступ осуществляется через интерфейсы DAO (`AssetDao`, `TransactionDao`, `AlertDao`)."
                )
            else:
                body = f"Согласно кодовой базе CryptoTrack {c0}, модуль реализует функционал в соответствии с Clean Architecture."
        else:
            body = "CryptoTrack — это Android-приложение для мониторинга криптовалютных активов на базе Kotlin, Jetpack Compose и Room."

        # Check if caller expects JSON (e.g. MemoryChatEngine)
        if any("JSON ONLY" in m.get("content", "") for m in messages):
            json_payload = {
                "answer": body,
                "sources": [{"source": sf[1], "section": "Class"} for sf in sources_found] if sources_found else [{"source": "CryptoTrackDatabase.kt"}],
                "task_state_update": {
                    "goal": "Анализ архитектуры CryptoTrack",
                    "new_clarifications": ["Уточнены детали реализации"],
                    "new_constraints": [],
                    "new_findings": ["Найдена целевая реализация в кодовой базе"]
                }
            }
            body = json.dumps(json_payload, ensure_ascii=False)

        prompt_toks = sum(len(m.get("content", "").split()) for m in messages) * 2
        comp_toks = len(body.split()) * 2
        latency = 0.35 if (num_ctx and num_ctx <= 4096) else 0.85
        eval_dur = latency * 0.7
        tok_speed = (comp_toks / eval_dur) if eval_dur > 0 else 25.0

        return LLMResponse(
            content=body,
            model=target_model,
            provider="ollama",
            prompt_tokens=prompt_toks,
            completion_tokens=comp_toks,
            total_tokens=prompt_toks + comp_toks,
            latency_seconds=latency,
            finish_reason="stop",
            is_mock=True,
            thinking_content="Локальный mock-анализ контекста кодовой базы...",
            prompt_eval_duration_seconds=round(latency * 0.3, 3),
            eval_duration_seconds=round(eval_dur, 3),
            tokens_per_second=round(tok_speed, 2),
            num_ctx=num_ctx,
        )

    def generate(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = 2500,
        num_ctx: Optional[int] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """Send chat messages to local Ollama instance and return LLMResponse."""
        target_model = model or self.default_model

        if self.mock_mode:
            return self._generate_mock_response(messages, target_model, num_ctx=num_ctx)

        url = f"{self.base_url}/api/chat"
        options: Dict[str, Any] = {
            "temperature": temperature,
        }
        if max_tokens:
            options["num_predict"] = max_tokens
        if num_ctx:
            options["num_ctx"] = num_ctx
        for k, v in kwargs.items():
            if k in {"top_p", "top_k", "repeat_penalty"} and v is not None:
                options[k] = v

        payload = {
            "model": target_model,
            "messages": messages,
            "stream": False,
            "options": options,
        }

        last_error = None
        for attempt in range(1, self.max_retries + 1):
            start_time = time.time()
            try:
                resp = requests.post(
                    url,
                    json=payload,
                    timeout=self.timeout,
                    headers={"Content-Type": "application/json"},
                )
                latency = time.time() - start_time

                if resp.status_code == 200:
                    data = resp.json()
                    msg = data.get("message", {})
                    raw_content = msg.get("content", "")
                    clean_content, thinking = self._extract_thinking(raw_content)

                    metrics = self._extract_ollama_metrics(data, latency)

                    return LLMResponse(
                        content=clean_content,
                        model=target_model,
                        provider="ollama",
                        prompt_tokens=metrics["prompt_tokens"],
                        completion_tokens=metrics["completion_tokens"],
                        total_tokens=metrics["total_tokens"],
                        latency_seconds=latency,
                        finish_reason=data.get("done_reason", "stop"),
                        raw_response=data,
                        is_mock=False,
                        thinking_content=thinking,
                        prompt_eval_duration_seconds=metrics["prompt_eval_duration_seconds"],
                        eval_duration_seconds=metrics["eval_duration_seconds"],
                        tokens_per_second=metrics["tokens_per_second"],
                        num_ctx=num_ctx,
                    )

                if resp.status_code == 404:
                    raise OllamaError(
                        f"Модель '{target_model}' не найдена в локальном Ollama. "
                        f"Запустите `ollama pull {target_model}` или используйте установленную модель: {self.list_models()}",
                        status_code=404,
                    )

                error_text = resp.text[:300]
                raise OllamaError(
                    f"Ошибка Ollama API (HTTP {resp.status_code}): {error_text}",
                    status_code=resp.status_code,
                )

            except requests.exceptions.ConnectionError as exc:
                last_error = exc
                logger.warning("Ollama connection failed on attempt %d/%d: %s", attempt, self.max_retries, exc)
                if attempt < self.max_retries:
                    time.sleep(1.0)
                    continue
                raise OllamaError(
                    f"Не удалось подключиться к Ollama по адресу {self.base_url}. "
                    "Убедитесь, что служба Ollama запущена (`ollama serve`).",
                    details={"error": str(exc)},
                )
            except requests.exceptions.Timeout as exc:
                last_error = exc
                t_str = f" ({self.timeout}с)" if self.timeout else ""
                logger.warning("Ollama request timed out on attempt %d/%d%s", attempt, self.max_retries, t_str)
                if attempt < self.max_retries:
                    time.sleep(1.0)
                    continue
                raise OllamaError(
                    f"Превышено время ожидания ответа от Ollama{t_str}. "
                    "Локальная модель загружается или требует больше времени на генерацию.",
                    details={"timeout": self.timeout},
                )
            except requests.exceptions.RequestException as exc:
                last_error = exc
                logger.warning("Ollama request failed: %s", exc)
                if attempt < self.max_retries:
                    time.sleep(1.0)
                    continue
                raise OllamaError(f"Сетевая ошибка при обращении к Ollama: {exc}")

        raise OllamaError(f"Не удалось получить ответ от Ollama после {self.max_retries} попыток: {last_error}")

    def _stream_mock_response(self, messages: List[Dict[str, str]], target_model: str):
        """Simulate realistic token-by-token streaming for offline testing and CI."""
        mock_resp = self._generate_mock_response(messages, target_model)
        if mock_resp.thinking_content:
            parts = re.split(r"(\s+)", mock_resp.thinking_content)
            for p in parts:
                if p:
                    yield StreamChunk(
                        thinking_delta=p,
                        is_thinking=True,
                        model=target_model,
                        provider=self.provider,
                    )
                    time.sleep(0.003)

        parts = re.split(r"(\s+)", mock_resp.content)
        for p in parts:
            if p:
                yield StreamChunk(
                    delta=p,
                    is_thinking=False,
                    model=target_model,
                    provider=self.provider,
                )
                time.sleep(0.003)

        yield StreamChunk(
            delta="",
            finish_reason="stop",
            model=target_model,
            provider=self.provider,
            prompt_tokens=mock_resp.prompt_tokens,
            completion_tokens=mock_resp.completion_tokens,
            total_tokens=mock_resp.total_tokens,
        )

    def stream_generate(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = 2500,
        response_format: Optional[Dict[str, Any]] = None,
        num_ctx: Optional[int] = None,
        **kwargs: Any,
    ):
        """Stream chat messages to local Ollama instance and yield StreamChunk increments."""
        target_model = model or self.default_model

        if self.mock_mode:
            yield from self._stream_mock_response(messages, target_model)
            return

        url = f"{self.base_url}/api/chat"
        options: Dict[str, Any] = {
            "temperature": temperature,
        }
        if max_tokens:
            options["num_predict"] = max_tokens
        if num_ctx:
            options["num_ctx"] = num_ctx
        for k, v in kwargs.items():
            if k in {"top_p", "top_k", "repeat_penalty"} and v is not None:
                options[k] = v

        payload: Dict[str, Any] = {
            "model": target_model,
            "messages": messages,
            "stream": True,
            "options": options,
        }
        if response_format and response_format.get("type") == "json_object":
            payload["format"] = "json"

        try:
            resp = requests.post(
                url,
                json=payload,
                stream=True,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        except requests.exceptions.ConnectionError as exc:
            raise OllamaError(
                f"Не удалось подключиться к Ollama по адресу {self.base_url}. "
                "Убедитесь, что служба Ollama запущена (`ollama serve`).",
                details={"error": str(exc)},
            )
        except requests.exceptions.Timeout as exc:
            t_str = f" ({self.timeout}с)" if self.timeout else ""
            raise OllamaError(
                f"Превышено время ожидания ответа от Ollama{t_str}.",
                details={"timeout": self.timeout},
            )
        except requests.exceptions.RequestException as exc:
            raise OllamaError(f"Сетевая ошибка при обращении к Ollama: {exc}")

        if resp.status_code == 404:
            raise OllamaError(
                f"Модель '{target_model}' не найдена в локальном Ollama. "
                f"Запустите `ollama pull {target_model}` или используйте установленную модель: {self.list_models()}",
                status_code=404,
            )
        if resp.status_code != 200:
            error_text = resp.text[:300]
            raise OllamaError(
                f"Ошибка Ollama API (HTTP {resp.status_code}): {error_text}",
                status_code=resp.status_code,
            )

        in_thinking = False
        buffer = ""

        def process_buffer(buf: str, flush_all: bool = False):
            nonlocal in_thinking
            out_chunks = []
            while buf:
                if not in_thinking:
                    if "<think>" in buf:
                        idx = buf.index("<think>")
                        if idx > 0:
                            out_chunks.append(StreamChunk(delta=buf[:idx], is_thinking=False, model=target_model, provider=self.provider))
                        in_thinking = True
                        buf = buf[idx + len("<think>"):]
                    elif "<" in buf:
                        idx = buf.rindex("<")
                        candidate = buf[idx:]
                        if "<think>".startswith(candidate) and not flush_all:
                            if idx > 0:
                                out_chunks.append(StreamChunk(delta=buf[:idx], is_thinking=False, model=target_model, provider=self.provider))
                            buf = candidate
                            break
                        else:
                            out_chunks.append(StreamChunk(delta=buf, is_thinking=False, model=target_model, provider=self.provider))
                            buf = ""
                    else:
                        out_chunks.append(StreamChunk(delta=buf, is_thinking=False, model=target_model, provider=self.provider))
                        buf = ""
                else:
                    if "</think>" in buf:
                        idx = buf.index("</think>")
                        if idx > 0:
                            out_chunks.append(StreamChunk(thinking_delta=buf[:idx], is_thinking=True, model=target_model, provider=self.provider))
                        in_thinking = False
                        buf = buf[idx + len("</think>"):]
                    elif "<" in buf:
                        idx = buf.rindex("<")
                        candidate = buf[idx:]
                        if "</think>".startswith(candidate) and not flush_all:
                            if idx > 0:
                                out_chunks.append(StreamChunk(thinking_delta=buf[:idx], is_thinking=True, model=target_model, provider=self.provider))
                            buf = candidate
                            break
                        else:
                            out_chunks.append(StreamChunk(thinking_delta=buf, is_thinking=True, model=target_model, provider=self.provider))
                            buf = ""
                    else:
                        out_chunks.append(StreamChunk(thinking_delta=buf, is_thinking=True, model=target_model, provider=self.provider))
                        buf = ""
            return buf, out_chunks

        prompt_toks = 0
        comp_toks = 0
        done_reason = "stop"

        try:
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except Exception:
                    continue

                msg = data.get("message", {})
                content_chunk = msg.get("content", "")
                if content_chunk:
                    buffer += content_chunk
                    buffer, chunks = process_buffer(buffer, flush_all=False)
                    for c in chunks:
                        yield c

                if data.get("done", False):
                    prompt_toks = data.get("prompt_eval_count", 0)
                    comp_toks = data.get("eval_count", 0)
                    done_reason = data.get("done_reason", "stop")
                    break

            if buffer:
                _, remaining_chunks = process_buffer(buffer, flush_all=True)
                for c in remaining_chunks:
                    yield c

            yield StreamChunk(
                delta="",
                finish_reason=done_reason,
                model=target_model,
                provider=self.provider,
                prompt_tokens=prompt_toks,
                completion_tokens=comp_toks,
                total_tokens=prompt_toks + comp_toks,
            )
        finally:
            resp.close()

    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 2500,
        response_format: Optional[Dict[str, Any]] = None,
    ) -> LLMResponse:
        """Compatibility alias for chat_completion."""
        return self.generate(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )
