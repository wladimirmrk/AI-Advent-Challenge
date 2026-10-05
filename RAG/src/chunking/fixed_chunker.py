import re
from pathlib import Path
from typing import List
from src.loader.project_loader import Document
from src.chunking.base import BaseChunker, Chunk

class FixedChunker(BaseChunker):
    """
    Fixed-size chunker with configurable window size and overlap.
    Snaps to newline or whitespace boundaries when possible.
    """

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        super().__init__(strategy_name="fixed")
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if chunk_overlap < 0 or chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be >= 0 and < chunk_size")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_document(self, doc: Document) -> List[Chunk]:
        text = doc.content
        if not text.strip():
            return []

        chunks: List[Chunk] = []
        text_len = len(text)
        start = 0
        chunk_idx = 0

        # Precompute line start offsets for line number calculation
        line_offsets = [0]
        for m in re.finditer(r"\n", text):
            line_offsets.append(m.end())

        def get_line_num(char_pos: int) -> int:
            import bisect
            return bisect.bisect_right(line_offsets, char_pos)

        file_stem = re.sub(r"[^a-zA-Z0-9_]", "_", doc.relative_path)

        while start < text_len:
            # Desired window end
            ideal_end = start + self.chunk_size

            if ideal_end >= text_len:
                end = text_len
            else:
                # Look for natural breakpoint (newline or space) within 15% window before ideal_end
                search_back = int(self.chunk_size * 0.15)
                search_region = text[ideal_end - search_back : ideal_end + 1]

                # Prefer newline
                nl_pos = search_region.rfind("\n")
                if nl_pos != -1:
                    end = (ideal_end - search_back) + nl_pos + 1
                else:
                    # Prefer space
                    sp_pos = search_region.rfind(" ")
                    if sp_pos != -1:
                        end = (ideal_end - search_back) + sp_pos + 1
                    else:
                        end = ideal_end

            chunk_text = text[start:end].strip()

            if chunk_text:
                start_line = get_line_num(start)
                end_line = get_line_num(max(start, end - 1))
                chunk_id = f"fixed_{file_stem}_{chunk_idx:04d}"

                chunk = Chunk(
                    chunk_id=chunk_id,
                    content=chunk_text,
                    source=doc.relative_path,
                    title=Path(doc.file_path).name,
                    section=f"Offset {start}-{end} (L{start_line}-L{end_line})",
                    chunk_index=chunk_idx,
                    strategy=self.strategy_name,
                    metadata={
                        "start_char": start,
                        "end_char": end,
                        "start_line": start_line,
                        "end_line": end_line,
                        "file_type": doc.file_type,
                        "language": doc.extension.lstrip("."),
                    },
                )
                chunks.append(chunk)
                chunk_idx += 1

            if end >= text_len:
                break

            # Advance by step (chunk_size - overlap)
            step = max(1, (end - start) - self.chunk_overlap)
            start = start + step

        return chunks
