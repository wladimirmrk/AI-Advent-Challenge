from dataclasses import dataclass
import time
from typing import List, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from src.agent.rag_agent import RetrievedSource


@dataclass
class FilterResult:
    kept_sources: List["RetrievedSource"]
    dropped_sources: List["RetrievedSource"]
    threshold: float
    initial_count: int
    kept_count: int
    dropped_count: int
    fall_soft_triggered: bool = False
    filter_latency: float = 0.0


class RelevanceFilter:
    """
    Filters retrieved candidate chunks by cosine similarity score threshold.
    Prunes low-relevance noise while maintaining a fall-soft safety guard
    to avoid empty context when query formulation has lower general similarity.
    """

    def __init__(self, default_threshold: float = 0.45, min_retained: int = 1):
        self.default_threshold = default_threshold
        self.min_retained = min_retained

    def filter(
        self,
        sources: List["RetrievedSource"],
        threshold: float = None,
    ) -> FilterResult:
        """
        Filter sources using similarity score >= threshold.
        """
        t0 = time.time()
        thresh = threshold if threshold is not None else self.default_threshold

        if not sources:
            return FilterResult(
                kept_sources=[],
                dropped_sources=[],
                threshold=thresh,
                initial_count=0,
                kept_count=0,
                dropped_count=0,
                fall_soft_triggered=False,
                filter_latency=time.time() - t0,
            )

        kept: List["RetrievedSource"] = []
        dropped: List["RetrievedSource"] = []

        for s in sources:
            if s.score >= thresh:
                kept.append(s)
            else:
                dropped.append(s)

        fall_soft = False
        # Fall-soft safety: if nothing passes the threshold, preserve the top min_retained items
        if not kept and sources and self.min_retained > 0:
            fall_soft = True
            # Sort descending by score
            sorted_candidates = sorted(sources, key=lambda x: x.score, reverse=True)
            kept = sorted_candidates[: self.min_retained]
            dropped = sorted_candidates[self.min_retained :]

        return FilterResult(
            kept_sources=kept,
            dropped_sources=dropped,
            threshold=thresh,
            initial_count=len(sources),
            kept_count=len(kept),
            dropped_count=len(dropped),
            fall_soft_triggered=fall_soft,
            filter_latency=time.time() - t0,
        )
