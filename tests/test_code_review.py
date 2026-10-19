"""Unit and integration tests for code-review CLI tool."""

from pathlib import Path
import sys
import pytest

# Ensure project roots are on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CODE_REVIEW_DIR = PROJECT_ROOT / "code-review"
RAG_DIR = PROJECT_ROOT / "RAG"

if str(CODE_REVIEW_DIR) not in sys.path:
    sys.path.insert(0, str(CODE_REVIEW_DIR))
if str(RAG_DIR) not in sys.path:
    sys.path.insert(0, str(RAG_DIR))

from config import CodeReviewConfig
from git_client import GitClient
from rag_retriever import CodeReviewRAGRetriever
from review_agent import CodeReviewAgent


SAMPLE_DIFF = """diff --git a/.github/workflows/main.yml b/.github/workflows/main.yml
index 1372cd8..00f780e 100644
--- a/.github/workflows/main.yml
+++ b/.github/workflows/main.yml
@@ -1,5 +1,6 @@
-name: Self-hosted terminal test
+name: Windows Self-hosted runner test
+run-name: Deploy pipeline
 
 jobs:
-  runs-on: self-hosted
+  runs-on: [self-hosted, windows]
"""


def test_git_client_resolve_gh():
    """Verify that gh executable is resolved."""
    client = GitClient()
    assert client.gh_executable is not None
    assert len(client.gh_executable) > 0


def test_diff_parser():
    """Verify parsing git diff into structured analysis."""
    retriever = CodeReviewRAGRetriever()
    analysis = retriever.parse_diff(SAMPLE_DIFF)

    assert ".github/workflows/main.yml" in analysis.files_changed
    assert analysis.added_lines_count >= 2
    assert analysis.deleted_lines_count >= 2
    assert len(analysis.search_queries) > 0


def test_rag_retrieval_for_diff():
    """Verify RAG retrieval against CryptoTrack index."""
    retriever = CodeReviewRAGRetriever()
    chunks = retriever.retrieve_context_for_diff(SAMPLE_DIFF, top_k=3)
    # If RAG index is present, it returns chunks
    if retriever._ensure_initialized() and retriever._vector_store:
        assert len(chunks) > 0
        formatted = retriever.format_context_block(chunks)
        assert "### Источник #" in formatted


def test_review_agent_prompt_builder():
    """Verify prompt assembly with PR metadata and diff."""
    agent = CodeReviewAgent(model="nvidia/nemotron-3-ultra-550b-a55b:free")
    metadata = {
        "title": "Update main.yml",
        "author": {"login": "wladimirmrk"},
        "baseRefName": "main",
        "headRefName": "patch-2",
        "body": "Testing Windows runner",
    }
    messages = agent.build_prompt(
        pr_number=2,
        metadata=metadata,
        diff_text=SAMPLE_DIFF,
        rag_context_text="Sample RAG context",
    )

    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert "АРХИТЕКТУРНЫЕ ИНВАРИАНТЫ" in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert "PULL REQUEST #2: Update main.yml" in messages[1]["content"]
    assert "Sample RAG context" in messages[1]["content"]
