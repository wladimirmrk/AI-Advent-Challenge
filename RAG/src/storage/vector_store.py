import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import faiss
import numpy as np
from src.chunking.base import Chunk

@dataclass
class SearchResult:
    chunk: Chunk
    score: float
    rank: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rank": self.rank,
            "score": round(self.score, 4),
            "chunk_id": self.chunk.chunk_id,
            "source": self.chunk.source,
            "title": self.chunk.title,
            "section": self.chunk.section,
            "strategy": self.chunk.strategy,
            "content": self.chunk.content,
            "metadata": self.chunk.metadata,
        }


class VectorStore:
    """
    Hybrid Vector Store combining:
    - FAISS IndexFlatIP (for high performance cosine similarity vector search)
    - SQLite database (chunks.db) for structured metadata querying and persistent chunk storage
    - JSON export (chunks_metadata.json) for portability and human inspection
    """

    def __init__(self, dimension: int = 768):
        self.dimension = dimension
        self.index = faiss.IndexFlatIP(dimension)
        self.chunks: List[Chunk] = []

    def add_chunks(self, chunks: List[Chunk], embeddings: np.ndarray):
        """Add chunks and their corresponding normalized embedding vectors."""
        if len(chunks) != embeddings.shape[0]:
            raise ValueError(
                f"Mismatch: got {len(chunks)} chunks and {embeddings.shape[0]} embeddings."
            )

        if embeddings.shape[1] != self.dimension:
            raise ValueError(
                f"Expected embedding dimension {self.dimension}, got {embeddings.shape[1]}"
            )

        # Ensure float32
        vectors = np.ascontiguousarray(embeddings, dtype=np.float32)
        self.index.add(vectors)
        self.chunks.extend(chunks)

    def save(self, directory: Path):
        """Save FAISS index, SQLite database, and JSON metadata."""
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)

        # 1. Save FAISS index
        faiss_path = directory / "index.faiss"
        faiss.write_index(self.index, str(faiss_path))

        # 2. Save SQLite database
        db_path = directory / "chunks.db"
        if db_path.exists():
            db_path.unlink()

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE chunks (
                id INTEGER PRIMARY KEY,
                chunk_id TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                title TEXT NOT NULL,
                section TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                strategy TEXT NOT NULL,
                metadata_json TEXT NOT NULL
            )
            """
        )

        rows = []
        for idx, c in enumerate(self.chunks):
            rows.append(
                (
                    idx,
                    c.chunk_id,
                    c.content,
                    c.source,
                    c.title,
                    c.section,
                    c.chunk_index,
                    c.strategy,
                    json.dumps(c.metadata, ensure_ascii=False),
                )
            )

        cursor.executemany(
            """
            INSERT INTO chunks (id, chunk_id, content, source, title, section, chunk_index, strategy, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
        conn.close()

        # 3. Save JSON metadata
        json_path = directory / "chunks_metadata.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump([c.to_dict() for c in self.chunks], f, indent=2, ensure_ascii=False)

        # 4. Save store info
        info_path = directory / "store_info.json"
        info = {
            "total_chunks": len(self.chunks),
            "vector_dimension": self.dimension,
            "faiss_total": self.index.ntotal,
        }
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info, f, indent=2)

    @classmethod
    def load(cls, directory: Path) -> "VectorStore":
        """Load VectorStore from directory."""
        directory = Path(directory)
        faiss_path = directory / "index.faiss"
        db_path = directory / "chunks.db"

        if not faiss_path.exists() or not db_path.exists():
            raise FileNotFoundError(
                f"Missing index or database files in {directory}"
            )

        index = faiss.read_index(str(faiss_path))
        instance = cls(dimension=index.d)
        instance.index = index

        # Load SQLite chunks
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, chunk_id, content, source, title, section, chunk_index, strategy, metadata_json
            FROM chunks
            ORDER BY id ASC
            """
        )
        rows = cursor.fetchall()
        conn.close()

        chunks: List[Chunk] = []
        for r in rows:
            _, chunk_id, content, source, title, section, chunk_idx, strategy, meta_str = r
            meta = json.loads(meta_str)
            chunk = Chunk(
                chunk_id=chunk_id,
                content=content,
                source=source,
                title=title,
                section=section,
                chunk_index=chunk_idx,
                strategy=strategy,
                metadata=meta,
            )
            chunks.append(chunk)

        instance.chunks = chunks
        if len(instance.chunks) != instance.index.ntotal:
            raise ValueError(
                f"Data mismatch: FAISS has {instance.index.ntotal} vectors, SQLite has {len(instance.chunks)} records."
            )

        return instance

    def search(
        self,
        query_vector: np.ndarray,
        top_k: int = 5,
        filter_source: Optional[str] = None,
    ) -> List[SearchResult]:
        """Search top_k nearest chunks by query vector."""
        if self.index.ntotal == 0:
            return []

        # Prepare normalized query
        q = np.array(query_vector, dtype=np.float32)
        if q.ndim == 1:
            q = q.reshape(1, -1)
        norm = np.linalg.norm(q)
        if norm > 0:
            q = q / norm

        # Fetch more if filter is provided
        fetch_k = min(self.index.ntotal, top_k * 4 if filter_source else top_k)
        scores, indices = self.index.search(q, fetch_k)

        results: List[SearchResult] = []
        rank = 1

        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self.chunks):
                continue
            chunk = self.chunks[idx]

            if filter_source and filter_source.lower() not in chunk.source.lower():
                continue

            results.append(
                SearchResult(
                    chunk=chunk,
                    score=float(score),
                    rank=rank,
                )
            )
            rank += 1
            if len(results) >= top_k:
                break

        return results
