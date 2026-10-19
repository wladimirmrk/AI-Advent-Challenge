"""RAG Retriever for extracting relevant architectural guidelines and code context for a PR diff."""

from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional, Set

# Ensure RAG is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
RAG_PATH = BASE_DIR / "RAG"
if str(RAG_PATH) not in sys.path:
    sys.path.insert(0, str(RAG_PATH))

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunkInfo:
    """Structured information about a retrieved context chunk."""
    source: str
    section: str
    start_line: Optional[int]
    end_line: Optional[int]
    score: float
    content: str
    chunk_id: str

    @property
    def citation(self) -> str:
        s_line = f":L{self.start_line}" if self.start_line is not None else ""
        e_line = f"-L{self.end_line}" if self.end_line is not None else ""
        return f"[Source: {self.source}{s_line}{e_line}]"


@dataclass
class DiffAnalysis:
    """Extracted details from a git diff."""
    files_changed: List[str] = field(default_factory=list)
    added_lines_count: int = 0
    deleted_lines_count: int = 0
    key_identifiers: List[str] = field(default_factory=list)
    search_queries: List[str] = field(default_factory=list)


class CodeReviewRAGRetriever:
    """Retrieves relevant CryptoTrack architectural and codebase context for a given PR diff."""

    def __init__(
        self,
        index_dir: Optional[Path] = None,
        ollama_base_url: Optional[str] = None,
        embed_model: str = "nomic-embed-text",
        top_k: int = 6,
    ):
        self.index_dir = index_dir or (RAG_PATH / "data" / "indices" / "structural")
        self.ollama_base_url = ollama_base_url or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.embed_model = embed_model
        self.top_k = top_k
        self._vector_store = None
        self._embedder = None
        self._initialized = False

    def _ensure_initialized(self) -> bool:
        """Lazily initialize vector store and embedder."""
        if self._initialized:
            return self._vector_store is not None

        self._initialized = True
        try:
            from src.storage.vector_store import VectorStore
            from src.embeddings.ollama_embedder import OllamaEmbedder

            if not self.index_dir.exists():
                # Fallback to fixed index if structural does not exist
                fallback_dir = self.index_dir.parent / "fixed"
                if fallback_dir.exists():
                    self.index_dir = fallback_dir
                else:
                    logger.warning("RAG index directory not found at: %s", self.index_dir)
                    return False

            self._vector_store = VectorStore.load(self.index_dir)
            self._embedder = OllamaEmbedder(
                base_url=self.ollama_base_url,
                model=self.embed_model,
            )
            logger.info("Successfully loaded VectorStore with %d chunks", len(self._vector_store.chunks))
            return True
        except Exception as e:
            logger.warning("Failed to initialize RAG components: %s", e)
            self._vector_store = None
            self._embedder = None
            return False

    def parse_diff(self, diff_text: str) -> DiffAnalysis:
        """Parse raw diff text to extract touched files, statistics, and keywords."""
        files_changed = []
        added_lines = 0
        deleted_lines = 0
        added_words: Set[str] = set()

        for line in diff_text.splitlines():
            # Match diff header e.g. diff --git a/path b/path
            if line.startswith("diff --git"):
                parts = line.split(" ")
                if len(parts) >= 4:
                    b_path = parts[3].lstrip("b/")
                    if b_path and b_path not in files_changed:
                        files_changed.append(b_path)
            elif line.startswith("+++ b/"):
                p = line[6:].strip()
                if p and p != "/dev/null" and p not in files_changed:
                    files_changed.append(p)
            elif line.startswith("+") and not line.startswith("+++"):
                added_lines += 1
                # Extract code identifiers (classes, methods, variables)
                words = re.findall(r"\b[A-Za-z0-9_]{4,}\b", line)
                for w in words:
                    if w.lower() not in {"this", "true", "false", "null", "none", "import", "val", "var", "override"}:
                        added_words.add(w)
            elif line.startswith("-") and not line.startswith("---"):
                deleted_lines += 1

        # Formulate search queries
        queries: List[str] = []

        # 1. Base architecture and guidelines query
        queries.append("CryptoTrack architecture guidelines AGENTS.md rules dependency boundaries ADR")

        # 2. File-specific queries
        for f in files_changed:
            fname = Path(f).name
            stem = Path(f).stem
            # Clean path query
            clean_path = f.replace("/", " ").replace("\\", " ")
            queries.append(f"architecture and implementation context for {clean_path} {fname} {stem}")

        # 3. Code identifier query if available
        if added_words:
            top_words = list(added_words)[:12]
            queries.append(f"code context for symbols: {' '.join(top_words)}")

        return DiffAnalysis(
            files_changed=files_changed,
            added_lines_count=added_lines,
            deleted_lines_count=deleted_lines,
            key_identifiers=sorted(list(added_words))[:20],
            search_queries=queries,
        )

    def retrieve_context_for_diff(self, diff_text: str, top_k: Optional[int] = None) -> List[RetrievedChunkInfo]:
        """Retrieve relevant context chunks for a given diff."""
        if not self._ensure_initialized() or not self._vector_store or not self._embedder:
            logger.info("RAG vector store is not available, skipping retrieval.")
            return []

        limit = top_k or self.top_k
        diff_info = self.parse_diff(diff_text)
        seen_chunk_ids: Set[str] = set()
        retrieved: List[RetrievedChunkInfo] = []

        for query in diff_info.search_queries:
            try:
                # Add nomic search_query prefix as recommended
                q_text = f"search_query: {query.strip()}"
                q_vec = self._embedder.embed_query(q_text)
                search_results = self._vector_store.search(q_vec, top_k=max(limit // 2, 3))

                for r in search_results:
                    c = r.chunk
                    cid = c.chunk_id
                    if cid in seen_chunk_ids:
                        continue
                    seen_chunk_ids.add(cid)

                    retrieved.append(
                        RetrievedChunkInfo(
                            source=c.source,
                            section=c.section,
                            start_line=c.metadata.get("start_line"),
                            end_line=c.metadata.get("end_line"),
                            score=float(r.score),
                            content=c.content,
                            chunk_id=cid,
                        )
                    )
            except Exception as e:
                logger.warning("Error running query '%s' against RAG: %s", query, e)

        # Sort by relevance score and take top_k
        retrieved.sort(key=lambda x: x.score, reverse=True)
        return retrieved[:limit]

    def format_context_block(self, chunks: List[RetrievedChunkInfo]) -> str:
        """Format retrieved chunks into Markdown context for LLM prompt."""
        if not chunks:
            return "_Контекст из базы знаний RAG не найден или отключен._"

        parts = []
        for idx, ch in enumerate(chunks, start=1):
            lines_str = (
                f" (строки L{ch.start_line}-L{ch.end_line})"
                if ch.start_line is not None and ch.end_line is not None
                else ""
            )
            parts.append(
                f"### Источник #{idx}: `{ch.source}`{lines_str}\n"
                f"**Секция:** `{ch.section}` | **Релевантность:** `{ch.score:.3f}`\n"
                f"```text\n{ch.content.strip()}\n```"
            )
        return "\n\n".join(parts)
