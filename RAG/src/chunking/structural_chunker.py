import re
from pathlib import Path
from typing import List, Tuple
from src.loader.project_loader import Document
from src.chunking.base import BaseChunker, Chunk

class StructuralChunker(BaseChunker):
    def __init__(self, max_chunk_size: int = 2500, overlap: int = 150):
        super().__init__(strategy_name='structural')
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap

    def chunk_document(self, doc: Document) -> list:
        content = doc.content.strip()
        if not content:
            return []

        if doc.file_type == 'kotlin':
            return self._chunk_kotlin(doc)
        elif doc.file_type == 'config':
            return self._chunk_config(doc)
        else:
            return self._chunk_fallback(doc)

    def _slug(self, path: str) -> str:
        return re.sub(r'[^a-zA-Z0-9_]', '_', path)

    def _chunk_kotlin(self, doc: Document) -> list:
        lines = doc.content.splitlines()
        chunks = []
        slug = self._slug(doc.relative_path)
        file_stem = Path(doc.file_path).stem

        # 1. Parse package & imports
        package_name = ''
        imports = []
        body_start = 1
        for idx, line in enumerate(lines, 1):
            s = line.strip()
            if s.startswith('package '):
                package_name = s.replace('package ', '').rstrip(';')
            elif s.startswith('import '):
                imports.append(line)
            elif s and not s.startswith('//') and not s.startswith('/*') and not s.startswith('*'):
                body_start = idx
                break

        body_lines = lines[body_start - 1:]

        # Regex for top-level declarations (at brace_depth == 0)
        decl_re = re.compile(
            r'^(?:(?:public|private|internal|protected|open|abstract|data|sealed|inline|value)\s+)*'
            r'(class|interface|object|enum class|fun)\s+([A-Za-z0-9_]+)'
        )

        blocks = []
        curr_lines = []
        curr_name = file_stem
        curr_start = body_start
        brace_depth = 0
        pending_decorations = []
        in_multiline_comment = False
        annotation_paren_depth = 0

        for offset, line in enumerate(body_lines):
            line_no = body_start + offset
            stripped = line.strip()

            # At top level, collect multi-line comments
            if brace_depth == 0:
                if in_multiline_comment:
                    pending_decorations.append(line)
                    if '*/' in stripped:
                        in_multiline_comment = False
                    continue
                elif stripped.startswith('/*'):
                    pending_decorations.append(line)
                    if '*/' not in stripped:
                        in_multiline_comment = True
                    continue

                # Collect single line comments or empty lines
                if stripped.startswith('//') or stripped == '':
                    pending_decorations.append(line)
                    continue

                # Collect multi-line or single-line annotations
                if annotation_paren_depth > 0:
                    pending_decorations.append(line)
                    annotation_paren_depth += line.count('(') - line.count(')')
                    if annotation_paren_depth < 0:
                        annotation_paren_depth = 0
                    continue
                elif stripped.startswith('@'):
                    pending_decorations.append(line)
                    annotation_paren_depth = line.count('(') - line.count(')')
                    if annotation_paren_depth < 0:
                        annotation_paren_depth = 0
                    continue

            # Check for top-level declaration at brace_depth == 0
            if brace_depth == 0:
                m = decl_re.search(stripped)
                if m:
                    kind = m.group(1)
                    name = m.group(2)
                    if curr_lines and len('\n'.join(curr_lines).strip()) > 0:
                        blocks.append((curr_name, curr_lines, curr_start))
                        curr_lines = []
                        curr_start = line_no - len(pending_decorations)

                    curr_name = f'{kind} {name}'
                    if pending_decorations:
                        curr_lines.extend(pending_decorations)
                        pending_decorations = []

            if pending_decorations:
                curr_lines.extend(pending_decorations)
                pending_decorations = []

            curr_lines.append(line)
            brace_depth += line.count('{') - line.count('}')
            if brace_depth < 0:
                brace_depth = 0

        if pending_decorations:
            curr_lines.extend(pending_decorations)
        if curr_lines:
            blocks.append((curr_name, curr_lines, curr_start))

        # Prepend package declaration to the first block so fully qualified context is preserved without creating noisy standalone import chunks
        if package_name and blocks:
            first_name, first_lines, first_start = blocks[0]
            if not any(l.strip().startswith("package ") for l in first_lines):
                blocks[0] = (first_name, [f"package {package_name}", ""] + first_lines, first_start)

        # Convert blocks to chunks
        for decl_name, blk_lines, s_line in blocks:
            blk_text = '\n'.join(blk_lines).strip()
            if not blk_text:
                continue
            if len(blk_text) <= self.max_chunk_size:
                e_line = s_line + len(blk_lines) - 1
                chunks.append(
                    Chunk(
                        chunk_id=f'struct_{slug}_{len(chunks):04d}',
                        content=blk_text,
                        source=doc.relative_path,
                        title=Path(doc.file_path).name,
                        section=f'{file_stem} > {decl_name}',
                        chunk_index=len(chunks),
                        strategy=self.strategy_name,
                        metadata={
                            'start_line': s_line,
                            'end_line': e_line,
                            'section': decl_name,
                            'package': package_name,
                            'file_type': 'kotlin',
                            'language': 'kt',
                        }
                    )
                )
            else:
                sub_chunks = self._split_oversized_lines(
                    blk_lines, decl_name, doc, s_line, len(chunks), package_name
                )
                chunks.extend(sub_chunks)

        return chunks

    def _split_oversized_lines(self, lines, decl_name, doc, base_line, start_idx, package_name):
        chunks = []
        slug = self._slug(doc.relative_path)
        file_stem = Path(doc.file_path).stem
        cur_lines = []
        cur_start = base_line

        for idx, line in enumerate(lines):
            line_no = base_line + idx
            test_text = '\n'.join(cur_lines + [line])
            if len(test_text) > self.max_chunk_size and cur_lines:
                text = '\n'.join(cur_lines).strip()
                chunks.append(
                    Chunk(
                        chunk_id=f'struct_{slug}_{start_idx + len(chunks):04d}',
                        content=text,
                        source=doc.relative_path,
                        title=Path(doc.file_path).name,
                        section=f'{file_stem} > {decl_name} (Part {len(chunks)+1})',
                        chunk_index=start_idx + len(chunks),
                        strategy=self.strategy_name,
                        metadata={
                            'start_line': cur_start,
                            'end_line': line_no - 1,
                            'section': decl_name,
                            'package': package_name,
                            'file_type': 'kotlin',
                            'language': 'kt',
                        }
                    )
                )
                cur_lines = [line]
                cur_start = line_no
            else:
                cur_lines.append(line)

        if cur_lines:
            text = '\n'.join(cur_lines).strip()
            if text:
                chunks.append(
                    Chunk(
                        chunk_id=f'struct_{slug}_{start_idx + len(chunks):04d}',
                        content=text,
                        source=doc.relative_path,
                        title=Path(doc.file_path).name,
                        section=f'{file_stem} > {decl_name} (Part {len(chunks)+1})',
                        chunk_index=start_idx + len(chunks),
                        strategy=self.strategy_name,
                        metadata={
                            'start_line': cur_start,
                            'end_line': base_line + len(lines) - 1,
                            'section': decl_name,
                            'package': package_name,
                            'file_type': 'kotlin',
                            'language': 'kt',
                        }
                    )
                )
        return chunks

    def _chunk_config(self, doc: Document) -> list:
        content = doc.content.strip()
        if not content:
            return []
        if len(content) <= self.max_chunk_size:
            return [
                Chunk(
                    chunk_id=f'struct_{self._slug(doc.relative_path)}_0000',
                    content=content,
                    source=doc.relative_path,
                    title=Path(doc.file_path).name,
                    section=f'Config: {Path(doc.file_path).name}',
                    chunk_index=0,
                    strategy=self.strategy_name,
                    metadata={
                        'start_line': 1,
                        'end_line': doc.line_count,
                        'section': Path(doc.file_path).name,
                        'file_type': 'config',
                        'language': doc.extension.lstrip('.'),
                    }
                )
            ]
        return self._split_oversized_lines(
            doc.content.splitlines(), f'Config: {Path(doc.file_path).name}', doc, 1, 0, ''
        )

    def _chunk_fallback(self, doc: Document) -> list:
        return self._split_oversized_lines(
            doc.content.splitlines(), f'File: {Path(doc.file_path).name}', doc, 1, 0, ''
        )
