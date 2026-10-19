"""Configuration settings for the code-review CLI tool."""

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Optional


CODE_REVIEW_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CODE_REVIEW_DIR.parent
RAG_DIR = PROJECT_ROOT / "RAG"


def load_env_candidates():
    """Load environment variables from candidates (.env files)."""
    candidates = [
        CODE_REVIEW_DIR / ".env",
        RAG_DIR / ".env",
        PROJECT_ROOT / ".env",
    ]
    for env_path in candidates:
        if env_path.is_file():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("\"'")
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass


load_env_candidates()


@dataclass
class CodeReviewConfig:
    """Settings for Code Review execution."""

    # Path to target repository (CryptoTrack)
    crypto_track_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("CRYPTOTRACK_PATH", r"C:\Users\W\Projects\CryptoTrack")
        ).resolve()
    )

    # Path to RAG module and indices
    rag_dir: Path = field(default_factory=lambda: RAG_DIR.resolve())
    rag_structural_index_dir: Path = field(
        default_factory=lambda: (RAG_DIR / "data" / "indices" / "structural").resolve()
    )

    # OpenRouter API settings
    openrouter_model: str = os.getenv(
        "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"
    )
    openrouter_base_url: str = os.getenv(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    )
    openrouter_api_key: str = field(
        default_factory=lambda: (
            os.getenv("OPENROUTER_API_KEY")
            or os.getenv("VITE_OPENROUTER_API_KEY")
            or ""
        )
    )
    openrouter_timeout: int = int(os.getenv("OPENROUTER_TIMEOUT", "120"))

    # Ollama embeddings settings (for RAG query embedding)
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    ollama_embed_model: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

    # Output defaults
    output_dir: Path = field(default_factory=lambda: CODE_REVIEW_DIR.resolve())
    rag_top_k: int = int(os.getenv("RAG_TOP_K", "6"))


default_config = CodeReviewConfig()
