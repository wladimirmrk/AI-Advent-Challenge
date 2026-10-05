import tempfile
from pathlib import Path
from src.loader.project_loader import ProjectLoader, Document

def test_project_loader_reads_code_only():
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        # Markdown should be ignored
        (p / "README.md").write_text("# Title\nHello world docs", encoding="utf-8")
        (p / "src").mkdir()
        (p / "src" / "Main.kt").write_text("package com.app\nclass Main {\n fun run() {}\n}", encoding="utf-8")
        (p / "src" / "build.gradle.kts").write_text("plugins { kotlin(\"jvm\") }", encoding="utf-8")
        (p / "src" / "AndroidManifest.xml").write_text("<manifest package=\"com.app\"/>", encoding="utf-8")
        (p / "build").mkdir()
        (p / "build" / "ignored.kt").write_text("package build\nclass Ignored", encoding="utf-8")

        loader = ProjectLoader(str(p))
        docs = loader.load_documents()

        assert len(docs) == 3
        rel_paths = [d.relative_path for d in docs]
        assert "README.md" not in rel_paths
        assert "src/Main.kt" in rel_paths
        assert "src/build.gradle.kts" in rel_paths
        assert "src/AndroidManifest.xml" in rel_paths
        assert not any("build/ignored" in r for r in rel_paths)

        summary = loader.summary(docs)
        assert summary["total_documents"] == 3
        assert summary["by_type"]["kotlin"] == 2
        assert summary["by_type"]["config"] == 1


def test_project_loader_excludes_custom_globs():
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        (p / "src").mkdir()
        (p / "src" / "Main.kt").write_text("package com.app\nclass Main", encoding="utf-8")
        (p / "src" / "test").mkdir()
        (p / "src" / "test" / "Test.kt").write_text("package com.app\nclass Test", encoding="utf-8")

        loader = ProjectLoader(str(p), ignore_patterns=["src/test/**"])
        docs = loader.load_documents()

        rel_paths = [d.relative_path for d in docs]
        assert "src/Main.kt" in rel_paths
        assert "src/test/Test.kt" not in rel_paths

