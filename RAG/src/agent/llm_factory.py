"""Factory and discovery utilities for LLM clients (Day 28)."""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from src.agent.base_llm import BaseLLMClient
from src.agent.ollama_client import OllamaClient
from src.agent.openrouter_client import OpenRouterClient
from src.config import default_config

logger = logging.getLogger(__name__)


def create_llm_client(
    provider: str = "ollama",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    mock_mode: bool = False,
    timeout: Optional[int] = None,
    base_url: Optional[str] = None,
) -> BaseLLMClient:
    """Instantiate and return the appropriate LLM client for the requested provider."""
    normalized_provider = (provider or "ollama").strip().lower()

    if normalized_provider in {"ollama", "local"}:
        target_model = model or default_config.ollama_chat_model
        target_base_url = base_url or default_config.ollama_base_url
        target_timeout = timeout if timeout is not None else default_config.ollama_timeout

        return OllamaClient(
            base_url=target_base_url,
            default_model=target_model,
            timeout=target_timeout,
            mock_mode=mock_mode,
        )

    elif normalized_provider in {"openrouter", "cloud"}:
        target_model = model or default_config.openrouter_model
        target_base_url = base_url or default_config.openrouter_base_url
        target_timeout = timeout or default_config.openrouter_timeout
        target_key = api_key or default_config.openrouter_api_key

        return OpenRouterClient(
            api_key=target_key,
            base_url=target_base_url,
            default_model=target_model,
            timeout=target_timeout,
            mock_mode=mock_mode,
        )

    else:
        raise ValueError(
            f"Неизвестный провайдер моделей: '{provider}'. Поддерживаются: 'ollama' (локальный), 'openrouter' (облачный)."
        )


def detect_provider_from_model(model_name: str) -> str:
    """Infer provider by model naming convention (e.g. 'nvidia/...' -> openrouter, 'qwen3:8b' -> ollama)."""
    if "/" in model_name:
        return "openrouter"
    return "ollama"
