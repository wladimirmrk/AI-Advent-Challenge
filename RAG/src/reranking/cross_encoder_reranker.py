import math
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from src.agent.rag_agent import RetrievedSource


@dataclass
class RerankResult:
    query: str
    sources: List["RetrievedSource"]
    initial_count: int
    final_count: int
    rerank_latency: float
    engine: str  # "flashrank" or "fallback_cross_encoder"


class FallbackCrossEncoder:
    """
    Lightweight, deterministic cross-encoder scoring engine for code and technical text.
    Combines BM25-style term frequency, exact code identifier overlap,
    and structural header/symbol affinity.
    """

    def score_pair(self, query: str, content: str, source_path: str = "", section: str = "") -> float:
        q_tokens = re.findall(r"[\w]+", query.lower())
        if not q_tokens:
            return 0.0

        c_tokens = re.findall(r"[\w]+", content.lower())
        c_text_low = content.lower()
        if not c_tokens:
            return 0.0

        # 1. Exact phrase and technical term matches
        raw_symbols = re.findall(r"[A-Za-z0-9_]{3,}", query)
        symbol_bonus = 0.0
        path_low = source_path.lower().replace("\\", "/")
        section_low = section.lower()

        for sym in raw_symbols:
            s_low = sym.lower()
            if len(s_low) >= 4:
                stem = Path(source_path).stem.lower()
                if s_low == stem:
                    symbol_bonus += 1.5
                elif s_low in stem:
                    symbol_bonus += 0.8
                elif s_low in section_low:
                    symbol_bonus += 0.5
                elif s_low in path_low:
                    symbol_bonus += 0.35
            if s_low in c_text_low:
                cnt = c_text_low.count(s_low)
                symbol_bonus += min(0.50, 0.15 * math.log2(cnt + 1))

        # 2. Term frequency / BM25 term coverage
        c_set = set(c_tokens)
        matched_tokens = [t for t in q_tokens if t in c_set]
        token_coverage = len(matched_tokens) / len(q_tokens) if q_tokens else 0.0

        # 3. Soft density score
        tf_sum = 0.0
        for t in matched_tokens:
            tf = c_tokens.count(t)
            tf_sum += (tf / (tf + 1.5))

        base_score = 0.4 * token_coverage + 0.3 * (tf_sum / (len(q_tokens) + 1e-5)) + 0.3 * min(1.0, symbol_bonus)
        # Sigmoid squeeze centered around 0.35 for technical code affinity
        return round(1.0 / (1.0 + math.exp(-4.0 * (base_score - 0.35))), 4)


class CrossEncoderReranker:
    """
    Second-stage Cross-Encoder Reranker that scores and reorders candidate chunks
    based on deep query-document cross-attention relevance.
    """

    def __init__(
        self,
        model_name: str = "ms-marco-TinyBERT-L-2-v2",
        cache_dir: Optional[Path] = None,
        use_fallback_only: bool = False,
    ):
        self.model_name = model_name
        self.cache_dir = cache_dir or Path(os.getenv("RERANKER_CACHE_DIR", "./data/models"))
        self.use_fallback_only = use_fallback_only
        self._ranker = None
        self._fallback = FallbackCrossEncoder()
        self._init_engine()

    def _init_engine(self):
        if self.use_fallback_only:
            return

        try:
            from flashrank import Ranker  # type: ignore
            # Initialize FlashRank with TinyBERT or MiniLM
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._ranker = Ranker(model_name=self.model_name, cache_dir=str(self.cache_dir))
        except Exception:
            self._ranker = None

    def rerank(
        self,
        query: str,
        sources: List["RetrievedSource"],
        top_k: int = 4,
    ) -> RerankResult:
        """
        Reranks candidates against the given query and returns top_k sources.
        """
        t0 = time.time()
        initial_count = len(sources)

        if not sources or top_k <= 0:
            return RerankResult(
                query=query,
                sources=[],
                initial_count=initial_count,
                final_count=0,
                rerank_latency=time.time() - t0,
                engine="none",
            )

        engine_used = "flashrank"
        scored_pairs = []

        if self._ranker is not None:
            try:
                from flashrank import RerankRequest  # type: ignore

                passages = [
                    {"id": idx, "text": f"{s.source} {s.section}\n{s.content}"}
                    for idx, s in enumerate(sources)
                ]
                req = RerankRequest(query=query, passages=passages)
                results = self._ranker.rerank(req)
                
                # results is a list of dicts with 'id' and 'score'
                for r in results:
                    orig_idx = int(r["id"])
                    src = sources[orig_idx]
                    neural_s = float(r["score"])
                    code_s = self._fallback.score_pair(query, src.content, src.source, src.section)
                    src.rerank_score = round(0.5 * neural_s + 0.5 * code_s, 4)
                    scored_pairs.append(src)
            except Exception:
                # Fall back to FallbackCrossEncoder if FlashRank runtime encounters error
                engine_used = "fallback_cross_encoder"
                scored_pairs = self._rerank_with_fallback(query, sources)
        else:
            engine_used = "fallback_cross_encoder"
            scored_pairs = self._rerank_with_fallback(query, sources)

        # Sort descending by rerank_score
        scored_pairs.sort(key=lambda s: s.rerank_score or 0.0, reverse=True)
        top_sources = scored_pairs[:top_k]

        # Re-assign ranks 1..K
        for rank, s in enumerate(top_sources, 1):
            s.rank = rank

        return RerankResult(
            query=query,
            sources=top_sources,
            initial_count=initial_count,
            final_count=len(top_sources),
            rerank_latency=time.time() - t0,
            engine=engine_used,
        )

    def _rerank_with_fallback(
        self,
        query: str,
        sources: List["RetrievedSource"],
    ) -> List["RetrievedSource"]:
        results = []
        for s in sources:
            score = self._fallback.score_pair(
                query=query,
                content=s.content,
                source_path=s.source,
                section=s.section,
            )
            s.rerank_score = score
            results.append(s)
        return results
