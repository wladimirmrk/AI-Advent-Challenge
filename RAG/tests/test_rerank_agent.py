from unittest.mock import MagicMock, patch
import pytest

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.rag_agent import RAGAgent, RetrievedSource
from src.agent.query_rewriter import QueryRewriter
from src.chunking.base import Chunk
from src.evaluation.benchmark_dataset import BenchmarkQuestion
from src.evaluation.rerank_evaluator import RerankEvaluator
from src.reranking.cross_encoder_reranker import CrossEncoderReranker
from src.reranking.relevance_filter import RelevanceFilter
from src.reranking.pipeline import TwoStageRetrievalPipeline
from src.storage.vector_store import SearchResult, VectorStore


@pytest.fixture
def sample_agent():
    mock_store = MagicMock()
    mock_embedder = MagicMock()
    mock_embedder.embed_query.return_value = [0.1] * 768

    # Create mock chunks
    c1 = Chunk(chunk_id="c1", content="class CryptoDatabase: RoomDatabase()", source="data/local/CryptoDatabase.kt", title="CryptoDatabase", section="CryptoDatabase", chunk_index=0, strategy="structural")
    c2 = Chunk(chunk_id="c2", content="interface CryptoDao", source="data/local/CryptoDao.kt", title="CryptoDao", section="CryptoDao", chunk_index=0, strategy="structural")
    c3 = Chunk(chunk_id="c3", content="class MockTest", source="test/MockTest.kt", title="MockTest", section="MockTest", chunk_index=0, strategy="structural")

    # Search returns 3 chunks with different cosine similarities
    mock_store.search.return_value = [
        SearchResult(chunk=c1, score=0.82, rank=1),
        SearchResult(chunk=c2, score=0.74, rank=2),
        SearchResult(chunk=c3, score=0.35, rank=3),
    ]

    mock_llm = MagicMock()
    mock_llm.chat_completion.return_value = OpenRouterResponse(
        content="Используется [Source: data/local/CryptoDatabase.kt:L1-L20] для RoomDatabase.",
        model="mock-model",
        prompt_tokens=100,
        completion_tokens=40,
        total_tokens=140,
        latency_seconds=0.25,
    )

    rewriter = QueryRewriter(llm_client=None, enabled=True)
    reranker = CrossEncoderReranker(use_fallback_only=True)
    rf = RelevanceFilter(default_threshold=0.45)
    pipeline = TwoStageRetrievalPipeline(relevance_filter=rf, reranker=reranker, default_threshold=0.45, default_final_top_k=2)

    agent = RAGAgent(
        vector_store=mock_store,
        embedder=mock_embedder,
        llm_client=mock_llm,
        default_top_k=2,
        query_rewriter=rewriter,
        rerank_pipeline=pipeline,
        initial_top_k=10,
        similarity_threshold=0.45,
    )
    return agent


def test_agent_query_baseline(sample_agent):
    res = sample_agent.query(
        question="Как устроена база Room?",
        use_rag=True,
        use_rewrite=False,
        use_rerank=False,
        top_k=2,
    )
    assert res.use_rag
    assert res.rewritten_query is None
    assert res.pipeline_result is None
    assert len(res.sources) <= 2
    assert "[Source:" in res.answer


def test_agent_query_rewrite_only(sample_agent):
    res = sample_agent.query(
        question="Как устроена база Room?",
        use_rag=True,
        use_rewrite=True,
        use_rerank=False,
        top_k=2,
    )
    assert res.use_rag
    assert res.rewritten_query is not None
    assert res.pipeline_result is None


def test_agent_query_enhanced_mode(sample_agent):
    res = sample_agent.query(
        question="Как устроена база Room?",
        use_rag=True,
        use_rewrite=True,
        use_rerank=True,
        top_k=2,
        similarity_threshold=0.45,
    )
    assert res.use_rag
    assert res.rewritten_query is not None
    assert res.pipeline_result is not None
    # Chunk c3 has score 0.35, which is < 0.45, so it should be dropped
    assert res.dropped_by_filter_count >= 1
    assert len(res.sources) == 2
    for s in res.sources:
        assert s.rerank_score is not None


def test_rerank_evaluator_question(sample_agent):
    evaluator = RerankEvaluator(agent=sample_agent)
    bq = BenchmarkQuestion(
        id=1,
        category="Architecture",
        question="Как устроен Room в CryptoTrack?",
        expected_sources=["CryptoDatabase.kt", "CryptoDao.kt"],
        key_entities=["RoomDatabase", "CryptoDao"],
        expectation="",
    )

    q_res = evaluator.evaluate_question(bq, top_k=2, initial_top_k=10, threshold=0.45)
    assert q_res.recall_enhanced >= 0.5
    assert q_res.citations_enhanced
    assert q_res.initial_candidates > 0
    assert q_res.dropped_candidates >= 1
    assert q_res.noise_reduction_pct > 0.0
