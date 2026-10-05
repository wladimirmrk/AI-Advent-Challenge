from src.chunking.base import Chunk
from src.evaluation.comparator import ChunkComparator

def test_comparator_statistics():
    chunks = [
        Chunk("c1", "Small text", "file1.kt", "file1", "s1", 0, "fixed", {"file_type": "kotlin"}),
        Chunk("c2", "Longer text " * 50, "file2.md", "file2", "s2", 0, "fixed", {"file_type": "markdown"}),
    ]
    stats = ChunkComparator.compute_statistics(chunks, "fixed")
    assert stats["total_chunks"] == 2
    assert stats["unique_sources"] == 2
    assert stats["char_min"] == len("Small text")
    assert stats["char_mean"] > 0
    assert "by_type" in stats
