"""Tests for Day 28: Local LLM (Ollama) + RAG pipeline and model comparison."""

import pytest
from unittest.mock import MagicMock, patch

from src.agent.base_llm import BaseLLMClient, LLMResponse
from src.agent.llm_factory import create_llm_client, detect_provider_from_model
from src.agent.ollama_client import OllamaClient, OllamaError
from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.agent.rag_agent import RAGAgent, RetrievedSource
from src.chat.memory_chat import MemoryChatEngine
from src.chat.models import ChatSession
from src.evaluation.grounded_evaluator import GroundedEvalQuestion
from src.evaluation.model_comparator import ModelComparator, SingleModelRun


class TestOllamaClient:
    def test_init_and_config(self):
        client = OllamaClient(
            base_url="http://localhost:11434",
            default_model="qwen3:8b",
            mock_mode=True,
        )
        assert client.provider == "ollama"
        assert client.default_model == "qwen3:8b"
        assert client.is_configured() is True
        assert "qwen3:8b" in client.list_models()

    def test_extract_thinking(self):
        client = OllamaClient(mock_mode=True)
        raw_text = "<think>\nThinking about CryptoTrack database architecture...\n</think>\nОтвет: RoomDatabase"
        clean, thinking = client._extract_thinking(raw_text)

        assert clean == "Ответ: RoomDatabase"
        assert thinking == "Thinking about CryptoTrack database architecture..."

    def test_extract_thinking_none(self):
        client = OllamaClient(mock_mode=True)
        raw_text = "Обычный ответ без рассуждений"
        clean, thinking = client._extract_thinking(raw_text)

        assert clean == raw_text
        assert thinking is None

    def test_mock_generation(self):
        client = OllamaClient(mock_mode=True)
        messages = [
            {"role": "system", "content": "RAG Assistant"},
            {"role": "user", "content": "КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:\n### Источник #1: `AssetAmountValidator.kt`\nВОПРОС: Как работает валидация?"},
        ]
        resp: LLMResponse = client.generate(messages)

        assert isinstance(resp, LLMResponse)
        assert resp.provider == "ollama"
        assert resp.is_mock is True
        assert resp.prompt_tokens > 0
        assert resp.completion_tokens > 0
        assert "[Source: AssetAmountValidator.kt" in resp.content
        assert resp.thinking_content is not None


class TestLLMFactory:
    def test_create_ollama_client(self):
        client = create_llm_client(provider="ollama", model="qwen3:8b", mock_mode=True)
        assert isinstance(client, OllamaClient)
        assert client.provider == "ollama"
        assert client.default_model == "qwen3:8b"

    def test_create_openrouter_client(self):
        client = create_llm_client(provider="openrouter", model="nvidia/nemotron-3.5-lightning:free", mock_mode=True)
        assert isinstance(client, OpenRouterClient)
        assert client.provider == "openrouter"

    def test_invalid_provider_raises(self):
        with pytest.raises(ValueError, match="Неизвестный провайдер"):
            create_llm_client(provider="unknown_provider")

    def test_detect_provider_from_model(self):
        assert detect_provider_from_model("nvidia/nemotron-3.5-lightning:free") == "openrouter"
        assert detect_provider_from_model("meta-llama/llama-3.3-70b-instruct") == "openrouter"
        assert detect_provider_from_model("qwen3:8b") == "ollama"
        assert detect_provider_from_model("tinyllama:latest") == "ollama"


class TestRAGWithLocalLLM:
    def test_rag_agent_with_local_llm(self):
        mock_store = MagicMock()
        mock_embedder = MagicMock()
        local_client = OllamaClient(mock_mode=True)

        agent = RAGAgent(
            vector_store=mock_store,
            embedder=mock_embedder,
            llm_client=local_client,
        )

        assert agent.llm_client.provider == "ollama"

        # Mock vector search
        mock_result = MagicMock()
        mock_result.chunk.source = "core/data/database/CryptoTrackDatabase.kt"
        mock_result.chunk.section = "CryptoTrackDatabase"
        mock_result.chunk.start_line = 10
        mock_result.chunk.end_line = 30
        mock_result.chunk.content = "abstract class CryptoTrackDatabase : RoomDatabase()"
        mock_result.score = 0.85

        mock_store.search.return_value = [mock_result]
        mock_embedder.embed_query.return_value = [0.1] * 768

        res = agent.query(
            question="Какие DAO зарегистрированы в CryptoTrackDatabase?",
            use_rag=True,
            use_rewrite=False,
            use_rerank=False,
        )

        assert res.use_rag is True
        assert len(res.sources) == 1
        assert "[Source: core/data/database/CryptoTrackDatabase.kt" in res.answer
        assert res.total_tokens > 0

    def test_memory_chat_with_local_llm(self):
        mock_store = MagicMock()
        mock_embedder = MagicMock()
        local_client = OllamaClient(mock_mode=True)

        agent = RAGAgent(
            vector_store=mock_store,
            embedder=mock_embedder,
            llm_client=local_client,
        )

        session = ChatSession()
        engine = MemoryChatEngine(rag_agent=agent, session=session)

        mock_result = MagicMock()
        mock_result.chunk.source = "CryptoTrackDatabase.kt"
        mock_result.chunk.section = "CryptoTrackDatabase"
        mock_result.chunk.start_line = 5
        mock_result.chunk.end_line = 25
        mock_result.chunk.content = "RoomDatabase entities"
        mock_result.score = 0.9

        mock_store.search.return_value = [mock_result]
        mock_embedder.embed_query.return_value = [0.1] * 768

        turn = engine.process_turn(
            user_question="Опиши архитектуру базы данных",
            use_rag=True,
            use_rewrite=False,
            use_rerank=False,
        )

        assert turn.answer is not None
        assert len(session.messages) == 2
        assert session.task_state.turn_number == 1


class TestModelComparator:
    def test_comparator_execution(self):
        mock_store = MagicMock()
        mock_embedder = MagicMock()

        local_client = OllamaClient(mock_mode=True)
        cloud_client = OpenRouterClient(mock_mode=True)

        local_agent = RAGAgent(vector_store=mock_store, embedder=mock_embedder, llm_client=local_client)
        cloud_agent = RAGAgent(vector_store=mock_store, embedder=mock_embedder, llm_client=cloud_client)

        mock_result = MagicMock()
        mock_result.chunk.source = "feature/assetentry/domain/AssetAmountValidator.kt"
        mock_result.chunk.section = "AssetAmountValidator"
        mock_result.chunk.start_line = 1
        mock_result.chunk.end_line = 20
        mock_result.chunk.content = "object AssetAmountValidator"
        mock_result.score = 0.95

        mock_store.search.return_value = [mock_result]
        mock_embedder.embed_query.return_value = [0.1] * 768

        comparator = ModelComparator()
        test_questions = [
            GroundedEvalQuestion(
                id=1,
                category="Validation",
                question="Как в объекте AssetAmountValidator реализована валидация?",
                is_in_domain=True,
                expected_refusal=False,
                expected_sources=["AssetAmountValidator.kt"],
            ),
        ]

        summary, comparisons = comparator.compare(
            local_agent=local_agent,
            cloud_agent=cloud_agent,
            suite=test_questions,
            limit=1,
        )

        assert summary.total_questions == 1
        assert summary.local_success_rate == 100.0
        assert summary.cloud_success_rate == 100.0
        assert len(comparisons) == 1

        md_report = comparator.generate_markdown_report(summary, comparisons)
        assert "# 🔥 Отчёт сравнения: Локальная LLM + RAG против Облачной LLM" in md_report
        assert "AssetAmountValidator" in md_report
