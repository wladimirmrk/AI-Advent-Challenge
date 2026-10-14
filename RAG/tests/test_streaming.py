"""Unit tests for streaming model responses across all providers in RAG CLI."""

import time
from typing import List
import pytest

from src.agent.base_llm import StreamChunk
from src.agent.ollama_client import OllamaClient
from src.agent.openrouter_client import OpenRouterClient
from src.agent.rag_agent import (
    RAGAgent,
    RetrievedSource,
    StreamingJsonAnswerExtractor,
)
from src.chat.memory_chat import MemoryChatEngine
from src.chat.models import ChatSession
from src.chat.session_store import SessionStore
from src.config import default_config
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.storage.vector_store import VectorStore


def test_streaming_json_answer_extractor_json():
    """Test extracting only the 'answer' field on-the-fly from JSON streaming chunks."""
    extractor = StreamingJsonAnswerExtractor()
    json_chunks = [
        '{\n',
        '  "status": "grounded",\n',
        '  "answer": "В проекте CryptoTrack ',
        'валидация реализована в классе\\n',
        '`AssetAmountValidator`.\\n\\n',
        'Детали реализации: \\"ok\\"",\n',
        '  "sources": [{"source": "test.kt"}],\n',
        '  "quotes": ["quote 1"]\n',
        '}'
    ]

    emitted = []
    for c in json_chunks:
        out = extractor.process(c)
        if out:
            emitted.append(out)
    flushed = extractor.flush()
    if flushed:
        emitted.append(flushed)

    full_emitted = "".join(emitted)
    assert full_emitted == 'В проекте CryptoTrack валидация реализована в классе\n`AssetAmountValidator`.\n\nДетали реализации: "ok"'
    assert "sources" not in full_emitted
    assert "quotes" not in full_emitted
    assert "status" not in full_emitted


def test_streaming_json_answer_extractor_raw_text():
    """Test passthrough when response is not JSON."""
    extractor = StreamingJsonAnswerExtractor()
    text_chunks = [
        "CryptoTrack — это ",
        "Android-приложение на ",
        "Kotlin и Jetpack Compose."
    ]

    emitted = []
    for c in text_chunks:
        out = extractor.process(c)
        if out:
            emitted.append(out)
    flushed = extractor.flush()
    if flushed:
        emitted.append(flushed)

    full_emitted = "".join(emitted)
    assert full_emitted == "CryptoTrack — это Android-приложение на Kotlin и Jetpack Compose."


def test_ollama_client_stream_generate_mock():
    """Test OllamaClient stream_generate in mock mode."""
    client = OllamaClient(mock_mode=True)
    messages = [{"role": "user", "content": "Что такое CryptoTrack?"}]

    chunks: List[StreamChunk] = list(client.stream_generate(messages=messages))
    assert len(chunks) > 0

    thinking_chunks = [c for c in chunks if c.is_thinking]
    content_chunks = [c for c in chunks if not c.is_thinking and c.delta]
    final_chunk = chunks[-1]

    assert len(content_chunks) > 0
    full_content = "".join(c.delta for c in content_chunks)
    assert "CryptoTrack" in full_content
    assert final_chunk.finish_reason == "stop"
    assert final_chunk.total_tokens > 0


def test_openrouter_client_stream_generate_mock():
    """Test OpenRouterClient stream_generate in mock mode."""
    client = OpenRouterClient(mock_mode=True)
    messages = [{"role": "user", "content": "Расскажи о проекте"}]

    chunks: List[StreamChunk] = list(client.stream_generate(messages=messages))
    assert len(chunks) > 0

    content_chunks = [c for c in chunks if not c.is_thinking and c.delta]
    final_chunk = chunks[-1]

    assert len(content_chunks) > 0
    full_content = "".join(c.delta for c in content_chunks)
    assert len(full_content) > 10
    assert final_chunk.finish_reason == "stop"


def test_rag_agent_stream_query_mock():
    """Test RAGAgent.stream_query end-to-end with mock LLM client."""
    index_dir = default_config.structural_index_dir
    if not (index_dir / "index.faiss").exists():
        pytest.skip("Index not found, skipping mock RAG agent test")

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(base_url=default_config.ollama_base_url, model=default_config.ollama_model)
    client = OpenRouterClient(mock_mode=True)
    agent = RAGAgent(vector_store=store, embedder=embedder, llm_client=client)

    stream_session = agent.stream_query(
        question="Что делает AssetAmountValidator?",
        use_rag=True,
        use_grounded=True,
    )

    assert not stream_session.is_refusal
    assert len(stream_session.sources) > 0

    chunks = list(stream_session.chunks)
    assert len(chunks) > 0

    res = stream_session.get_result()
    assert res is not None
    assert "AssetAmountValidator" in res.answer
    assert res.total_tokens > 0
    assert res.grounded_answer is not None


def test_rag_agent_stream_query_refusal():
    """Test RAGAgent.stream_query level 1 anti-hallucination refusal streaming."""
    index_dir = default_config.structural_index_dir
    if not (index_dir / "index.faiss").exists():
        pytest.skip("Index not found, skipping refusal test")

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(base_url=default_config.ollama_base_url, model=default_config.ollama_model)
    client = OllamaClient(mock_mode=True)
    agent = RAGAgent(vector_store=store, embedder=embedder, llm_client=client)

    # Set threshold very high to force level 1 refusal
    stream_session = agent.stream_query(
        question="Поддерживается ли Apple Pay в CryptoTrack?",
        use_rag=True,
        use_grounded=True,
        grounded_threshold=0.99,
    )

    assert stream_session.is_refusal
    chunks = list(stream_session.chunks)
    assert len(chunks) > 0
    res = stream_session.get_result()
    assert res.grounded_answer.is_refusal


def test_memory_chat_engine_stream_turn(tmp_path):
    """Test MemoryChatEngine.stream_turn live streaming with TaskState."""
    index_dir = default_config.structural_index_dir
    if not (index_dir / "index.faiss").exists():
        pytest.skip("Index not found, skipping memory chat engine test")

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(base_url=default_config.ollama_base_url, model=default_config.ollama_model)
    client = OllamaClient(mock_mode=True)
    agent = RAGAgent(vector_store=store, embedder=embedder, llm_client=client)

    session_store = SessionStore(tmp_path / "sessions")
    session = ChatSession()
    engine = MemoryChatEngine(
        rag_agent=agent,
        session=session,
        session_store=session_store,
        window_size=6,
    )

    stream_turn_session = engine.stream_turn(
        user_question="Какие DAO зарегистрированы в CryptoTrackDatabase?",
        use_rag=True,
    )

    chunks = list(stream_turn_session.chunks)
    assert len(chunks) > 0

    res = stream_turn_session.get_result()
    assert res is not None
    assert len(res.answer) > 10
    assert "{" not in res.answer[:5]  # clean unmarshalled text without raw JSON
    assert session.task_state.turn_number == 1
    assert len(session.messages) == 2
