from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

if TYPE_CHECKING:
    from src.agent.rag_agent import RetrievedSource
from src.grounding.models import GroundedAnswer, GroundedQuote, GroundedSource


@dataclass
class ValidationResult:
    has_sources: bool
    has_quotes: bool
    grounding_score: float          # 0.0 - 1.0: fraction of authentic quotes found in chunks
    faithfulness_score: float       # 0.0 - 1.0: semantic/lexical alignment of answer to quotes
    is_aligned: bool                # True if answer is sufficiently supported by quotes
    verified_quotes_count: int
    total_quotes_count: int
    unsupported_claims: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)


class GroundingValidator:
    """Validator ensuring that answers from RAG contain authentic citations, verified quotes,

    and that the answer semantically aligns with the retrieved context without hallucination.
    """

    def __init__(
        self,
        min_quote_match_ratio: float = 0.70,
        min_faithfulness_ratio: float = 0.50,
    ):
        self.min_quote_match_ratio = min_quote_match_ratio
        self.min_faithfulness_ratio = min_faithfulness_ratio

    @staticmethod
    def _normalize_text(text: str) -> str:
        """Strip punctuation, excessive whitespaces, and markdown symbols for robust matching."""
        # Replace backticks, quotes, line breaks
        cleaned = re.sub(r"[`'\"*_\r]", " ", text)
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned.strip().lower()

    def verify_quote_in_chunks(
        self,
        quote_text: str,
        retrieved_chunks: List[RetrievedSource],
    ) -> Tuple[bool, float, Optional[RetrievedSource]]:
        """Verify if a quote is authentically present in any of the retrieved chunks."""
        q_clean = quote_text.strip()
        if not q_clean:
            return False, 0.0, None

        q_norm = self._normalize_text(q_clean)
        best_ratio = 0.0
        best_chunk: Optional[RetrievedSource] = None

        # 1. Exact raw substring match
        for chunk in retrieved_chunks:
            if q_clean in chunk.content:
                return True, 1.0, chunk

        # 2. Normalized substring match
        for chunk in retrieved_chunks:
            c_norm = self._normalize_text(chunk.content)
            if q_norm in c_norm:
                return True, 1.0, chunk

            # Substring matching in sliding window or token overlap
            q_words = q_norm.split()
            if len(q_words) >= 3:
                # Check sliding window of word length
                c_words = c_norm.split()
                w_len = len(q_words)
                for i in range(max(1, len(c_words) - w_len + 1)):
                    sub_win = " ".join(c_words[i : i + w_len])
                    matcher = difflib.SequenceMatcher(None, q_norm, sub_win)
                    ratio = matcher.ratio()
                    if ratio > best_ratio:
                        best_ratio = ratio
                        best_chunk = chunk
                        if best_ratio >= 0.95:
                            return True, 1.0, chunk
            else:
                # Direct string similarity for short quotes
                matcher = difflib.SequenceMatcher(None, q_norm, c_norm[:1000])
                ratio = matcher.ratio()
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_chunk = chunk

        is_match = best_ratio >= self.min_quote_match_ratio
        return is_match, best_ratio, best_chunk

    def calculate_faithfulness(
        self,
        answer: str,
        quotes: List[GroundedQuote],
        retrieved_chunks: List[RetrievedSource],
    ) -> Tuple[float, List[str]]:
        """Calculate semantic/lexical alignment score between answer and quotes/chunks.

        Checks whether key technical entities and sentences in answer are substantiated by quotes.
        """
        if not answer.strip():
            return 0.0, []

        # If answer is an explicit refusal ("не знаю" / "отсутствуют сведения"), it is 100% faithful to zero-knowledge
        refusal_keywords = [
            "не знаю",
            "не найден",
            "отсутствуют сведения",
            "не содержит",
            "нет достаточной информации",
            "не нашел",
            "не удалось найти",
            "нет информации",
        ]
        a_low = answer.lower()
        if any(kw in a_low for kw in refusal_keywords):
            return 1.0, []

        # Extract context text from quotes and chunks
        quotes_text = " ".join(q.text for q in quotes if q.is_exact_match or q.match_similarity >= 0.5)
        all_context_text = quotes_text + " " + " ".join(c.content for c in retrieved_chunks)
        ctx_norm = self._normalize_text(all_context_text)

        # 1. Technical identifier extraction (Latin class/method/variable names)
        # e.g., AssetAmountValidator, sanitize, RoomDatabase, CryptoTrackDatabase
        tech_entities = set(re.findall(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b", answer))
        # Filter out common stop words
        stop_tech = {
            "the", "and", "for", "with", "this", "that", "from", "are", "not", "use", "val", "var", "fun",
            "class", "source", "true", "false", "null", "all", "out", "new", "get", "set"
        }
        tech_entities = {e for e in tech_entities if e.lower() not in stop_tech}

        if tech_entities:
            matched_entities = sum(1 for e in tech_entities if e.lower() in ctx_norm)
            entity_score = matched_entities / len(tech_entities)
        else:
            entity_score = 1.0

        # 2. Backtick code symbols in answer (e.g. `AssetAmountValidator`, `sanitize`)
        backtick_symbols = set(re.findall(r"`([^`]+)`", answer))
        if backtick_symbols:
            matched_backticks = sum(1 for s in backtick_symbols if self._normalize_text(s) in ctx_norm)
            backtick_score = matched_backticks / len(backtick_symbols)
        else:
            backtick_score = entity_score

        # 3. Verified quotes support score
        valid_quotes = [q for q in quotes if q.is_exact_match or q.match_similarity >= 0.70]
        quote_support_score = min(1.0, len(valid_quotes) / max(len(quotes), 1)) if quotes else 0.0

        # 4. Check for hallucinated claims/sentences
        unsupported = []
        sentences = [s.strip() for s in re.split(r"[.!?\n]+", answer) if len(s.strip()) > 15]
        for sent in sentences:
            s_entities = set(re.findall(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b", sent)) - stop_tech
            if s_entities:
                hits = sum(1 for e in s_entities if e.lower() in ctx_norm)
                if (hits / len(s_entities)) < 0.40:
                    unsupported.append(sent)

        # Composite technical faithfulness score
        faithfulness = 0.50 * entity_score + 0.30 * backtick_score + 0.20 * quote_support_score
        return round(min(1.0, max(0.0, faithfulness)), 4), unsupported

    def validate(
        self,
        grounded_answer: GroundedAnswer,
        retrieved_chunks: List[RetrievedSource],
    ) -> ValidationResult:
        """Run complete validation suite over the GroundedAnswer."""
        # 1. Check sources
        has_sources = len(grounded_answer.sources) > 0

        # 2. Check and verify quotes against retrieved chunks
        verified_count = 0
        total_quotes = len(grounded_answer.quotes)

        for q in grounded_answer.quotes:
            is_match, ratio, chunk = self.verify_quote_in_chunks(q.text, retrieved_chunks)
            q.is_exact_match = is_match
            q.match_similarity = ratio
            if chunk:
                q.matched_chunk_id = f"{chunk.source}:L{chunk.start_line}-L{chunk.end_line}"
                if not q.source:
                    q.source = chunk.source
                if not q.section:
                    q.section = chunk.section

            if is_match:
                verified_count += 1

        grounding_score = verified_count / total_quotes if total_quotes > 0 else 0.0
        grounded_answer.grounding_score = round(grounding_score, 4)

        # 3. Calculate Faithfulness / Semantic Alignment
        faithfulness_score, unsupported_claims = self.calculate_faithfulness(
            grounded_answer.answer,
            grounded_answer.quotes,
            retrieved_chunks,
        )
        grounded_answer.faithfulness_score = faithfulness_score

        # Determine alignment
        is_refusal = grounded_answer.is_refusal
        is_aligned = is_refusal or (
            has_sources
            and total_quotes > 0
            and grounding_score >= 0.50
            and faithfulness_score >= self.min_faithfulness_ratio
        )

        return ValidationResult(
            has_sources=has_sources,
            has_quotes=total_quotes > 0,
            grounding_score=grounded_answer.grounding_score,
            faithfulness_score=faithfulness_score,
            is_aligned=is_aligned,
            verified_quotes_count=verified_count,
            total_quotes_count=total_quotes,
            unsupported_claims=unsupported_claims,
            details={
                "has_sources": has_sources,
                "sources_count": len(grounded_answer.sources),
                "quotes_count": total_quotes,
                "verified_quotes": verified_count,
                "grounding_score": grounded_answer.grounding_score,
                "faithfulness_score": faithfulness_score,
                "is_refusal": is_refusal,
            },
        )
