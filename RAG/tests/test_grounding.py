import pytest
from unittest.mock import MagicMock

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.rag_agent import RAGAgent, RetrievedSource
from src.grounding.models import GroundedAnswer, GroundedQuote, GroundedSource
from src.grounding.validator import GroundingValidator
from src.evaluation.grounded_evaluator import GroundedEvaluator, GROUNDED_BENCHMARK_SUITE


@pytest.fixture
def sample_retrieved_chunks():
    return [
        RetrievedSource(
            rank=1,
            score=0.78,
            source="feature/assetentry/domain/AssetAmountValidator.kt",
            section="AssetAmountValidator",
            start_line=15,
            end_line=45,
            content=(
                "object AssetAmountValidator {\n"
                "    fun sanitize(raw: String): String {\n"
                "        return raw.replace(',', '.').filterIndexed { i, c -> c.isDigit() || (c == '.' && raw.indexOf('.') == i) }\n"
                "    }\n"
                "    fun validate(input: String): AssetAmountValidation {\n"
                "        if (input.isBlank()) return AssetAmountValidation.Empty\n"
                "        val num = input.toBigDecimalOrNull() ?: return AssetAmountValidation.InvalidFormat\n"
                "        if (num <= BigDecimal.ZERO) return AssetAmountValidation.NotPositive\n"
                "        return AssetAmountValidation.Valid(num)\n"
                "    }\n"
                "}"
            ),
        ),
        RetrievedSource(
            rank=2,
            score=0.65,
            source="core/data/database/CryptoTrackDatabase.kt",
            section="CryptoTrackDatabase",
            start_line=20,
            end_line=50,
            content=(
                "@Database(entities = [MarketCoinEntity::class, HoldingEntity::class], version = 1)\n"
                "abstract class CryptoTrackDatabase : RoomDatabase() {\n"
                "    abstract fun marketCoinDao(): MarketCoinDao\n"
                "    abstract fun holdingDao(): HoldingDao\n"
                "    abstract fun favoriteDao(): FavoriteDao\n"
                "}"
            ),
        ),
    ]


def test_grounded_models_and_markdown():
    answer = GroundedAnswer(
        answer="Валидация выполняется объектом AssetAmountValidator.",
        sources=[
            GroundedSource(
                source="feature/assetentry/domain/AssetAmountValidator.kt",
                section="AssetAmountValidator",
                start_line=15,
                end_line=45,
                score=0.78,
            )
        ],
        quotes=[
            GroundedQuote(
                text="fun sanitize(raw: String): String",
                source="AssetAmountValidator.kt",
                is_exact_match=True,
            )
        ],
        status="grounded",
        grounding_score=1.0,
        faithfulness_score=0.92,
        top_relevance_score=0.78,
    )

    md = answer.to_markdown()
    assert "🤖 Ответ" in md
    assert "AssetAmountValidator" in md
    assert "📚 Список источников" in md
    assert "💬 Цитаты" in md
    assert "fun sanitize" in md
    assert "Метрики проверки" in md

    data = answer.to_dict()
    assert data["has_sources"] is True
    assert data["has_quotes"] is True
    assert data["grounding_score"] == 1.0


def test_validator_exact_and_fuzzy_quote_match(sample_retrieved_chunks):
    validator = GroundingValidator()

    # Exact match
    quote1 = "fun sanitize(raw: String): String"
    matched, ratio, chunk = validator.verify_quote_in_chunks(quote1, sample_retrieved_chunks)
    assert matched is True
    assert ratio >= 0.95
    assert chunk.source == "feature/assetentry/domain/AssetAmountValidator.kt"

    # Normalized match
    quote2 = "FUN SANITIZE( raw: String ): String"
    matched, ratio, chunk = validator.verify_quote_in_chunks(quote2, sample_retrieved_chunks)
    assert matched is True
    assert ratio >= 0.80


def test_validator_detects_hallucinated_quote(sample_retrieved_chunks):
    validator = GroundingValidator()

    # Hallucinated quote not present in any chunk
    fake_quote = "fun connectToBlockchainNetworkWithMetamaskWalletProvider(): Web3Provider"
    matched, ratio, chunk = validator.verify_quote_in_chunks(fake_quote, sample_retrieved_chunks)
    assert matched is False
    assert ratio < 0.50

    grounded_ans = GroundedAnswer(
        answer="В проекте используется Web3Provider для подключения кошелька.",
        sources=[GroundedSource(source="Fake.kt")],
        quotes=[GroundedQuote(text=fake_quote)],
    )

    res = validator.validate(grounded_ans, sample_retrieved_chunks)
    assert res.grounding_score == 0.0
    assert grounded_ans.quotes[0].is_exact_match is False


def test_validator_semantic_faithfulness(sample_retrieved_chunks):
    validator = GroundingValidator()

    # Well grounded answer
    grounded_ans = GroundedAnswer(
        answer=(
            "Объект AssetAmountValidator реализует метод sanitize() для очистки ввода "
            "и метод validate(), возвращающий AssetAmountValidation.Valid или ошибки Empty, NotPositive."
        ),
        sources=[GroundedSource(source="AssetAmountValidator.kt")],
        quotes=[
            GroundedQuote(text="fun sanitize(raw: String): String", is_exact_match=True),
            GroundedQuote(text="fun validate(input: String): AssetAmountValidation", is_exact_match=True),
        ],
    )
    res = validator.validate(grounded_ans, sample_retrieved_chunks)
    assert res.faithfulness_score >= 0.70
    assert res.is_aligned is True

    # Hallucinated answer claiming features not present in chunks
    hallucinated_ans = GroundedAnswer(
        answer="Пользователь оплачивает подписку через Stripe Gateway и PayPal SDK с токенизацией Visa карт.",
        sources=[GroundedSource(source="AssetAmountValidator.kt")],
        quotes=[],
    )
    res_fake = validator.validate(hallucinated_ans, sample_retrieved_chunks)
    assert res_fake.faithfulness_score < 0.40
    assert res_fake.is_aligned is False


def test_level_1_relevance_cutoff():
    # Setup mock agent with no surviving chunks or low relevance score
    mock_store = MagicMock()
    mock_store.search.return_value = []
    mock_embedder = MagicMock()
    mock_embedder.embed_query.return_value = [0.1] * 768

    mock_llm = MagicMock()
    agent = RAGAgent(
        vector_store=mock_store,
        embedder=mock_embedder,
        llm_client=mock_llm,
        grounded_threshold=0.58,
    )

    res = agent.query(
        question="Как привязать банковскую карту через Google Pay?",
        use_rag=True,
        use_grounded=True,
        grounded_threshold=0.58,
    )

    assert res.grounded_answer is not None
    assert res.grounded_answer.status == "refusal"
    assert res.grounded_answer.is_refusal is True
    assert res.grounded_answer.needs_clarification is True
    assert "недостаточно релевантной информации" in res.grounded_answer.answer or "отсутствуют релевантные" in res.grounded_answer.answer
    assert res.grounded_answer.clarification_prompt is not None
    # Crucial: verify LLM was NEVER called (saved tokens, 0% hallucination)
    mock_llm.chat_completion.assert_not_called()


def test_mock_pipeline_10_questions_benchmark():
    # Test complete 10-question suite in offline mock mode
    client = OpenRouterClient(mock_mode=True)
    mock_store = MagicMock()
    mock_embedder = MagicMock()
    mock_embedder.embed_query.return_value = [0.1] * 768

    def mock_search(vec, top_k=5, filter_source=None):
        from src.storage.vector_store import SearchResult
        from src.chunking.base import Chunk
        rich_content = (
            "object AssetAmountValidator {\n"
            "    fun sanitize(raw: String): String = raw.replace(',', '.')\n"
            "    fun validate(input: String): AssetAmountValidation {\n"
            "        if (input.isBlank()) return AssetAmountValidation.Empty\n"
            "        val num = input.toBigDecimalOrNull() ?: return AssetAmountValidation.InvalidFormat\n"
            "        if (num <= BigDecimal.ZERO) return AssetAmountValidation.NotPositive\n"
            "        return AssetAmountValidation.Valid(num)\n"
            "    }\n"
            "}\n"
            "sealed interface AssetAmountValidation {\n"
            "    data class Valid(val amount: BigDecimal) : AssetAmountValidation\n"
            "    data object Empty : AssetAmountValidation\n"
            "    data object InvalidFormat : AssetAmountValidation\n"
            "    data object NotPositive : AssetAmountValidation\n"
            "}\n"
            "// ADR-017 domain validation\n"
            "@Database(entities = [MarketCoinEntity::class, HoldingEntity::class], version = 1)\n"
            "abstract class CryptoTrackDatabase : RoomDatabase() {\n"
            "    abstract fun marketCoinDao(): MarketCoinDao\n"
            "    abstract fun holdingDao(): HoldingDao\n"
            "    abstract fun favoriteDao(): FavoriteDao\n"
            "    abstract fun coinDetailsDao(): CoinDetailsDao\n"
            "    abstract fun cacheMetaDao(): CacheMetaDao\n"
            "}\n"
            "class PortfolioCalculator {\n"
            "    fun totalValue(): BigDecimal\n"
            "    fun totalPnl(): BigDecimal\n"
            "    fun allocationPercent(): BigDecimal\n"
            "}\n"
            "data class PortfolioPosition(val positionValue: BigDecimal)\n"
            "class RoomConventionPlugin : Plugin<Project> {\n"
            "    // configure schemaDirectory RoomExtension room.generateKotlin room.runtime room.ktx room.compiler\n"
            "}\n"
            "fun ApexBottomBar() {\n"
            "    NavigationBar { NavigationBarItem(TopDestination.Market, TopDestination.Portfolio, TopDestination.Watchlist) }\n"
            "}\n"
            "class ObserveCoinDetailsUseCase(marketRepository: MarketRepository, favoriteRepository: FavoriteRepository, holdingRepository: HoldingRepository) {\n"
            "    fun execute() = combine(marketRepository, favoriteRepository, holdingRepository)\n"
            "}\n"
            "@HiltAndroidApp\n"
            "class CryptoTrackApplication : Application() {\n"
            "    override fun onCreate() { super.onCreate() }\n"
            "}\n"
        )
        return [
            SearchResult(
                chunk=Chunk(
                    chunk_id=f"chunk_{i}",
                    content=rich_content,
                    source="core/data/database/CryptoTrackDatabase.kt",
                    title="CryptoTrackDatabase.kt",
                    section="CryptoTrackDatabase",
                    chunk_index=i,
                    strategy="structural",
                    metadata={"start_line": 1, "end_line": 60},
                ),
                score=0.75,
                rank=i + 1,
            )
            for i in range(top_k)
        ]

    mock_store.search.side_effect = mock_search

    agent = RAGAgent(
        vector_store=mock_store,
        embedder=mock_embedder,
        llm_client=client,
        grounded_threshold=0.50,
    )

    evaluator = GroundedEvaluator(agent)
    summary = evaluator.run_benchmark(
        questions=GROUNDED_BENCHMARK_SUITE,
        top_k=3,
        threshold=0.50,
    )

    assert summary.total_questions == 10
    assert summary.in_domain_count == 7
    assert summary.out_of_domain_count == 3
    assert summary.has_sources_rate == 1.0, "All 7 in-domain questions must have sources"
    assert summary.has_quotes_rate == 1.0, "All 7 in-domain questions must have quotes"
    assert summary.avg_grounding_score >= 0.80, "Quotes must be grounded in chunks"
    assert summary.avg_faithfulness_score >= 0.65, "Answer must align with quotes"
    assert summary.refusal_precision == 1.0, "All 3 adversarial questions must trigger refusal mode"
    assert summary.passed_count == 10, f"Expected 10/10 passed, got {summary.passed_count}"
