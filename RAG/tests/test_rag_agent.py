from unittest.mock import MagicMock, patch
import pytest

from src.agent.openrouter_client import OpenRouterClient, OpenRouterError, OpenRouterResponse
from src.agent.rag_agent import RAGAgent, RAGResult, RetrievedSource
from src.evaluation.benchmark_dataset import BENCHMARK_QUESTIONS, BenchmarkQuestion
from src.evaluation.rag_evaluator import RAGEvaluator
from src.storage.vector_store import Chunk, SearchResult


def test_openrouter_client_unconfigured():
    client = OpenRouterClient(api_key="")
    assert not client.is_configured()
    with pytest.raises(OpenRouterError) as exc_info:
        client.chat_completion([{"role": "user", "content": "hi"}])
    assert exc_info.value.status_code == 401


@patch("src.agent.openrouter_client.requests.post")
def test_openrouter_client_success(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "choices": [
            {
                "message": {"content": "Sample response text"},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
        },
    }
    mock_post.return_value = mock_resp

    client = OpenRouterClient(api_key="test-key")
    resp = client.chat_completion([{"role": "user", "content": "hello"}])

    assert resp.content == "Sample response text"
    assert resp.prompt_tokens == 100
    assert resp.completion_tokens == 50
    assert resp.total_tokens == 150
    assert resp.model == "nvidia/nemotron-3-ultra-550b-a55b:free"


@patch("src.agent.openrouter_client.requests.post")
def test_openrouter_client_auth_error(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.json.return_value = {"error": {"message": "Invalid API key"}}
    mock_post.return_value = mock_resp

    client = OpenRouterClient(api_key="bad-key")
    with pytest.raises(OpenRouterError) as exc_info:
        client.chat_completion([{"role": "user", "content": "hello"}])
    assert exc_info.value.status_code == 401
    assert "Invalid API key" in str(exc_info.value)


def test_rag_agent_prompt_construction():
    mock_store = MagicMock()
    mock_embedder = MagicMock()
    mock_llm = MagicMock()

    agent = RAGAgent(vector_store=mock_store, embedder=mock_embedder, llm_client=mock_llm)

    source = RetrievedSource(
        rank=1,
        score=0.92,
        source="feature/assetentry/domain/AssetAmountValidator.kt",
        section="fun validate",
        start_line=15,
        end_line=30,
        content="fun validate(raw: String): AssetAmountValidation",
    )

    assert source.citation == "[Source: feature/assetentry/domain/AssetAmountValidator.kt:L15-L30]"

    rag_messages = agent.build_rag_prompt("Как валидировать?", [source])
    assert len(rag_messages) == 2
    assert "КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ" in rag_messages[1]["content"]
    assert "AssetAmountValidator.kt" in rag_messages[1]["content"]

    no_rag_messages = agent.build_no_rag_prompt("Как валидировать?")
    assert len(no_rag_messages) == 2
    assert "КОНТЕКСТ" not in no_rag_messages[1]["content"]
    assert no_rag_messages[1]["content"] == "Как валидировать?"


def test_rag_agent_query_execution():
    mock_store = MagicMock()
    mock_embedder = MagicMock()
    mock_llm = MagicMock()

    chunk = Chunk(
        chunk_id="c1",
        content="fun validate() = true",
        source="domain/AssetAmountValidator.kt",
        title="AssetAmountValidator.kt",
        section="fun validate",
        chunk_index=0,
        strategy="structural",
        metadata={"start_line": 10, "end_line": 20},
    )
    mock_store.search.return_value = [SearchResult(rank=1, score=0.89, chunk=chunk)]
    mock_embedder.embed_query.return_value = [0.1] * 768

    mock_llm.chat_completion.return_value = OpenRouterResponse(
        content="Ответ: [Source: domain/AssetAmountValidator.kt:L10-L20]",
        model="test-model",
        prompt_tokens=80,
        completion_tokens=40,
        total_tokens=120,
        latency_seconds=0.5,
    )

    agent = RAGAgent(vector_store=mock_store, embedder=mock_embedder, llm_client=mock_llm)

    # 1. RAG query
    res_rag = agent.query("Проверка валидации", use_rag=True)
    assert res_rag.use_rag is True
    assert len(res_rag.sources) == 1
    assert res_rag.sources[0].source == "domain/AssetAmountValidator.kt"
    assert "Source:" in res_rag.answer
    assert mock_store.search.called

    # 2. No-RAG query
    mock_store.search.reset_mock()
    res_no_rag = agent.query("Проверка валидации", use_rag=False)
    assert res_no_rag.use_rag is False
    assert len(res_no_rag.sources) == 0
    assert not mock_store.search.called


def test_benchmark_dataset_integrity():
    assert len(BENCHMARK_QUESTIONS) == 10
    for q in BENCHMARK_QUESTIONS:
        assert q.id >= 1
        assert len(q.category) > 0
        assert len(q.question) > 0
        assert len(q.expectation) > 0
        assert len(q.expected_sources) > 0
        assert len(q.key_entities) > 0


def test_rag_evaluator_metrics_and_report():
    mock_store = MagicMock()
    mock_embedder = MagicMock()
    mock_llm = MagicMock()

    agent = RAGAgent(vector_store=mock_store, embedder=mock_embedder, llm_client=mock_llm)
    evaluator = RAGEvaluator(agent=agent)

    test_bq = BenchmarkQuestion(
        id=1,
        category="Test Category",
        question="Тестовый вопрос?",
        expectation="Ожидается AssetAmountValidator и sanitize()",
        expected_sources=["feature/assetentry/domain/AssetAmountValidator.kt"],
        key_entities=["AssetAmountValidator", "sanitize", "validate"],
    )

    # Mock agent.query for no-rag (generic answer without target entities)
    # and for rag (answer containing target entities + citation)
    def fake_query(question, use_rag=True, **kwargs):
        if use_rag:
            src = RetrievedSource(
                rank=1,
                score=0.91,
                source="feature/assetentry/domain/AssetAmountValidator.kt",
                section="class AssetAmountValidator",
                start_line=1,
                end_line=20,
                content="object AssetAmountValidator { fun sanitize() ... fun validate() }",
            )
            return RAGResult(
                question=question,
                answer="В проекте используется AssetAmountValidator, функции sanitize и validate. [Source: feature/assetentry/domain/AssetAmountValidator.kt:L1-L20]",
                use_rag=True,
                sources=[src],
                model="test-model",
                total_tokens=200,
                latency_seconds=0.6,
            )
        else:
            return RAGResult(
                question=question,
                answer="Обычно в Android валидацию делают через кастомные функции или регулярные выражения.",
                use_rag=False,
                sources=[],
                model="test-model",
                total_tokens=50,
                latency_seconds=0.2,
            )

    agent.query = MagicMock(side_effect=fake_query)

    res = evaluator.evaluate_question(test_bq)
    assert res.source_recall == 1.0
    assert res.entity_coverage_no_rag == 0.0
    assert res.entity_coverage_rag == 1.0
    assert res.citations_present is True
    assert "превосходит" in res.verdict

    summary = evaluator.run_benchmark(questions=[test_bq])
    assert summary.total_questions == 1
    assert summary.mean_entity_cov_no_rag == 0.0
    assert summary.mean_entity_cov_rag == 1.0
    assert summary.citation_compliance_rate == 1.0

    report = evaluator.generate_markdown_report(summary, model_name="test-model")
    assert "# Отчет сравнительного анализа" in report
    assert "AssetAmountValidator" in report
    assert "Source Recall" in report
