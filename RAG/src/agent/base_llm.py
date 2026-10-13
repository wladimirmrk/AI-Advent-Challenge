from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class LLMResponse:
    """Unified response object returned by all LLM clients."""
    content: str
    model: str
    provider: str = "unknown"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_seconds: float = 0.0
    finish_reason: str = "stop"
    raw_response: Dict[str, Any] = field(default_factory=dict)
    is_mock: bool = False
    thinking_content: Optional[str] = None


class BaseLLMClient(ABC):
    """Abstract base interface for LLM providers (Ollama, OpenRouter, etc.)."""

    provider: str
    default_model: str

    @abstractmethod
    def generate(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> LLMResponse:
        """Send chat messages and return a normalized LLMResponse."""
        pass

    @abstractmethod
    def list_models(self) -> List[str]:
        """Return a list of available models for this provider."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if client is configured and ready to execute requests."""
        pass
