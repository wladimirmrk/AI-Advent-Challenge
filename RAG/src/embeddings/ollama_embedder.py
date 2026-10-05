import time
from typing import List, Optional
import numpy as np
import requests
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn, TimeRemainingColumn

class OllamaEmbedder:
    """
    Client for generating embeddings using Ollama local API.
    Supports batching via `/api/embed` and falls back to `/api/embeddings`.
    Normalizes vectors to unit length (L2 norm) for cosine similarity.
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11434",
        model: str = "nomic-embed-text",
        batch_size: int = 32,
        timeout: int = 60,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.batch_size = batch_size
        self.timeout = timeout
        self.embed_dim: Optional[int] = None
        self.session = requests.Session()

    def _normalize(self, vectors: np.ndarray) -> np.ndarray:
        """L2-normalize vectors so that inner product equals cosine similarity."""
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        # Avoid division by zero
        norms[norms == 0] = 1e-12
        return (vectors / norms).astype(np.float32)

    def embed_texts(self, texts: List[str], show_progress: bool = True) -> np.ndarray:
        """Embed a list of text strings in batches, returning a normalized 2D numpy array."""
        if not texts:
            return np.empty((0, self.embed_dim or 768), dtype=np.float32)

        all_embeddings: List[List[float]] = []

        total_batches = (len(texts) + self.batch_size - 1) // self.batch_size

        if show_progress:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
            ) as progress:
                task = progress.add_task(
                    f"Generating embeddings ({self.model})...", total=len(texts)
                )
                for i in range(0, len(texts), self.batch_size):
                    batch = texts[i : i + self.batch_size]
                    batch_vecs = self._embed_batch(batch)
                    all_embeddings.extend(batch_vecs)
                    progress.advance(task, len(batch))
        else:
            for i in range(0, len(texts), self.batch_size):
                batch = texts[i : i + self.batch_size]
                batch_vecs = self._embed_batch(batch)
                all_embeddings.extend(batch_vecs)

        arr = np.array(all_embeddings, dtype=np.float32)
        if arr.shape[0] > 0:
            self.embed_dim = arr.shape[1]
            arr = self._normalize(arr)
        return arr

    def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query string for retrieval."""
        res = self.embed_texts([query], show_progress=False)
        return res[0]

    def _embed_batch(self, batch: List[str]) -> List[List[float]]:
        """Try batch /api/embed first, fallback to /api/embeddings per item."""
        # Sanitize texts (empty texts can cause 400 in some embed APIs)
        safe_batch = [t if t.strip() else " " for t in batch]

        try:
            resp = self.session.post(
                f"{self.base_url}/api/embed",
                json={"model": self.model, "input": safe_batch},
                timeout=self.timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                embeddings = data.get("embeddings", [])
                if len(embeddings) == len(batch):
                    return embeddings
        except Exception:
            pass

        # Fallback to single-item /api/embeddings
        fallback_embeddings: List[List[float]] = []
        for text in safe_batch:
            resp = self.session.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": text},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            fallback_embeddings.append(resp.json()["embedding"])
        return fallback_embeddings
