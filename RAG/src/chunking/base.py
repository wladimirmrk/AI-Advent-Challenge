from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List
from src.loader.project_loader import Document

@dataclass
class Chunk:
    chunk_id: str
    content: str
    source: str          # File relative path (e.g., "app/src/.../MainActivity.kt")
    title: str           # Document or file title (e.g., "MainActivity.kt")
    section: str         # Section name (Markdown header breadcrumb or Kotlin class/func signature)
    chunk_index: int     # Index of chunk within document
    strategy: str        # "fixed" or "structural"
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def char_count(self) -> int:
        return len(self.content)

    @property
    def token_estimate(self) -> int:
        """Rough token estimate (~4 chars per token for code/text)."""
        return max(1, len(self.content) // 4)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["char_count"] = self.char_count
        d["token_estimate"] = self.token_estimate
        return d


class BaseChunker(ABC):
    def __init__(self, strategy_name: str):
        self.strategy_name = strategy_name

    @abstractmethod
    def chunk_document(self, doc: Document) -> List[Chunk]:
        """Split a single Document into Chunks."""
        pass

    def chunk_documents(self, documents: List[Document]) -> List[Chunk]:
        """Split multiple Documents into Chunks."""
        all_chunks: List[Chunk] = []
        for doc in documents:
            chunks = self.chunk_document(doc)
            all_chunks.extend(chunks)
        return all_chunks
