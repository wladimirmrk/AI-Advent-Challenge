import re
from pathlib import Path
from typing import List, Tuple
from src.loader.project_loader import Document
from src.chunking.base import BaseChunker, Chunk

class StructuralChunker(BaseChunker):
    """
    Structural chunker that respects document syntax and hierarchy:
    - Markdown: splits by header hierarchy (#, ##, ###)
    - Kotlin: splits by package/imports, class/interface, and function declarations
    - Config (XML/Gradle/TOML): splits by structural blocks
    """

    def __init__(self, max_chunk_size: int = 1200, overlap: int = 100):
        super().__init__(strategy_name="structural")
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap

    def chunk_document(self, doc: Document) -> List[Chunk]:
        if not doc.content.strip():
            return []

        if doc.file_type == "kotlin":
            return self._chunk_kotlin(doc)
        elif doc.file_type == "config":
            return self._chunk_config(doc)
        else:
            return self._chunk_fallback(doc)

    def _split_oversized_block(
        self,
        text: str,
        section_name: str,
        doc: Document,
        base_line: int,
        start_chunk_idx: int,
    ) -> List[Chunk]:
        """Split a large structural unit into smaller chunks while preserving section context."""
        file_stem = re.sub(r"[^a-zA-Z0-9_]", "_", doc.relative_path)
        chunks: List[Chunk] = []

        paragraphs = text.split("\n\n")
        current_content = ""
        current_start_line = base_line
        rel_line = 0

        for para in paragraphs:
            para_lines = len(para.splitlines())
            if len(current_content) + len(para) + 2 <= self.max_chunk_size:
                if current_content:
                    current_content += "\n\n" + para
                else:
                    current_content = para
                    current_start_line = base_line + rel_line
            else:
                if current_content.strip():
                    end_line = current_start_line + len(current_content.splitlines()) - 1
                    chunks.append(
                        Chunk(
                            chunk_id=f"struct_{file_stem}_{start_chunk_idx + len(chunks):04d}",
                            content=current_content.strip(),
                            source=doc.relative_path,
                            title=Path(doc.file_path).name,
                            section=section_name,
                            chunk_index=start_chunk_idx + len(chunks),
                            strategy=self.strategy_name,
                            metadata={
                                "start_line": current_start_line,
                                "end_line": end_line,
                                "section": section_name,
                                "is_subchunk": True,
                                "file_type": doc.file_type,
                                "language": doc.extension.lstrip("."),
                            },
                        )
                    )
                # If paragraph itself is huge, slice it
                if len(para) > self.max_chunk_size:
                    for i in range(0, len(para), self.max_chunk_size - self.overlap):
                        slice_text = para[i : i + self.max_chunk_size].strip()
                        if slice_text:
                            s_line = base_line + rel_line
                            chunks.append(
                                Chunk(
                                    chunk_id=f"struct_{file_stem}_{start_chunk_idx + len(chunks):04d}",
                                    content=slice_text,
                                    source=doc.relative_path,
                                    title=Path(doc.file_path).name,
                                    section=section_name,
                                    chunk_index=start_chunk_idx + len(chunks),
                                    strategy=self.strategy_name,
                                    metadata={
                                        "start_line": s_line,
                                        "end_line": s_line + len(slice_text.splitlines()) - 1,
                                        "section": section_name,
                                        "is_subchunk": True,
                                        "file_type": doc.file_type,
                                        "language": doc.extension.lstrip("."),
                                    },
                                )
                            )
                    current_content = ""
                else:
                    current_content = para
                    current_start_line = base_line + rel_line

            rel_line += para_lines + 1

        if current_content.strip():
            end_line = current_start_line + len(current_content.splitlines()) - 1
            chunks.append(
                Chunk(
                    chunk_id=f"struct_{file_stem}_{start_chunk_idx + len(chunks):04d}",
                    content=current_content.strip(),
                    source=doc.relative_path,
                    title=Path(doc.file_path).name,
                    section=section_name,
                    chunk_index=start_chunk_idx + len(chunks),
                    strategy=self.strategy_name,
                    metadata={
                        "start_line": current_start_line,
                        "end_line": end_line,
                        "section": section_name,
                        "is_subchunk": len(chunks) > 0,
                        "file_type": doc.file_type,
                        "language": doc.extension.lstrip("."),
                    },
                )
            )

        return chunks

    def _chunk_kotlin(self, doc: Document) -> List[Chunk]:
        """Split Kotlin code into imports, classes, companion objects, and functions."""
        lines = doc.content.splitlines()
        file_stem = re.sub(r"[^a-zA-Z0-9_]", "_", doc.relative_path)
        chunks: List[Chunk] = []

        # Find package & imports
        package_name = ""
        imports_lines: List[str] = []
        body_start_line = 1

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("package "):
                package_name = stripped.replace("package ", "").rstrip(";")
            elif stripped.startswith("import "):
                imports_lines.append(line)
            elif stripped and not stripped.startswith("//") and not stripped.startswith("/*"):
                body_start_line = idx
                break

        # Check if file has package/imports block
        if package_name or imports_lines:
            header_text = []
            if package_name:
                header_text.append(f"package {package_name}")
            if imports_lines:
                header_text.extend(imports_lines)
            full_header = "\n".join(header_text).strip()
            if full_header and len(full_header) > 20:
                chunks.append(
                    Chunk(
                        chunk_id=f"struct_{file_stem}_{len(chunks):04d}",
                        content=full_header,
                        source=doc.relative_path,
                        title=Path(doc.file_path).name,
                        section=f"Package & Imports: {package_name or 'Default'}",
                        chunk_index=len(chunks),
                        strategy=self.strategy_name,
                        metadata={
                            "start_line": 1,
                            "end_line": body_start_line - 1,
                            "section": "Package & Imports",
                            "package": package_name,
                            "file_type": "kotlin",
                            "language": "kt",
                        },
                    )
                )

        # Parse body by structural boundaries (class, interface, object, fun)
        body_lines = lines[body_start_line - 1 :]
        decl_regex = re.compile(
            r"^(?:\s*@\w+(?:\([^)]*\))?\s*)*"
            r"(?:public|private|internal|protected|open|abstract|data|sealed|enum)?\s*"
            r"(class|interface|object|enum class|fun)\s+([A-Za-z0-9_]+)"
        )

        blocks: List[Tuple[str, List[str], int]] = []
        curr_decl_name = Path(doc.file_path).stem
        curr_block_lines: List[str] = []
        curr_start = body_start_line
        brace_depth = 0

        for offset, line in enumerate(body_lines):
            line_no = body_start_line + offset
            stripped = line.strip()

            # Check if this line starts a top-level or class-level declaration at brace_depth <= 1
            if brace_depth <= 1:
                m = decl_regex.search(stripped)
                if m:
                    kind = m.group(1)
                    name = m.group(2)
                    if curr_block_lines and len("\n".join(curr_block_lines).strip()) > 30:
                        blocks.append((curr_decl_name, curr_block_lines, curr_start))
                        curr_block_lines = []
                        curr_start = line_no
                    curr_decl_name = f"{kind} {name}"

            curr_block_lines.append(line)
            brace_depth += line.count("{") - line.count("}")
            if brace_depth < 0:
                brace_depth = 0

        if curr_block_lines:
            blocks.append((curr_decl_name, curr_block_lines, curr_start))

        # Convert blocks to Chunks
        for decl_name, blk_lines, s_line in blocks:
            blk_text = "\n".join(blk_lines).strip()
            if not blk_text:
                continue

            if len(blk_text) <= self.max_chunk_size:
                e_line = s_line + len(blk_lines) - 1
                chunks.append(
                    Chunk(
                        chunk_id=f"struct_{file_stem}_{len(chunks):04d}",
                        content=blk_text,
                        source=doc.relative_path,
                        title=Path(doc.file_path).name,
                        section=f"{Path(doc.file_path).stem} > {decl_name}",
                        chunk_index=len(chunks),
                        strategy=self.strategy_name,
                        metadata={
                            "start_line": s_line,
                            "end_line": e_line,
                            "section": decl_name,
                            "package": package_name,
                            "file_type": "kotlin",
                            "language": doc.extension.lstrip("."),
                        },
                    )
                )
            else:
                sub_chunks = self._split_oversized_block(
                    blk_text, f"{Path(doc.file_path).stem} > {decl_name}", doc, s_line, len(chunks)
                )
                chunks.extend(sub_chunks)

        return chunks

    def _chunk_config(self, doc: Document) -> List[Chunk]:
        """Split XML or Gradle configuration into logical blocks."""
        lines = doc.content.splitlines()
        file_stem = re.sub(r"[^a-zA-Z0-9_]", "_", doc.relative_path)
        chunks: List[Chunk] = []

        if doc.extension == ".xml":
            # Split XML by major tags like <activity, <service, <uses-permission, <string
            tag_regex = re.compile(r"^\s*<([A-Za-z0-9_\-]+)")
            curr_lines: List[str] = []
            curr_tag = "XML Root"
            curr_start = 1

            for line_no, line in enumerate(lines, start=1):
                m = tag_regex.match(line)
                if m and m.group(1) not in {"resources", "manifest", "?xml"}:
                    if curr_lines:
                        text = "\n".join(curr_lines).strip()
                        if text:
                            chunks.append(
                                Chunk(
                                    chunk_id=f"struct_{file_stem}_{len(chunks):04d}",
                                    content=text,
                                    source=doc.relative_path,
                                    title=Path(doc.file_path).name,
                                    section=f"XML: <{curr_tag}>",
                                    chunk_index=len(chunks),
                                    strategy=self.strategy_name,
                                    metadata={"start_line": curr_start, "end_line": line_no - 1, "section": curr_tag},
                                )
                            )
                        curr_lines = []
                        curr_start = line_no
                    curr_tag = m.group(1)
                curr_lines.append(line)

            if curr_lines:
                text = "\n".join(curr_lines).strip()
                if text:
                    chunks.append(
                        Chunk(
                            chunk_id=f"struct_{file_stem}_{len(chunks):04d}",
                            content=text,
                            source=doc.relative_path,
                            title=Path(doc.file_path).name,
                            section=f"XML: <{curr_tag}>",
                            chunk_index=len(chunks),
                            strategy=self.strategy_name,
                            metadata={"start_line": curr_start, "end_line": len(lines), "section": curr_tag},
                        )
                    )
            return chunks

        # Fallback for TOML/Properties/Gradle
        return self._chunk_fallback(doc)

    def _chunk_fallback(self, doc: Document) -> List[Chunk]:
        """Fallback block splitting by double newlines or lines."""
        file_stem = re.sub(r"[^a-zA-Z0-9_]", "_", doc.relative_path)
        return self._split_oversized_block(
            doc.content, f"File: {Path(doc.file_path).name}", doc, 1, 0
        )
