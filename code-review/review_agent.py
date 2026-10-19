"""Code Review Agent using OpenRouter LLM and RAG context."""

from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional

# Ensure RAG module is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
RAG_PATH = BASE_DIR / "RAG"
if str(RAG_PATH) not in sys.path:
    sys.path.insert(0, str(RAG_PATH))

from src.agent.base_llm import BaseLLMClient, LLMResponse
from src.agent.llm_factory import create_llm_client

logger = logging.getLogger(__name__)


@dataclass
class ReviewResult:
    """Result of code review analysis."""
    pr_number: int
    review_markdown: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_seconds: float = 0.0
    verdict: str = "COMMENT"
    is_mock: bool = False


class CodeReviewAgent:
    """Agent that performs architectural and quality code review using LLM and RAG context."""

    def __init__(
        self,
        model: str = "nvidia/nemotron-3-ultra-550b-a55b:free",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 120,
    ):
        self.model = model
        self.timeout = timeout
        self.llm_client: BaseLLMClient = create_llm_client(
            provider="openrouter",
            model=model,
            api_key=api_key,
            timeout=timeout,
            base_url=base_url,
        )

    def build_prompt(
        self,
        pr_number: int,
        metadata: Dict[str, Any],
        diff_text: str,
        rag_context_text: str,
    ) -> List[Dict[str, str]]:
        """Construct prompt containing PR metadata, diff, and retrieved RAG context."""
        pr_title = metadata.get("title", f"PR #{pr_number}")
        pr_author = metadata.get("author", {}).get("login", "unknown") if isinstance(metadata.get("author"), dict) else str(metadata.get("author", "unknown"))
        base_ref = metadata.get("baseRefName", "main")
        head_ref = metadata.get("headRefName", "branch")
        pr_body = metadata.get("body", "").strip() or "_Описание отсутствует._"

        system_instruction = (
            "Вы — ведущий системный архитектор и Senior Android/Kotlin инженер проекта CryptoTrack.\n"
            "Ваша задача — провести глубокое, строгое и конструктивное код-ревью (Code Review) изменений в Pull Request.\n\n"
            "АРХИТЕКТУРНЫЕ ИНВАРИАНТЫ ПРОЕКТА CRYPTOTRACK:\n"
            "1. Модульная Clean Architecture: :app -> :feature:* -> :core:*\n"
            "2. Строгий запрет циклических и горизонтальных связей: :feature никогда не зависит от другой :feature;\n"
            "   :core никогда не зависит от :feature. Слой presentation не обращается к Room/Retrofit напрямую.\n"
            "3. Offline-first парадигма: локальная база Room является Single Source of Truth (ADR-016).\n"
            "4. Асинхронность и корутины: все операции используют внедряемый DispatchersProvider (не Dispatchers.IO напрямую).\n"
            "5. Безопасность и CI/CD: команды раннеров, шеллы (bash vs pwsh), права доступа и обработка ошибок должны быть безопасны.\n"
            "6. Оформление коммитов: Conventional Commits (feat, fix, chore, ci, docs, test, build, style).\n\n"
            "ТРЕБОВАНИЯ К СТРУКТУРЕ ОТВЕТА (MARKDOWN):\n"
            "Ваш отчет ДОЛЖЕН содержать следующие 5 разделов:\n"
            "## 1. 📋 Резюме изменений (Executive Summary)\n"
            "- Суть внесенных изменений, их цель и контекст.\n\n"
            "## 2. 🐛 Потенциальные баги и граничные случаи (Potential Bugs & Edge Cases)\n"
            "- Логические ошибки, проблемы с типами/null safety, ресурсоемкость, гонки потоков, окружение раннеров.\n\n"
            "## 3. 🏛️ Архитектурный анализ и инварианты (Architecture & Invariants)\n"
            "- Соответствие принципам Clean Architecture CryptoTrack, правилам модулей и ADR.\n\n"
            "## 4. 💡 Рекомендации и примеры улучшений (Recommendations & Best Practices)\n"
            "- Конкретные предложения по рефакторингу с примерами кода/diff.\n\n"
            "## 5. ⚖️ Вердикт и статус (Verdict)\n"
            "- Один из статусов: [APPROVE] (Одобрено), [REQUEST_CHANGES] (Требуются исправления) или [COMMENT] (Замечания/уточнения).\n"
            "- Краткий итог решения."
        )

        user_content = (
            f"# PULL REQUEST #{pr_number}: {pr_title}\n"
            f"- **Автор:** @{pr_author}\n"
            f"- **Ветка:** `{head_ref}` -> `{base_ref}`\n"
            f"- **Описание PR:**\n{pr_body}\n\n"
            f"## КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ И АРХИТЕКТУРЫ CRYPTOTRACK (RAG):\n"
            f"{rag_context_text}\n\n"
            f"## ИЗМЕНЕНИЯ (DIFF):\n"
            f"```diff\n{diff_text.strip()}\n```\n\n"
            "Проведите детальный анализ изменений и сформируйте профессиональный отчет код-ревью:"
        )

        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content},
        ]

    def review(
        self,
        pr_number: int,
        metadata: Dict[str, Any],
        diff_text: str,
        rag_context_text: str,
    ) -> ReviewResult:
        """Execute LLM code review analysis."""
        messages = self.build_prompt(pr_number, metadata, diff_text, rag_context_text)

        t0 = time.time()
        response: LLMResponse = self.llm_client.generate(
            messages=messages,
            model=self.model,
            temperature=0.2,
        )
        latency = time.time() - t0

        review_text = response.content.strip()

        # Extract verdict
        verdict = "COMMENT"
        upper_text = review_text.upper()
        if "[APPROVE]" in upper_text or "APPROVE" in upper_text:
            verdict = "APPROVE"
        elif "[REQUEST_CHANGES]" in upper_text or "REQUEST CHANGES" in upper_text or "REQUEST_CHANGES" in upper_text:
            verdict = "REQUEST_CHANGES"

        return ReviewResult(
            pr_number=pr_number,
            review_markdown=review_text,
            model=response.model or self.model,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            total_tokens=response.total_tokens,
            latency_seconds=latency,
            verdict=verdict,
            is_mock=response.is_mock,
        )
