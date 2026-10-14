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
    prompt_eval_duration_seconds: float = 0.0
    eval_duration_seconds: float = 0.0
    tokens_per_second: float = 0.0
    num_ctx: Optional[int] = None


@dataclass
class StreamChunk:
    """Incremental chunk emitted during LLM streaming."""
    delta: str = ""                       # Content delta token
    thinking_delta: str = ""              # Reasoning / thinking delta token
    is_thinking: bool = False             # True if chunk belongs to reasoning/thinking
    finish_reason: Optional[str] = None   # "stop", "length", None
    model: str = ""                       # Model identifier
    provider: str = ""                    # Provider identifier
    prompt_tokens: int = 0                # Prompt tokens if known at chunk arrival
    completion_tokens: int = 0            # Completion tokens if known
    total_tokens: int = 0                 # Total tokens if known
    raw_chunk: Dict[str, Any] = field(default_factory=dict)


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
        num_ctx: Optional[int] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """Send chat messages and return a normalized LLMResponse."""
        pass

    @abstractmethod
    def stream_generate(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None,
        num_ctx: Optional[int] = None,
        **kwargs: Any,
    ):
        """Stream chat messages and yield StreamChunk increments."""
        pass

    def stream_chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None,
    ):
        """Compatibility alias for stream_generate."""
        return self.stream_generate(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
        )

    @abstractmethod
    def list_models(self) -> List[str]:
        """Return a list of available models for this provider."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if client is configured and ready to execute requests."""
        pass
