"""Tests for Day 29: Local LLM Optimization (parameters, quantization, coding prompt, comparator)."""

import pytest
from unittest.mock import MagicMock

from src.agent.base_llm import LLMResponse
from src.agent.ollama_client import OllamaClient
from src.agent.rag_agent import RAGAgent, RetrievedSource
from src.evaluation.grounded_evaluator import GroundedEvalQuestion
from src.evaluation.optimizer_comparator import (
    OptimizationRunResult,
    OptimizationSummary,
    OptimizerComparator,
    QuestionOptimizationComparison,
)


class TestOllamaOptimizationParams:
    def test_extract_ollama_metrics(self):
        client = OllamaClient(mock_mode=True)
        raw_body = {
            "model": "qwen3:8b",
            "message": {"role": "assistant", "content": "class Test"},
            "prompt_eval_count": 250,
            "eval_count": 50,
            "prompt_eval_duration": 500_000_000,  # 0.5 sec
            "eval_duration": 2_000_000_000,       # 2.0 sec -> 25 tokens/sec
        }
        resp = client._extract_ollama_metrics(raw_body, base_duration=2.5)
        assert resp["prompt_eval_duration_seconds"] == 0.5
        assert resp["eval_duration_seconds"] == 2.0
        assert resp["tokens_per_second"] == 25.0

    def test_generate_with_optimization_params(self):
        client = OllamaClient(mock_mode=True)
        messages = [{"role": "user", "content": "How to validate an amount?"}]
        resp = client.generate(
            messages=messages,
            temperature=0.15,
            max_tokens=256,
            num_ctx=4096,
        )
        assert isinstance(resp, LLMResponse)
        assert resp.is_mock is True
        assert resp.num_ctx == 4096


class TestCodingOptimizedPrompt:
    def test_build_coding_optimized_prompt(self):
        sources = [
            RetrievedSource(
                source="feature/assetentry/domain/AssetAmountValidator.kt",
                section="AssetAmountValidator",
                start_line=1,
                end_line=25,
                content="object AssetAmountValidator { fun validate(v: String): Boolean = v.isNotEmpty() }",
                score=0.92,
                rank=1,
            )
        ]
        messages = RAGAgent.build_coding_optimized_prompt(
            question="Как работает AssetAmountValidator?",
            sources=sources,
        )
        assert len(messages) == 2
        sys_msg = messages[0]["content"]
        user_msg = messages[1]["content"]

        assert "технический ассистент по кодовой базе CryptoTrack" in sys_msg
        assert "ЗАПРЕЩЕНЫ вступительные фразы" in sys_msg
        assert "КОНТЕКСТ КОДОВОЙ БАЗЫ" in user_msg
        assert "AssetAmountValidator.kt" in user_msg
        assert "ВОПРОС: Как работает AssetAmountValidator?" in user_msg

    def test_rag_agent_query_with_coding_prompt_mode(self):
        mock_store = MagicMock()
        mock_embedder = MagicMock()
        mock_client = OllamaClient(mock_mode=True)

        agent = RAGAgent(
            vector_store=mock_store,
            embedder=mock_embedder,
            llm_client=mock_client,
        )

        mock_result = MagicMock()
        mock_result.chunk.source = "AssetAmountValidator.kt"
        mock_result.chunk.section = "validate"
        mock_result.chunk.start_line = 1
        mock_result.chunk.end_line = 10
        mock_result.chunk.content = "fun validate(amount: String)"
        mock_result.score = 0.9

        mock_store.search.return_value = [mock_result]
        mock_embedder.embed_query.return_value = [0.1] * 768

        res = agent.query(
            question="Как валидировать сумму?",
            prompt_mode="coding_optimized",
            temperature=0.15,
            max_tokens=256,
            num_ctx=4096,
            use_rewrite=False,
            use_rerank=False,
        )
        assert res.answer is not None
        assert res.use_rag is True


class TestOptimizerComparator:
    def test_kv_cache_ram_estimation(self):
        comparator = OptimizerComparator()
        # 40960 ctx for 8B model (32 layers * 4096 * 2 bytes)
        ram_baseline = comparator.estimate_kv_cache_ram(40960, 8.0)
        # 4096 ctx for 8B model
        ram_optimized = comparator.estimate_kv_cache_ram(4096, 8.0)
        # 2048 ctx for 1B model
        ram_quantized = comparator.estimate_kv_cache_ram(2048, 1.0)

        assert ram_baseline > 5000  # ~10240 MB or ~5120 MB depending on heads
        assert ram_optimized < 1200
        assert ram_quantized <= 150
        assert ram_optimized < ram_baseline

    def test_comparator_benchmark_with_mock_rag(self):
        mock_store = MagicMock()
        mock_embedder = MagicMock()
        mock_client = OllamaClient(mock_mode=True)

        rag_agent = RAGAgent(
            vector_store=mock_store,
            embedder=mock_embedder,
            llm_client=mock_client,
        )

        mock_result = MagicMock()
        mock_result.chunk.source = "AssetAmountValidator.kt"
        mock_result.chunk.section = "validate"
        mock_result.chunk.start_line = 1
        mock_result.chunk.end_line = 10
        mock_result.chunk.content = "fun validate(amount: String)"
        mock_result.score = 0.9

        mock_store.search.return_value = [mock_result]
        mock_embedder.embed_query.return_value = [0.1] * 768

        comparator = OptimizerComparator()

        questions = [
            GroundedEvalQuestion(
                id=1,
                category="Validation",
                question="Как валидируется введённая сумма актива?",
                is_in_domain=True,
                expected_refusal=False,
                expected_sources=["AssetAmountValidator.kt"],
            )
        ]

        results, summary = comparator.run_benchmark(
            rag_agent=rag_agent,
            questions=questions,
            baseline_model="qwen3:8b",
            optimized_model="qwen3:8b",
            quantized_model="tinyllama:latest",
        )

        assert len(results) == 1
        assert summary.total_questions == 1
        assert summary.baseline_model == "qwen3:8b"
        assert summary.optimized_model == "qwen3:8b"
        assert summary.ram_reduction_percent > 0

        report_md = comparator.generate_markdown_report(results, summary)
        assert "# 🔥 Отчёт: День 29. Оптимизация локальной LLM под задачу кодинга" in report_md
        assert "Сводная таблица метрик: До и После оптимизации" in report_md
        assert "AssetAmountValidator.kt" in report_md
