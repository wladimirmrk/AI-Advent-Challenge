import tempfile
from pathlib import Path
import numpy as np
from src.chunking.base import Chunk
from src.storage.vector_store import VectorStore

def test_vector_store_persistence_and_search():
    dim = 64
    chunks = [
        Chunk("id1", "Alpha content", "a.kt", "a.kt", "secA", 0, "fixed", {"start_line": 1}),
        Chunk("id2", "Beta content", "b.kt", "b.kt", "secB", 0, "fixed", {"start_line": 10}),
        Chunk("id3", "Gamma content", "c.md", "c.md", "secC", 0, "fixed", {"start_line": 20}),
    ]

    # Deterministic vectors
    vecs = np.zeros((3, dim), dtype=np.float32)
    vecs[0, 0] = 1.0
    vecs[1, 1] = 1.0
    vecs[2, 2] = 1.0

    store = VectorStore(dimension=dim)
    store.add_chunks(chunks, vecs)

    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        store.save(p)

        assert (p / "index.faiss").exists()
        assert (p / "chunks.db").exists()
        assert (p / "chunks_metadata.json").exists()

        loaded = VectorStore.load(p)
        assert len(loaded.chunks) == 3
        assert loaded.index.ntotal == 3

        # Search exact match for vector 0
        q = np.zeros((dim,), dtype=np.float32)
        q[0] = 1.0
        results = loaded.search(q, top_k=2)

        assert len(results) == 2
        assert results[0].chunk.chunk_id == "id1"
        assert abs(results[0].score - 1.0) < 1e-4

        # Test filter
        res_filter = loaded.search(q, top_k=2, filter_source="b.kt")
        assert len(res_filter) == 1
        assert res_filter[0].chunk.chunk_id == "id2"
