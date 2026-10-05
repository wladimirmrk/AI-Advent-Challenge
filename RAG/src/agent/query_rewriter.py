import re
import time
from dataclasses import dataclass
from typing import Optional

from src.agent.openrouter_client import OpenRouterClient, OpenRouterError


@dataclass
class QueryRewriteResult:
    original_query: str
    rewritten_query: str
    latency_seconds: float = 0.0
    is_rewritten: bool = True
    method: str = "llm"  # "llm", "heuristic", or "disabled"


class QueryRewriter:
    """
    Transforms user questions into dense, search-optimized queries targeting
    code entities, architecture patterns, and technical symbols in CryptoTrack.
    """

    SYSTEM_PROMPT = (
        "Вы — экспертный поисковый оптимизатор для RAG-системы по Android кодовой базе CryptoTrack "
        "(Kotlin, Jetpack Compose, Room DB, Hilt, Clean Architecture, Repository, UseCase, ViewModel, Gradle plugins).\n\n"
        "Ваша цель: переписать и обогатить вопрос пользователя в высокоэффективный поисковый запрос для векторного поиска.\n\n"
        "Инструкции:\n"
        "1. Извлеките и сохраните конкретные технические термины, имена классов, интерфейсов, аннотаций (@Entity, @Dao, @Module), методов и пакетов на английском.\n"
        "2. Дополните запрос ключевыми архитектурными сущностями (например, Room Database, DAO, RepositoryImpl, CryptoPrice, Flow, DTO, State, Hilt Module).\n"
        "3. Уберите вводные разговорные фразы ('подскажи', 'как сделать', 'почему', 'расскажи о', 'пожалуйста').\n"
        "4. Ответ должен быть КОМПАКТНЫМ (1 строка, до 25-30 слов), содержащим как русские ключевые понятия, так и точные английские идентификаторы кода.\n"
        "5. Выведите ТОЛЬКО переписанный запрос, без кавычек, префиксов и комментариев."
    )

    def __init__(
        self,
        llm_client: Optional[OpenRouterClient] = None,
        model: Optional[str] = None,
        enabled: bool = True,
    ):
        self.llm_client = llm_client
        self.model = model
        self.enabled = enabled

    def rewrite(self, question: str) -> QueryRewriteResult:
        """
        Rewrite query using LLM if available and enabled, otherwise fallback to heuristics.
        """
        q_clean = question.strip()
        if not self.enabled or not q_clean:
            return QueryRewriteResult(
                original_query=question,
                rewritten_query=question,
                latency_seconds=0.0,
                is_rewritten=False,
                method="disabled",
            )

        t0 = time.time()

        # Try LLM query rewrite if client is present and not explicitly in mock mode
        is_mock = getattr(self.llm_client, "mock_mode", None) is True
        if self.llm_client and not is_mock:
            try:
                messages = [
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": f"Вопрос: {q_clean}\n\nОптимизированный поисковый запрос:"},
                ]
                resp = self.llm_client.chat_completion(
                    messages=messages,
                    model=self.model,
                    temperature=0.0,
                    max_tokens=64,
                )
                output = resp.content.strip().strip("\"'").replace("\n", " ")
                # Strip potential markdown formatting
                output = re.sub(r"^`+|`+$", "", output).strip()

                is_canned_mock = any(
                    marker in output
                    for marker in [
                        "В стандартных",
                        "На основе кодовой базы",
                        "Для реализации этой функциональности",
                        "Информация подтверждается",
                        "Плагин конвенций `RoomConventionPlugin` стандартизирует",
                    ]
                )

                if output and len(output) >= 4 and not is_canned_mock:
                    # Guarantee all specific code identifiers from the original query are preserved
                    latin_symbols = [
                        w for w in re.findall(r"[A-Za-z0-9_]{3,}", question)
                        if w.lower() not in {"how", "the", "and", "for", "what", "which", "with", "cryptotrack"}
                    ]
                    missing = [s for s in latin_symbols if s.lower() not in output.lower()]
                    if missing:
                        output = f"{' '.join(missing)} {output}"

                    return QueryRewriteResult(
                        original_query=question,
                        rewritten_query=output,
                        latency_seconds=time.time() - t0,
                        is_rewritten=True,
                        method="llm",
                    )
            except (OpenRouterError, Exception):
                # Fallback gracefully to heuristic rewrite
                pass

        # Heuristic fallback rewrite
        heuristic_res = self._heuristic_rewrite(q_clean)
        return QueryRewriteResult(
            original_query=question,
            rewritten_query=heuristic_res,
            latency_seconds=time.time() - t0,
            is_rewritten=True,
            method="heuristic",
        )

    def _heuristic_rewrite(self, question: str) -> str:
        """
        Rule-based technical symbol extraction and query expansion without network calls.
        """
        stopwords = {
            "как", "где", "какой", "какая", "какие", "что", "почему", "зачем",
            "опиши", "расскажи", "покажи", "найди", "реализован", "реализовано",
            "реализована", "используется", "применяется", "работает", "в", "на",
            "для", "по", "из", "под", "с", "со", "и", "или", "а", "но", "ли",
            "how", "what", "where", "why", "is", "are", "the", "a", "an", "in", "to",
        }

        # Extract code symbols (camelCase, PascalCase, snake_case, or words with dots/brackets)
        latin_symbols = re.findall(r"[A-Za-z0-9_]{2,}(?:\.[A-Za-z0-9_]+)*", question)
        
        # Tokenize words
        words = re.findall(r"[\w]+", question.lower())
        filtered_words = [w for w in words if w not in stopwords and len(w) > 2]

        # Domain expansions for common CryptoTrack concepts
        expansions = []
        low = question.lower()
        has_specific_class = any(s[0].isupper() and len(s) >= 6 for s in latin_symbols)

        if "room" in low or "кэш" in low or "баз" in low or "dao" in low:
            expansions.extend(["RoomDatabase", "Dao", "Entity", "database"])
        if "hilt" in low or "di" in low or "внедрен" in low:
            expansions.extend(["@Module", "@InstallIn", "SingletonComponent", "@Provides"])
        if "network" in low or "api" in low or "запрос" in low or "сеть" in low:
            expansions.extend(["Ktor", "OkHttp", "HttpClient", "RemoteDataSource"])
        if "compose" in low or "ui" in low or "экран" in low or "виджет" in low:
            expansions.extend(["@Composable", "ViewModel", "UiState", "Screen"])
        if not has_specific_class:
            if "clean" in low or "архитектур" in low:
                expansions.extend(["CleanArchitecture", "domain", "data", "presentation"])
            if "usecase" in low:
                expansions.extend(["UseCase", "Repository"])

        # Combine
        parts = []
        if latin_symbols:
            parts.extend(latin_symbols)
        parts.extend(filtered_words[:6])
        parts.extend([e for e in expansions if e not in parts][:4])

        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for p in parts:
            p_clean = p.strip()
            if p_clean and p_clean.lower() not in seen:
                seen.add(p_clean.lower())
                deduped.append(p_clean)

        return " ".join(deduped) if deduped else question
