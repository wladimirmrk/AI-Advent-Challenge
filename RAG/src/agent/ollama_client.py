"""Ollama LLM client for local model execution in RAG pipeline (Day 28)."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
import requests

from src.agent.base_llm import BaseLLMClient, LLMResponse

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
        timeout: int = 300,
        max_retries: int = 1,
        mock_mode: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model or os.getenv("OLLAMA_CHAT_MODEL", "qwen3:8b")
        self.timeout = timeout or int(os.getenv("OLLAMA_TIMEOUT", "300"))
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

    def _generate_mock_response(self, messages: List[Dict[str, str]], target_model: str) -> LLMResponse:
        """Deterministic high-fidelity mock response for local testing and CI/CD."""
        user_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        is_rag = "КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:" in user_msg or "### Источник #" in user_msg

        # Extract citations
        sources_found = re.findall(r"### Источник #(\d+):\s*`([^`]+)`(?:\s*\(строки\s*([^)]+)\))?", user_msg)
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

        return LLMResponse(
            content=body,
            model=target_model,
            provider="ollama",
            prompt_tokens=prompt_toks,
            completion_tokens=comp_toks,
            total_tokens=prompt_toks + comp_toks,
            latency_seconds=0.45,
            finish_reason="stop",
            is_mock=True,
            thinking_content="Локальный mock-анализ контекста кодовой базы...",
        )

    def generate(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = 2500,
    ) -> LLMResponse:
        """Send chat messages to local Ollama instance and return LLMResponse."""
        target_model = model or self.default_model

        if self.mock_mode:
            return self._generate_mock_response(messages, target_model)

        url = f"{self.base_url}/api/chat"
        payload = {
            "model": target_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }
        if max_tokens:
            payload["options"]["num_predict"] = max_tokens

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

                    prompt_toks = data.get("prompt_eval_count", 0)
                    comp_toks = data.get("eval_count", 0)
                    total_toks = prompt_toks + comp_toks

                    return LLMResponse(
                        content=clean_content,
                        model=target_model,
                        provider="ollama",
                        prompt_tokens=prompt_toks,
                        completion_tokens=comp_toks,
                        total_tokens=total_toks,
                        latency_seconds=latency,
                        finish_reason=data.get("done_reason", "stop"),
                        raw_response=data,
                        is_mock=False,
                        thinking_content=thinking,
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
                logger.warning("Ollama request timed out on attempt %d/%d (timeout=%ds)", attempt, self.max_retries, self.timeout)
                if attempt < self.max_retries:
                    time.sleep(1.0)
                    continue
                raise OllamaError(
                    f"Превышено время ожидания ответа от Ollama ({self.timeout}с). "
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
