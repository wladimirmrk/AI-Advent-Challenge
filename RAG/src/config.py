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

    structural_max_chunk_size: int = 1200
    structural_chunk_overlap: int = 100

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

default_config = AppConfig()
