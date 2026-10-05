import time
from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

from src.reranking.relevance_filter import RelevanceFilter, FilterResult
from src.reranking.cross_encoder_reranker import CrossEncoderReranker, RerankResult

if TYPE_CHECKING:
    from src.agent.rag_agent import RetrievedSource


@dataclass
class PipelineResult:
    query: str
    final_sources: List["RetrievedSource"] = field(default_factory=list)
    initial_count: int = 0
    after_filter_count: int = 0
    dropped_by_filter: int = 0
    final_count: int = 0
    threshold: float = 0.45
    fall_soft_triggered: bool = False
    filter_latency: float = 0.0
    rerank_latency: float = 0.0
    total_latency: float = 0.0
    rerank_engine: str = "none"


class TwoStageRetrievalPipeline:
    """
    Coordinates Stage 2 post-retrieval refinement:
    1. Relevance Filter: cuts off chunks with cosine similarity < threshold.
    2. Cross-Encoder Reranker: scores candidate pairs and returns top_k_final.
    """

    def __init__(
        self,
        relevance_filter: Optional[RelevanceFilter] = None,
        reranker: Optional[CrossEncoderReranker] = None,
        default_threshold: float = 0.45,
        default_final_top_k: int = 4,
    ):
        self.relevance_filter = relevance_filter or RelevanceFilter(default_threshold=default_threshold)
        self.reranker = reranker or CrossEncoderReranker()
        self.default_threshold = default_threshold
        self.default_final_top_k = default_final_top_k

    def process(
        self,
        query: str,
        candidates: List["RetrievedSource"],
        threshold: Optional[float] = None,
        final_top_k: Optional[int] = None,
    ) -> PipelineResult:
        """
        Execute filtering followed by cross-encoder reranking.
        """
        t0 = time.time()
        thresh = threshold if threshold is not None else self.default_threshold
        k_final = final_top_k if final_top_k is not None else self.default_final_top_k

        # 1. Relevance filter
        f_res: FilterResult = self.relevance_filter.filter(candidates, threshold=thresh)

        # 2. Cross-Encoder Reranking
        r_res: RerankResult = self.reranker.rerank(
            query=query,
            sources=f_res.kept_sources,
            top_k=k_final,
        )

        total_time = time.time() - t0

        return PipelineResult(
            query=query,
            final_sources=r_res.sources,
            initial_count=len(candidates),
            after_filter_count=f_res.kept_count,
            dropped_by_filter=f_res.dropped_count,
            final_count=len(r_res.sources),
            threshold=thresh,
            fall_soft_triggered=f_res.fall_soft_triggered,
            filter_latency=f_res.filter_latency,
            rerank_latency=r_res.rerank_latency,
            total_latency=total_time,
            rerank_engine=r_res.engine,
        )
