from dataclasses import dataclass, field
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

@dataclass
class AppConfig:
    project_path: str = field(
        default_factory=lambda: os.getenv(
            "PROJECT_PATH",
            str((BASE_DIR.parent.parent / "CryptoTrack").resolve())
        )
    )
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
    vector_dim: int = 768

    ignore_patterns: list = field(
        default_factory=lambda: [
            "docs/decisions/**",
            "**/docs/decisions/**",
            "**/.git/**",
            "**/build/**",
            "**/.gradle/**",
            "**/.kotlin/**",
            "**/.idea/**",
            "**/.zcode/**",
        ]
    )

    fixed_chunk_size: int = 500
    fixed_chunk_overlap: int = 50

    structural_max_chunk_size: int = 2500
    structural_chunk_overlap: int = 150

    # LLM & OpenRouter Settings
    openrouter_base_url: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    openrouter_model: str = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free")
    openrouter_api_key: str = field(
        default_factory=lambda: (
            os.getenv("OPENROUTER_API_KEY")
            or os.getenv("VITE_OPENROUTER_API_KEY")
            or ""
        )
    )

    # RAG defaults
    default_top_k: int = 5
    default_strategy: str = "structural"

    # Reranking & Filtering defaults (Day 23)
    rerank_initial_top_k: int = 15
    rerank_similarity_threshold: float = 0.58
    rerank_final_top_k: int = 4
    rerank_model_name: str = "ms-marco-TinyBERT-L-2-v2"

    # Grounding & Anti-Hallucination defaults (Day 24)
    grounded_relevance_threshold: float = 0.58
    grounded_min_sources: int = 1
    grounded_eval_delay: float = float(os.getenv("GROUNDED_EVAL_DELAY", "1.0"))

    # OpenRouter Connection Settings
    openrouter_timeout: int = int(os.getenv("OPENROUTER_TIMEOUT", "90"))

    data_dir: Path = BASE_DIR / "data"

    @property
    def fixed_index_dir(self) -> Path:
        return self.data_dir / "indices" / "fixed"

    @property
    def structural_index_dir(self) -> Path:
        return self.data_dir / "indices" / "structural"

    @property
    def comparison_report_path(self) -> Path:
        return self.data_dir / "comparison_report.md"

    @property
    def rag_benchmark_report_path(self) -> Path:
        return self.data_dir / "rag_benchmark_report.md"

    @property
    def rerank_benchmark_report_path(self) -> Path:
        return self.data_dir / "rerank_benchmark_report.md"

    @property
    def grounded_benchmark_report_path(self) -> Path:
        return self.data_dir / "grounded_benchmark_report.md"


def load_env_file():
    """Load key-value pairs from .env into os.environ if not already set."""
    candidates = [
        Path.cwd() / ".env",
        BASE_DIR / ".env",
        BASE_DIR.parent / ".env",
        Path.cwd() / "RAG" / ".env",
    ]
    seen = set()
    for env_path in candidates:
        try:
            resolved = env_path.resolve()
        except Exception:
            resolved = env_path
        if resolved in seen:
            continue
        seen.add(resolved)
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


load_env_file()
default_config = AppConfig()

