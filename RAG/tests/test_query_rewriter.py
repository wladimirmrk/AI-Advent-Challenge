from unittest.mock import MagicMock
import pytest

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.query_rewriter import QueryRewriter, QueryRewriteResult


def test_query_rewriter_disabled():
    rewriter = QueryRewriter(enabled=False)
    res = rewriter.rewrite("Как устроен Room в CryptoTrack?")
    assert res.original_query == "Как устроен Room в CryptoTrack?"
    assert res.rewritten_query == "Как устроен Room в CryptoTrack?"
    assert not res.is_rewritten
    assert res.method == "disabled"


def test_query_rewriter_heuristic_expansion():
    rewriter = QueryRewriter(llm_client=None, enabled=True)
    res = rewriter.rewrite("Как реализована база данных Room и Dao для CryptoPrice?")
    assert res.is_rewritten
    assert res.method == "heuristic"
    # Should contain key symbols
    assert "Room" in res.rewritten_query or "RoomDatabase" in res.rewritten_query
    assert "Dao" in res.rewritten_query
    assert "CryptoPrice" in res.rewritten_query


def test_query_rewriter_llm_success():
    mock_llm = MagicMock()
    mock_llm.chat_completion.return_value = OpenRouterResponse(
        content="CryptoDatabase RoomDao CryptoPriceEntity Room",
        model="test-model",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        latency_seconds=0.1,
    )

    rewriter = QueryRewriter(llm_client=mock_llm, enabled=True)
    res = rewriter.rewrite("Расскажи про базу данных")
    assert res.is_rewritten
    assert res.method == "llm"
    assert "CryptoPriceEntity" in res.rewritten_query
    mock_llm.chat_completion.assert_called_once()


def test_query_rewriter_llm_fallback_on_exception():
    mock_llm = MagicMock()
    mock_llm.chat_completion.side_effect = RuntimeError("OpenRouter timeout")

    rewriter = QueryRewriter(llm_client=mock_llm, enabled=True)
    res = rewriter.rewrite("Где объявлен CryptoPriceDao?")
    assert res.is_rewritten
    assert res.method == "heuristic"
    assert "CryptoPriceDao" in res.rewritten_query
