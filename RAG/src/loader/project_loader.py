import fnmatch
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set

@dataclass
class Document:
    file_path: str
    relative_path: str
    extension: str
    file_type: str
    content: str
    char_count: int
    line_count: int

    @property
    def estimated_pages(self) -> float:
        """Estimate document size in standard pages (~1800 characters per page)."""
        return self.char_count / 1800.0


class ProjectLoader:
    # Strictly code and Android XML files only (Markdown excluded)
    DEFAULT_EXTENSIONS = {".kt", ".kts", ".xml"}
    DEFAULT_IGNORE_DIRS = {
        ".git", ".gradle", "build", ".kotlin", ".idea", ".zcode",
        "__pycache__", "gradle/wrapper", "bin", "obj", ".vs"
    }
    DEFAULT_IGNORE_PATTERNS = [
        "**/.git/**",
        "**/build/**",
        "**/.gradle/**",
        "**/.kotlin/**",
        "**/.idea/**",
        "**/.zcode/**",
    ]

    def __init__(
        self,
        project_path: str,
        allowed_extensions: Optional[Set[str]] = None,
        ignore_dirs: Optional[Set[str]] = None,
        ignore_patterns: Optional[List[str]] = None,
    ):
        self.project_path = Path(project_path).resolve()
        self.allowed_extensions = allowed_extensions or self.DEFAULT_EXTENSIONS
        self.ignore_dirs = ignore_dirs or self.DEFAULT_IGNORE_DIRS
        self.ignore_patterns = list(ignore_patterns) if ignore_patterns is not None else list(self.DEFAULT_IGNORE_PATTERNS)

    def is_ignored(self, rel_path: str) -> bool:
        """Check if relative path matches any ignore pattern or ignored directory."""
        norm = rel_path.replace("\\", "/").strip("/")

        # Check directory names
        parts = norm.split("/")
        for p in parts:
            if p in self.ignore_dirs or p.startswith("."):
                return True

        # Check glob patterns
        for pat in self.ignore_patterns:
            clean_pat = pat.replace("\\", "/").strip("/")
            if fnmatch.fnmatch(norm, clean_pat) or fnmatch.fnmatch(norm + "/", clean_pat):
                return True
            if clean_pat.endswith("/**"):
                prefix = clean_pat[:-3]
                if norm == prefix or norm.startswith(prefix + "/"):
                    return True
            elif clean_pat.endswith("/*"):
                prefix = clean_pat[:-2]
                if norm == prefix or norm.startswith(prefix + "/"):
                    return True
            if norm == clean_pat or norm.startswith(clean_pat + "/"):
                return True

        return False

    def _determine_file_type(self, ext: str) -> str:
        if ext in {".kt", ".kts"}:
            return "kotlin"
        elif ext == ".xml":
            return "config"
        return "code"

    def load_documents(self, max_docs: Optional[int] = None) -> List[Document]:
        if not self.project_path.exists():
            raise FileNotFoundError(f"Project path does not exist: {self.project_path}")

        documents: List[Document] = []

        for root, dirs, files in os.walk(self.project_path):
            # Prune ignored directories in-place
            pruned_dirs = []
            for d in dirs:
                dir_rel = (Path(root) / d).relative_to(self.project_path).as_posix()
                if not self.is_ignored(dir_rel):
                    pruned_dirs.append(d)
            dirs[:] = pruned_dirs

            for file in files:
                ext = Path(file).suffix.lower()
                # Check for special double extensions like .gradle.kts
                if file.endswith(".gradle.kts"):
                    ext = ".kts"

                if ext not in self.allowed_extensions:
                    continue

                full_path = Path(root) / file
                rel_path = full_path.relative_to(self.project_path).as_posix()

                if self.is_ignored(rel_path):
                    continue

                try:
                    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()

                    # Filter out completely empty files
                    if not content.strip():
                        continue

                    doc = Document(
                        file_path=str(full_path),
                        relative_path=rel_path,
                        extension=ext,
                        file_type=self._determine_file_type(ext),
                        content=content,
                        char_count=len(content),
                        line_count=len(content.splitlines()),
                    )
                    documents.append(doc)
                except Exception as e:
                    print(f"Warning: Failed to read {full_path}: {e}")

        def sort_priority(d: Document):
            # Documentation and root configs first, then main sources
            prio = 0 if d.file_type == "markdown" else (1 if d.file_type == "config" else 2)
            return (prio, d.relative_path)

        sorted_docs = sorted(documents, key=sort_priority)
        if max_docs:
            sorted_docs = sorted_docs[:max_docs]
        return sorted_docs

    def summary(self, documents: List[Document]) -> dict:
        total_chars = sum(d.char_count for d in documents)
        total_lines = sum(d.line_count for d in documents)
        total_pages = sum(d.estimated_pages for d in documents)
        by_type = {}
        for d in documents:
            by_type[d.file_type] = by_type.get(d.file_type, 0) + 1

        return {
            "total_documents": len(documents),
            "total_chars": total_chars,
            "total_lines": total_lines,
            "estimated_pages": round(total_pages, 1),
            "by_type": by_type,
        }
