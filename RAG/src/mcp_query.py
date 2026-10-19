import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure RAG project root is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Ensure UTF-8 on Windows
if sys.platform.startswith("win"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from src.config import default_config
from src.storage.vector_store import VectorStore
from src.embeddings.ollama_embedder import OllamaEmbedder


def sqlite_fallback_search(
    db_path: Path,
    query: str,
    top_k: int = 5,
    filter_source: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fallback search in SQLite chunks.db when Ollama embedding service is offline."""
    if not db_path.exists():
        return []

    words = [w.strip() for w in query.replace("?", " ").replace("!", " ").replace(".", " ").split() if len(w.strip()) > 2]
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    conditions = []
    params: List[Any] = []

    if filter_source:
        conditions.append("source LIKE ?")
        params.append(f"%{filter_source}%")

    if words:
        word_conditions = []
        for w in words[:5]:
            word_conditions.append("(content LIKE ? OR section LIKE ? OR source LIKE ?)")
            params.extend([f"%{w}%", f"%{w}%", f"%{w}%"])
        conditions.append("(" + " OR ".join(word_conditions) + ")")

    where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
    query_sql = f"SELECT chunk_id, content, source, title, section, metadata_json FROM chunks{where_clause} LIMIT {top_k * 3}"

    rows = cursor.execute(query_sql, params).fetchall()
    conn.close()

    scored = []
    lower_words = [w.lower() for w in words]

    for chunk_id, content, source, title, section, meta_json in rows:
        text_lower = f"{source} {section} {content}".lower()
        match_count = sum(text_lower.count(w) for w in lower_words) if lower_words else 1
        meta = {}
        if meta_json:
            try:
                meta = json.loads(meta_json)
            except Exception:
                pass
        scored.append((match_count, {
            "chunk_id": chunk_id,
            "content": content,
            "source": source,
            "title": title or "",
            "section": section or "",
            "start_line": meta.get("start_line"),
            "end_line": meta.get("end_line"),
            "metadata": meta,
        }))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for rank, (score_val, item) in enumerate(scored[:top_k], 1):
        item["rank"] = rank
        item["score"] = round(min(0.95, 0.4 + 0.1 * score_val), 4)
        results.append(item)

    return results


def run_query(query: str, top_k: int = 5, filter_source: Optional[str] = None, index_dir_override: Optional[str] = None) -> Dict[str, Any]:
    index_dir = Path(index_dir_override) if index_dir_override else default_config.structural_index_dir

    if not index_dir.exists():
        return {
            "success": False,
            "error": f"Structural index directory not found: {index_dir}",
            "results": [],
        }

    faiss_path = index_dir / "index.faiss"
    db_path = index_dir / "chunks.db"

    # 1. Try FAISS vector search with Ollama embedder
    if faiss_path.exists() and db_path.exists():
        try:
            store = VectorStore.load(index_dir)
            embedder = OllamaEmbedder(
                base_url=default_config.ollama_base_url,
                model=default_config.ollama_model,
                timeout=10,
            )
            q_vec = embedder.embed_query(query)
            search_results = store.search(q_vec, top_k=top_k, filter_source=filter_source)

            formatted = []
            for r in search_results:
                meta = r.chunk.metadata or {}
                formatted.append({
                    "rank": r.rank,
                    "score": round(float(r.score), 4),
                    "chunk_id": r.chunk.chunk_id,
                    "source": r.chunk.source,
                    "title": r.chunk.title or "",
                    "section": r.chunk.section or "",
                    "start_line": meta.get("start_line"),
                    "end_line": meta.get("end_line"),
                    "content": r.chunk.content,
                    "metadata": meta,
                })

            return {
                "success": True,
                "strategy": "structural",
                "method": "faiss_vector",
                "query": query,
                "count": len(formatted),
                "results": formatted,
            }
        except Exception as vec_err:
            # Fall back to SQLite search if Ollama is not running or vector search fails
            pass

    # 2. SQLite Keyword Fallback
    fallback_results = sqlite_fallback_search(db_path, query, top_k=top_k, filter_source=filter_source)
    return {
        "success": True,
        "strategy": "structural",
        "method": "sqlite_fallback",
        "query": query,
        "count": len(fallback_results),
        "results": fallback_results,
    }


def main():
    parser = argparse.ArgumentParser(description="Query CryptoTrack Structural RAG index")
    parser.add_argument("--query", "-q", type=str, required=True, help="Search query")
    parser.add_argument("--top-k", "-k", type=int, default=5, help="Number of chunks")
    parser.add_argument("--filter", "-f", type=str, default=None, help="Filter source substring")
    parser.add_argument("--index-dir", type=str, default=None, help="Index directory path")

    args = parser.parse_args()

    try:
        res = run_query(
            query=args.query,
            top_k=args.top_k,
            filter_source=args.filter,
            index_dir_override=args.index_dir,
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "results": [],
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
