import json
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class GroundedSource:
    source: str
    section: str = ""
    chunk_id: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    score: float = 0.0
    rerank_score: Optional[float] = None
    rank: int = 1

    @property
    def location_str(self) -> str:
        loc = f":L{self.start_line}" if self.start_line is not None else ""
        if self.end_line is not None:
            loc += f"-L{self.end_line}"
        sec = f"#{self.section}" if self.section else ""
        cid = f" [id={self.chunk_id}]" if self.chunk_id else ""
        return f"{self.source}{loc}{sec}{cid}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "section": self.section,
            "chunk_id": self.chunk_id,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "score": round(self.score, 4),
            "rerank_score": round(self.rerank_score, 4) if self.rerank_score is not None else None,
            "rank": self.rank,
        }


@dataclass
class GroundedQuote:
    text: str
    source: Optional[str] = None
    section: Optional[str] = None
    chunk_id: Optional[str] = None
    is_exact_match: bool = False
    match_similarity: float = 0.0
    matched_chunk_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "source": self.source,
            "section": self.section,
            "chunk_id": self.chunk_id,
            "is_exact_match": self.is_exact_match,
            "match_similarity": round(self.match_similarity, 4),
            "matched_chunk_id": self.matched_chunk_id,
        }


@dataclass
class GroundedCitation:
    source_ref: str
    quote: str
    verified: bool = False


@dataclass
class GroundedAnswer:
    answer: str
    sources: List[GroundedSource] = field(default_factory=list)
    quotes: List[GroundedQuote] = field(default_factory=list)
    status: str = "grounded"  # "grounded", "refusal", "no_context", "unsupported"
    needs_clarification: bool = False
    clarification_prompt: Optional[str] = None
    grounding_score: float = 0.0       # 0.0 - 1.0 (% of quotes verified in retrieved chunks)
    faithfulness_score: float = 0.0    # 0.0 - 1.0 (semantic alignment between answer and quotes)
    top_relevance_score: float = 0.0   # highest cosine/rerank score among retrieved chunks
    cutoff_threshold: float = 0.58
    model: str = ""
    raw_response_text: str = ""

    @property
    def has_sources(self) -> bool:
        return len(self.sources) > 0

    @property
    def has_quotes(self) -> bool:
        return len(self.quotes) > 0

    @property
    def is_refusal(self) -> bool:
        return self.status in {"refusal", "no_context"}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "answer": self.answer,
            "sources": [s.to_dict() for s in self.sources],
            "quotes": [q.to_dict() for q in self.quotes],
            "status": self.status,
            "needs_clarification": self.needs_clarification,
            "clarification_prompt": self.clarification_prompt,
            "grounding_score": round(self.grounding_score, 4),
            "faithfulness_score": round(self.faithfulness_score, 4),
            "top_relevance_score": round(self.top_relevance_score, 4),
            "cutoff_threshold": round(self.cutoff_threshold, 4),
            "has_sources": self.has_sources,
            "has_quotes": self.has_quotes,
            "is_refusal": self.is_refusal,
            "model": self.model,
        }

    def to_markdown(self) -> str:
        """Render a clean GitHub-style Markdown representation of the grounded answer."""
        lines = []

        # 1. Status Badge & Header
        if self.is_refusal:
            status_badge = "🛡️ **[РЕЖИМ ОТКАЗА: НЕДОСТАТОЧНЫЙ КОНТЕКСТ]**"
        elif self.grounding_score >= 0.8 and self.faithfulness_score >= 0.7:
            status_badge = "✅ **[ПОДТВЕРЖДЕНО ИСТОЧНИКАМИ (GROUNDED)]**"
        elif self.grounding_score > 0:
            status_badge = "⚠️ **[ЧАСТИЧНО ПОДТВЕРЖДЕНО]**"
        else:
            status_badge = "❌ **[БЕЗ ПОДТВЕРЖДЕНИЯ]**"

        lines.append(f"### {status_badge}\n")

        # 2. Main Answer
        lines.append("#### 🤖 Ответ")
        lines.append(self.answer.strip() + "\n")

        # 3. Clarification request if needed
        if self.needs_clarification and self.clarification_prompt:
            lines.append("> [!TIP]")
            lines.append(f"> **Уточнение для пользователя:** {self.clarification_prompt}\n")

        # 4. Sources Section
        lines.append("#### 📚 Список источников")
        if self.sources:
            for idx, src in enumerate(self.sources, 1):
                sec_part = f" (`{src.section}`)" if src.section else ""
                chunk_part = f" [chunk_id: `{src.chunk_id}`]" if src.chunk_id else ""
                lines_part = (
                    f":L{src.start_line}-L{src.end_line}"
                    if src.start_line is not None and src.end_line is not None
                    else ""
                )
                score_part = f" _(relevance: {src.score:.3f}_"
                if src.rerank_score is not None:
                    score_part += f", rerank: {src.rerank_score:.3f}"
                score_part += ")"

                lines.append(f"{idx}. `{src.source}{lines_part}`{sec_part}{chunk_part} {score_part}")
        else:
            lines.append("_Источники отсутствуют (релевантные фрагменты не найдены в кодовой базе)_")
        lines.append("")

        # 5. Quotes Section
        lines.append("#### 💬 Цитаты из найденных чанков")
        if self.quotes:
            for idx, q in enumerate(self.quotes, 1):
                match_icon = "✓" if q.is_exact_match else "~"
                src_ref = f"`{q.source}`" if q.source else "Context"
                if q.chunk_id:
                    src_ref += f" (id: `{q.chunk_id}`)"
                lines.append(f"> **Цитата #{idx}** [{match_icon} Grounded in {src_ref}]:")
                quote_lines = q.text.strip().split("\n")
                for ql in quote_lines:
                    lines.append(f"> {ql}")
                lines.append("")
        else:
            lines.append("_Цитаты не предоставлены._\n")

        # 6. Verification Metrics
        lines.append("---")
        lines.append(
            f"**Метрики проверки:** "
            f"Источники: `{'✓' if self.has_sources else '✗'}` ({len(self.sources)}) | "
            f"Цитаты: `{'✓' if self.has_quotes else '✗'}` ({len(self.quotes)}) | "
            f"Подлинность цитат (Grounding): `{self.grounding_score * 100:.1f}%` | "
            f"Семантическое соответствие (Faithfulness): `{self.faithfulness_score * 100:.1f}%` | "
            f"Top Relevance: `{self.top_relevance_score:.4f}` (Порог: `{self.cutoff_threshold:.2f}`)"
        )

        return "\n".join(lines)
