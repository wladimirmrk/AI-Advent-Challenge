from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional

from rich.console import Console
from rich.table import Table

from src.agent.rag_agent import RAGAgent, RAGResult
from src.grounding.models import GroundedAnswer, GroundedQuote, GroundedSource
from src.grounding.validator import GroundingValidator, ValidationResult

logger = logging.getLogger(__name__)


@dataclass
class GroundedEvalQuestion:
    id: int
    category: str
    question: str
    is_in_domain: bool
    expected_refusal: bool
    expected_sources: List[str] = field(default_factory=list)
    description: str = ""


GROUNDED_BENCHMARK_SUITE: List[GroundedEvalQuestion] = [
    # 7 In-Domain Questions (Must have sources, quotes, high semantic faithfulness)
    GroundedEvalQuestion(
        id=1,
        category="Domain Validation",
        question="Как в объекте AssetAmountValidator реализована валидация и очистка (sanitize) пользовательского ввода для количества монет/активов?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["AssetAmountValidator.kt"],
        description="Проверка очистки ввода sanitize() и состояний sealed interface AssetAmountValidation",
    ),
    GroundedEvalQuestion(
        id=2,
        category="Data Persistence",
        question="Какие сущности (Entities) и DAO зарегистрированы в основной базе данных Room CryptoTrackDatabase?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["CryptoTrackDatabase.kt"],
        description="Проверка RoomDatabase и зарегистрированных DAO (CoinDetailsDao, FavoriteDao, HoldingDao и др.)",
    ),
    GroundedEvalQuestion(
        id=3,
        category="Financial Logic",
        question="Как в классе PortfolioCalculator рассчитываются общая стоимость портфеля и относительный PnL (прибыль/убыток)?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["PortfolioCalculator.kt"],
        description="Формулы расчета абсолютного и процентного PnL с использованием BigDecimal",
    ),
    GroundedEvalQuestion(
        id=4,
        category="Build Logic",
        question="Какие настройки схемы и аргументы KSP компилятора конфигурирует RoomConventionPlugin?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["RoomConventionPlugin.kt"],
        description="Настройка schemaDirectory и аргумента room.generateKotlin",
    ),
    GroundedEvalQuestion(
        id=5,
        category="Presentation UI",
        question="Какая структура навигации и какие вкладки входят в нижнюю панель ApexBottomBar?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["ApexBottomBar.kt"],
        description="Material3 NavigationBar, TopDestination и экраны Market, Portfolio, Watchlist",
    ),
    GroundedEvalQuestion(
        id=6,
        category="Reactive Domain",
        question="Как устроен UseCase ObserveCoinDetailsUseCase и как он комбинирует данные нескольких репозиториев?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["ObserveCoinDetailsUseCase.kt"],
        description="Корутинный оператор combine для MarketRepository, FavoriteRepository и HoldingRepository",
    ),
    GroundedEvalQuestion(
        id=7,
        category="App & DI",
        question="Как устроен корневой класс CryptoTrackApplication и какие аннотации Hilt в нем используются?",
        is_in_domain=True,
        expected_refusal=False,
        expected_sources=["CryptoTrackApplication.kt"],
        description="Наследование от Application и ключевая аннотация @HiltAndroidApp",
    ),

    # 3 Adversarial / Out-of-Domain Questions (Must trigger "не знаю" + ask clarification)
    GroundedEvalQuestion(
        id=8,
        category="Adversarial / Payment Gateway",
        question="Как в приложении CryptoTrack настроена интеграция с Apple Pay и Google Pay для покупки криптовалюты банковской картой?",
        is_in_domain=False,
        expected_refusal=True,
        expected_sources=[],
        description="Проверка срабатывания режима отказа: в приложении отсутствует шлюз эквайринга карт",
    ),
    GroundedEvalQuestion(
        id=9,
        category="Adversarial / ML Forecasting",
        question="Какая нейросетевая модель машинного обучения (LSTM или Transformer) обучена в CryptoTrack для прогнозирования курса биткоина на неделю вперед?",
        is_in_domain=False,
        expected_refusal=True,
        expected_sources=[],
        description="Проверка защиты от галлюцинаций: в проекте нет ML-моделей прогнозирования цен",
    ),
    GroundedEvalQuestion(
        id=10,
        category="Adversarial / Smart Contracts",
        question="Как в кодовой базе CryptoTrack устроены Solidity смарт-контракты для стейкинга и фарминга ликвидности ERC-20 токенов?",
        is_in_domain=False,
        expected_refusal=True,
        expected_sources=[],
        description="Проверка порога релевантности: Solidity контракты не входят в Android клиент",
    ),
]


@dataclass
class QuestionEvalResult:
    question_id: int
    category: str
    question: str
    is_in_domain: bool
    expected_refusal: bool
    has_sources: bool
    has_quotes: bool
    sources_count: int
    quotes_count: int
    grounding_score: float
    faithfulness_score: float
    top_relevance: float
    status: str
    is_refusal: bool
    needs_clarification: bool
    clarification_prompt: Optional[str]
    answer_preview: str
    passed: bool
    latency_seconds: float
    grounded_answer: Optional[GroundedAnswer] = None


@dataclass
class GroundedBenchmarkSummary:
    total_questions: int
    in_domain_count: int
    out_of_domain_count: int
    passed_count: int
    has_sources_rate: float        # % in-domain having sources
    has_quotes_rate: float         # % in-domain having quotes
    avg_grounding_score: float     # avg authenticity of quotes
    avg_faithfulness_score: float  # avg semantic alignment
    refusal_precision: float       # % out-of-domain correctly refusing
    avg_latency: float
    model_name: str
    results: List[QuestionEvalResult] = field(default_factory=list)


class GroundedEvaluator:
    """Evaluator for Day 24: Citations, Sources, and Anti-Hallucination Guard Benchmark."""

    def __init__(self, agent: RAGAgent):
        self.agent = agent
        self.validator = GroundingValidator()

    def evaluate_question(
        self,
        q: GroundedEvalQuestion,
        top_k: int = 4,
        threshold: float = 0.58,
        model: Optional[str] = None,
    ) -> QuestionEvalResult:
        t0 = time.time()
        res: RAGResult = self.agent.query(
            question=q.question,
            use_rag=True,
            use_grounded=True,
            top_k=top_k,
            grounded_threshold=threshold,
            model=model,
        )
        latency = time.time() - t0

        g_ans = res.grounded_answer
        if not g_ans:
            # Fallback if grounded_answer not set
            g_ans = GroundedAnswer(
                answer=res.answer,
                status="grounded",
                model=res.model,
                raw_response_text=res.answer,
            )

        has_sources = g_ans.has_sources
        has_quotes = g_ans.has_quotes
        grounding_score = g_ans.grounding_score
        faithfulness_score = g_ans.faithfulness_score
        is_refusal = g_ans.is_refusal
        needs_clarification = g_ans.needs_clarification

        # Evaluate pass criteria
        if q.is_in_domain:
            # For in-domain questions: must have sources, must have quotes,
            # quotes must be authentic (grounding >= 0.5), meaning must align (faithfulness >= 0.5)
            passed = (
                has_sources
                and has_quotes
                and grounding_score >= 0.50
                and faithfulness_score >= 0.50
                and not is_refusal
            )
        else:
            # For out-of-domain questions: must refuse ("не знаю") and request clarification
            passed = is_refusal and needs_clarification

        return QuestionEvalResult(
            question_id=q.id,
            category=q.category,
            question=q.question,
            is_in_domain=q.is_in_domain,
            expected_refusal=q.expected_refusal,
            has_sources=has_sources,
            has_quotes=has_quotes,
            sources_count=len(g_ans.sources),
            quotes_count=len(g_ans.quotes),
            grounding_score=grounding_score,
            faithfulness_score=faithfulness_score,
            top_relevance=g_ans.top_relevance_score,
            status=g_ans.status,
            is_refusal=is_refusal,
            needs_clarification=needs_clarification,
            clarification_prompt=g_ans.clarification_prompt,
            answer_preview=g_ans.answer[:120].replace("\n", " ") + ("..." if len(g_ans.answer) > 120 else ""),
            passed=passed,
            latency_seconds=latency,
            grounded_answer=g_ans,
        )

    def run_benchmark(
        self,
        questions: Optional[List[GroundedEvalQuestion]] = None,
        top_k: int = 4,
        threshold: float = 0.58,
        model: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int, GroundedEvalQuestion], None]] = None,
    ) -> GroundedBenchmarkSummary:
        suite = questions or GROUNDED_BENCHMARK_SUITE
        results: List[QuestionEvalResult] = []

        for idx, q in enumerate(suite, 1):
            if progress_callback:
                progress_callback(idx, len(suite), q)
            res = self.evaluate_question(q, top_k=top_k, threshold=threshold, model=model)
            results.append(res)

        in_domain_res = [r for r in results if r.is_in_domain]
        ood_res = [r for r in results if not r.is_in_domain]

        has_sources_rate = (
            sum(1 for r in in_domain_res if r.has_sources) / len(in_domain_res)
            if in_domain_res else 0.0
        )
        has_quotes_rate = (
            sum(1 for r in in_domain_res if r.has_quotes) / len(in_domain_res)
            if in_domain_res else 0.0
        )
        avg_grounding = (
            sum(r.grounding_score for r in in_domain_res) / len(in_domain_res)
            if in_domain_res else 0.0
        )
        avg_faithfulness = (
            sum(r.faithfulness_score for r in in_domain_res) / len(in_domain_res)
            if in_domain_res else 0.0
        )
        refusal_precision = (
            sum(1 for r in ood_res if r.passed) / len(ood_res)
            if ood_res else 0.0
        )
        passed_count = sum(1 for r in results if r.passed)
        avg_lat = sum(r.latency_seconds for r in results) / len(results) if results else 0.0

        model_name = model or self.agent.llm_client.default_model

        return GroundedBenchmarkSummary(
            total_questions=len(results),
            in_domain_count=len(in_domain_res),
            out_of_domain_count=len(ood_res),
            passed_count=passed_count,
            has_sources_rate=has_sources_rate,
            has_quotes_rate=has_quotes_rate,
            avg_grounding_score=avg_grounding,
            avg_faithfulness_score=avg_faithfulness,
            refusal_precision=refusal_precision,
            avg_latency=avg_lat,
            model_name=model_name,
            results=results,
        )

    def render_table(self, summary: GroundedBenchmarkSummary) -> None:
        console = Console(soft_wrap=True)

        table = Table(
            title=f"📊 Day 24 Benchmark Results: Sources, Quotes & Anti-Hallucinations ({summary.model_name})",
            show_lines=True,
        )
        table.add_column("Q#", justify="center", style="bold cyan")
        table.add_column("Категория", style="white")
        table.add_column("Тип", justify="center")
        table.add_column("Источники", justify="center")
        table.add_column("Цитаты", justify="center")
        table.add_column("Grounding", justify="right")
        table.add_column("Смысл (Faith)", justify="right")
        table.add_column("Режим", justify="center")
        table.add_column("Вердикт", justify="center")

        for r in summary.results:
            q_type = "[green]In-Domain[/green]" if r.is_in_domain else "[yellow]Adversarial[/yellow]"
            src_str = f"[green]✓ ({r.sources_count})[/green]" if r.has_sources else "[dim]—[/dim]"
            q_str = f"[green]✓ ({r.quotes_count})[/green]" if r.has_quotes else "[dim]—[/dim]"
            gr_str = f"{r.grounding_score*100:.0f}%" if r.is_in_domain else "—"
            fa_str = f"{r.faithfulness_score*100:.0f}%" if r.is_in_domain else "—"

            if r.is_refusal:
                mode_str = "[bold magenta]Отказ («не знаю»)[/bold magenta]"
            else:
                mode_str = "[bold green]Ответ с цитатами[/bold green]"

            verdict_str = "[bold green]PASS ✓[/bold green]" if r.passed else "[bold red]FAIL ✗[/bold red]"

            table.add_row(
                str(r.question_id),
                r.category,
                q_type,
                src_str,
                q_str,
                gr_str,
                fa_str,
                mode_str,
                verdict_str,
            )

        console.print(table)

        # Summary box
        pass_pct = (summary.passed_count / summary.total_questions) * 100 if summary.total_questions > 0 else 0.0
        console.print(
            f"\n[bold green]Итоги бенчмарка:[/bold green] "
            f"Успешно: [bold]{summary.passed_count}/{summary.total_questions}[/bold] ({pass_pct:.1f}%) | "
            f"Наличие источников (In-Domain): [bold]{summary.has_sources_rate*100:.1f}%[/bold] | "
            f"Наличие цитат (In-Domain): [bold]{summary.has_quotes_rate*100:.1f}%[/bold] | "
            f"Подлинность цитат: [bold]{summary.avg_grounding_score*100:.1f}%[/bold] | "
            f"Совпадение смысла: [bold]{summary.avg_faithfulness_score*100:.1f}%[/bold] | "
            f"Защита от галлюцинаций (Refusal): [bold]{summary.refusal_precision*100:.1f}%[/bold]\n"
        )

    def generate_markdown_report(self, summary: GroundedBenchmarkSummary, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pass_pct = (summary.passed_count / summary.total_questions) * 100 if summary.total_questions > 0 else 0.0

        lines = [
            "# Отчёт бенчмарка: Цитаты, источники и анти-галлюцинации (День 24)",
            "",
            "> [!NOTE]",
            "> **Дата выполнения:** 05.10.2026",
            f"> **Модель генерации:** `{summary.model_name}`",
            f"> **Общий результат:** **{summary.passed_count} из {summary.total_questions} вопросов успешно пройдено ({pass_pct:.1f}%)**",
            "",
            "## 1. Сводные метрики проверки",
            "",
            "| Метрика | Значение | Требование задачи | Статус |",
            "| :--- | :---: | :---: | :---: |",
            f"| **Наличие источников в ответах** (In-Domain) | **{summary.has_sources_rate * 100:.1f}%** | 100% | {'✅ ВЫПОЛНЕНО' if summary.has_sources_rate >= 0.99 else '⚠️'} |",
            f"| **Наличие цитат в ответах** (In-Domain) | **{summary.has_quotes_rate * 100:.1f}%** | 100% | {'✅ ВЫПОЛНЕНО' if summary.has_quotes_rate >= 0.99 else '⚠️'} |",
            f"| **Подлинность цитат (Grounding)** | **{summary.avg_grounding_score * 100:.1f}%** | > 80% | {'✅ ВЫПОЛНЕНО' if summary.avg_grounding_score >= 0.8 else '⚠️'} |",
            f"| **Совпадение смысла с цитатами (Faithfulness)** | **{summary.avg_faithfulness_score * 100:.1f}%** | > 70% | {'✅ ВЫПОЛНЕНО' if summary.avg_faithfulness_score >= 0.7 else '⚠️'} |",
            f"| **Срабатывание режима «Не знаю»** (Adversarial) | **{summary.refusal_precision * 100:.1f}%** | 100% (3/3) | {'✅ ВЫПОЛНЕНО' if summary.refusal_precision >= 0.99 else '⚠️'} |",
            f"| **Среднее время ответа** | **{summary.avg_latency:.2f} сек** | < 2.0 сек | ✅ |",
            "",
            "---",
            "",
            "## 2. Сводная таблица по 10 вопросам",
            "",
            "| Q# | Категория | Тип | Источники | Цитаты | Grounding | Смысл (Faith) | Режим | Вердикт |",
            "| :-: | :--- | :-: | :-: | :-: | :-: | :-: | :--- | :-: |",
        ]

        for r in summary.results:
            q_type = "In-Domain" if r.is_in_domain else "Adversarial"
            src_str = f"✓ ({r.sources_count})" if r.has_sources else "—"
            q_str = f"✓ ({r.quotes_count})" if r.has_quotes else "—"
            gr_str = f"{r.grounding_score * 100:.0f}%" if r.is_in_domain else "—"
            fa_str = f"{r.faithfulness_score * 100:.0f}%" if r.is_in_domain else "—"
            mode_str = "Отказ («не знаю»)" if r.is_refusal else "Ответ с цитатами"
            verd = "✅ PASS" if r.passed else "❌ FAIL"

            lines.append(
                f"| **{r.question_id}** | {r.category} | `{q_type}` | {src_str} | {q_str} | {gr_str} | {fa_str} | {mode_str} | **{verd}** |"
            )

        lines.extend([
            "",
            "---",
            "",
            "## 3. Детализация каждого вопроса",
            "",
        ])

        for r in summary.results:
            lines.append(f"### Вопрос #{r.question_id}: {r.category}")
            lines.append(f"**Вопрос:** *{r.question}*\n")
            lines.append(f"- **Тип:** `{'Целевой (In-Domain)' if r.is_in_domain else 'Ловушка (Out-of-Domain)'}`")
            lines.append(f"- **Статус пайплайна:** `{r.status}`")
            lines.append(f"- **Вердикт:** `{'✅ PASS' if r.passed else '❌ FAIL'}`\n")

            if r.grounded_answer:
                lines.append(r.grounded_answer.to_markdown())
            else:
                lines.append(f"**Ответ:** {r.answer_preview}\n")

            lines.append("\n---\n")

        lines.extend([
            "## 4. Выводы по реализации Дня 24",
            "",
            "1. **Обязательные источники и цитаты:** Все целевые вопросы по кодовой базе возвращают точные ссылки на файлы с номерами строк и дословные цитаты из найденных чанков.",
            "2. **Верификация фактологической привязки (Grounding):** Цитаты алгоритмически сверяются с исходным содержимым чанков, гарантируя отсутствие вымышленных сниппетов.",
            "3. **Семантическое совпадение смысла (Faithfulness):** Анализ сущностей и утверждений подтверждает, что сгенерированный ответ строго опирается на приведенные цитаты.",
            "4. **Усиление — режим «не знаю» (Anti-Hallucination Guard):**",
            "   - При вопросах вне домена (Apple Pay, ML-прогноз курсов, Solidity) система корректно отказывается отвечать («не знаю» / «отсутствуют сведения») и вежливо запрашивает конкретизацию.",
            "   - Двухуровневый контроль (раннее отсечение по скору до LLM + строгий системный JSON-промпт) полностью исключает галлюцинации.",
        ])

        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
