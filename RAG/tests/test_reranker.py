import pytest
from src.agent.rag_agent import RetrievedSource
from src.reranking.relevance_filter import RelevanceFilter
from src.reranking.cross_encoder_reranker import CrossEncoderReranker, FallbackCrossEncoder
from src.reranking.pipeline import TwoStageRetrievalPipeline


def make_sample_source(rank: int, score: float, source: str, section: str, content: str) -> RetrievedSource:
    return RetrievedSource(
        rank=rank,
        score=score,
        source=source,
        section=section,
        start_line=1,
        end_line=20,
        content=content,
    )


def test_relevance_filter_basic():
    rf = RelevanceFilter(default_threshold=0.50)
    sources = [
        make_sample_source(1, 0.75, "app/data/CryptoDao.kt", "CryptoDao", "interface CryptoDao"),
        make_sample_source(2, 0.52, "app/data/CryptoDb.kt", "CryptoDb", "abstract class CryptoDb"),
        make_sample_source(3, 0.41, "app/test/FakeTest.kt", "FakeTest", "class FakeTest"),
        make_sample_source(4, 0.30, "build.gradle.kts", "root", "plugins { id(...) }"),
    ]

    res = rf.filter(sources, threshold=0.50)
    assert res.initial_count == 4
    assert res.kept_count == 2
    assert res.dropped_count == 2
    assert not res.fall_soft_triggered
    assert len(res.kept_sources) == 2
    assert res.kept_sources[0].source == "app/data/CryptoDao.kt"
    assert res.kept_sources[1].source == "app/data/CryptoDb.kt"


def test_relevance_filter_fall_soft():
    rf = RelevanceFilter(default_threshold=0.60, min_retained=1)
    sources = [
        make_sample_source(1, 0.40, "app/A.kt", "A", "class A"),
        make_sample_source(2, 0.35, "app/B.kt", "B", "class B"),
    ]

    res = rf.filter(sources, threshold=0.60)
    assert res.fall_soft_triggered
    assert res.kept_count == 1
    assert res.kept_sources[0].source == "app/A.kt"
    assert res.dropped_count == 1


def test_fallback_cross_encoder_scoring():
    fbe = FallbackCrossEncoder()
    query = "CryptoPriceDao Room database query"
    match_content = "@Dao interface CryptoPriceDao { @Query('SELECT * FROM crypto_prices') fun getAll(): Flow<List<CryptoPriceEntity>> }"
    noise_content = "class ColorPalette { val Primary = Color(0xFF00FF00) }"

    score_match = fbe.score_pair(query, match_content, source_path="data/CryptoPriceDao.kt", section="CryptoPriceDao")
    score_noise = fbe.score_pair(query, noise_content, source_path="ui/theme/Color.kt", section="ColorPalette")

    assert score_match > score_noise
    assert score_match > 0.50


def test_cross_encoder_reranker_ordering():
    reranker = CrossEncoderReranker(use_fallback_only=True)
    query = "Hilt DatabaseModule provides RoomDatabase"

    sources = [
        make_sample_source(1, 0.65, "ui/screen/HomeScreen.kt", "HomeScreen", "@Composable fun HomeScreen()"),
        make_sample_source(2, 0.60, "di/DatabaseModule.kt", "DatabaseModule", "@Module @InstallIn(SingletonComponent::class) object DatabaseModule { @Provides fun provideDatabase(): AppDatabase }"),
        make_sample_source(3, 0.58, "data/model/Coin.kt", "Coin", "data class Coin(val id: String)"),
    ]

    res = reranker.rerank(query=query, sources=sources, top_k=2)
    assert res.final_count == 2
    # The di/DatabaseModule should be ranked #1 after reranking
    assert res.sources[0].source == "di/DatabaseModule.kt"
    assert res.sources[0].rank == 1
    assert res.sources[0].rerank_score is not None
    assert res.sources[1].rank == 2


def test_two_stage_retrieval_pipeline():
    pipeline = TwoStageRetrievalPipeline(default_threshold=0.45, default_final_top_k=2)
    query = "CryptoRepositoryImpl getPrices"

    candidates = [
        make_sample_source(1, 0.70, "data/repo/CryptoRepositoryImpl.kt", "CryptoRepositoryImpl", "class CryptoRepositoryImpl: CryptoRepository { override fun getPrices() = flow { } }"),
        make_sample_source(2, 0.65, "domain/repo/CryptoRepository.kt", "CryptoRepository", "interface CryptoRepository { fun getPrices(): Flow<List<Price>> }"),
        make_sample_source(3, 0.40, "test/FakeRepository.kt", "FakeRepository", "class FakeRepository"), # below threshold (0.45)
        make_sample_source(4, 0.30, "ui/theme/Type.kt", "Type", "val Typography = Typography()"),     # below threshold (0.45)
    ]

    p_res = pipeline.process(query=query, candidates=candidates, threshold=0.45, final_top_k=2)
    assert p_res.initial_count == 4
    assert p_res.after_filter_count == 2
    assert p_res.dropped_by_filter == 2
    assert p_res.final_count == 2
    assert not p_res.fall_soft_triggered
    assert p_res.final_sources[0].source in ["data/repo/CryptoRepositoryImpl.kt", "domain/repo/CryptoRepository.kt"]
