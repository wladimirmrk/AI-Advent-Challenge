import time
from dataclasses import dataclass, field
from typing import List, Optional

from src.agent.openrouter_client import OpenRouterClient, OpenRouterResponse
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.storage.vector_store import SearchResult, VectorStore


@dataclass
class RetrievedSource:
    rank: int
    score: float
    source: str
    section: str
    start_line: Optional[int]
    end_line: Optional[int]
    content: str

    @property
    def citation(self) -> str:
        s_line = f":L{self.start_line}" if self.start_line is not None else ""
        e_line = f"-L{self.end_line}" if self.end_line is not None else ""
        return f"[Source: {self.source}{s_line}{e_line}]"


@dataclass
class RAGResult:
    question: str
    answer: str
    use_rag: bool
    sources: List[RetrievedSource] = field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_seconds: float = 0.0
    retrieval_latency: float = 0.0
    llm_latency: float = 0.0
    context_text: str = ""


class RAGAgent:
    """Agent executing dual-mode (RAG vs No-RAG) questions against the CryptoTrack knowledge base."""

    def __init__(
        self,
        vector_store: VectorStore,
        embedder: OllamaEmbedder,
        llm_client: OpenRouterClient,
        default_top_k: int = 5,
    ):
        self.vector_store = vector_store
        self.embedder = embedder
        self.llm_client = llm_client
        self.default_top_k = default_top_k

    def build_rag_prompt(self, question: str, sources: List[RetrievedSource]) -> List[dict]:
        """Construct system and user messages containing retrieved context chunks."""
        context_parts = []
        for src in sources:
            lines_info = (
                f" (строки L{src.start_line}-L{src.end_line})"
                if src.start_line is not None and src.end_line is not None
                else ""
            )
            context_parts.append(
                f"### Источник #{src.rank}: `{src.source}`{lines_info}\n"
                f"Секция / Символ: `{src.section}`\n"
                f"Косинусная релевантность: {src.score:.4f}\n"
                f"```text\n{src.content.strip()}\n```"
            )

        context_block = "\n\n".join(context_parts)

        system_instruction = (
            "Вы — экспертный AI-архитектор кодовой базы проекта CryptoTrack "
            "(Android-приложение: Kotlin, Jetpack Compose, Room, Hilt, Clean Architecture, Gradle Convention Plugins).\n\n"
            "Ваша задача — предоставить точный, конкретный и исчерпывающий ответ на вопрос пользователя, "
            "опираясь СТРОГО на предоставленный ниже проверенный контекст из кодовой базы.\n\n"
            "Правила ответа:\n"
            "1. Опирайтесь на предоставленный контекст. Называйте точные имена классов, методов, типов и пакетов, "
            "присутствующие в сниппетах.\n"
            "2. Обязательно подтверждайте утверждения ссылками на источники в формате `[Source: path/to/file:Lstart-Lend]`.\n"
            "3. Если в предоставленных фрагментах отсутствует требуемая информация, прямо и честно напишите: "
            "«В предоставленном контексте кодовой базы отсутствуют сведения о...» и укажите, чего именно не хватает, "
            "не придумывая детали реализации.\n"
            "4. Ответ должен быть на русском языке, технический код и названия сущностей — на языке оригинала."
        )

        user_content = (
            f"КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ CRYPTOTRACK:\n\n"
            f"{context_block}\n\n"
            f"----------------------------------------\n"
            f"ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n{question}\n\n"
            f"Сформируйте структурированный ответ со ссылками на источники из контекста:"
        )

        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content},
        ]

    def build_no_rag_prompt(self, question: str) -> List[dict]:
        """Construct standard prompt without any codebase context."""
        system_instruction = (
            "Вы — полезный AI-ассистент по программированию и архитектуре Android-приложений.\n"
            "Ответьте на вопрос пользователя на основе ваших общих знаний об Android, Kotlin, Clean Architecture, "
            "Room, Jetpack Compose и Hilt.\n"
            "Если вопрос касается внутренней или приватной кодовой базы конкретного неизвестного проекта, "
            "отвечайте в меру своих общих предположений и общепринятых паттернов индустрии."
        )
        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": question},
        ]

    def retrieve_chunks(
        self,
        question: str,
        top_k: int,
        filter_source: Optional[str] = None,
    ) -> List[RetrievedSource]:
        """Retrieve most relevant chunks from the vector store with asymmetric query prefix and RRF fusion."""
        # 1. Primary semantic query with Nomic search_query prefix
        q_clean = question.strip()
        q_formatted = f"search_query: {q_clean}" if not q_clean.startswith("search_query:") else q_clean
        q_vec = self.embedder.embed_query(q_formatted)
        results1 = self.vector_store.search(q_vec, top_k=max(top_k * 2, 8), filter_source=filter_source)

        # 2. Secondary search for explicit technical/code identifiers if present
        import re
        latin_terms = [
            w for w in re.findall(r"[A-Za-z0-9_]{3,}", question)
            if w.lower() not in {"how", "the", "and", "for", "cryptotrack"}
        ]
        results2 = []
        if latin_terms:
            tech_q = f"search_query: {' '.join(latin_terms)}"
            tech_vec = self.embedder.embed_query(tech_q)
            results2 = self.vector_store.search(tech_vec, top_k=max(top_k * 2, 8), filter_source=filter_source)

        # 3. Reciprocal Rank Fusion (RRF) with production source and symbol awareness
        rrf_scores = {}
        chunk_map = {}
        is_test_query = any(w in question.lower() for w in ["test", "тест", "проверк", "mock", "фейк"])

        for rank, r in enumerate(results1, 1):
            cid = r.chunk.chunk_id
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.0 / (60.0 + rank))
            chunk_map[cid] = (r.chunk, r.score)

        for rank, r in enumerate(results2, 1):
            cid = r.chunk.chunk_id
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.5 / (60.0 + rank))
            if cid not in chunk_map:
                chunk_map[cid] = (r.chunk, r.score)

        # Apply source & symbol weighting
        weighted_scores = {}
        for cid, base_score in rrf_scores.items():
            chunk, _ = chunk_map[cid]
            multiplier = 1.0
            norm_source = chunk.source.replace("\\", "/")

            # Prefer production code over test fixtures unless query explicitly asks for tests
            if not is_test_query:
                if "/src/main/" in norm_source:
                    multiplier *= 1.25
                elif "/src/test/" in norm_source:
                    multiplier *= 0.70

            # Symbol match bonus: specific code identifiers matching file stem or section
            if latin_terms:
                from pathlib import Path
                stem = Path(chunk.source).stem.lower()
                symbol_score = 0.0
                for t in latin_terms:
                    t_low = t.lower()
                    if len(t) >= 4:
                        if t_low == stem:
                            symbol_score += 2.0
                        elif t_low in stem or t_low in chunk.section.lower():
                            symbol_score += 0.5 * (len(t) / 10.0)
                if symbol_score > 0:
                    multiplier *= (1.0 + symbol_score)

            weighted_scores[cid] = base_score * multiplier

        sorted_cids = sorted(weighted_scores.keys(), key=lambda cid: weighted_scores[cid], reverse=True)[:top_k]

        sources = []
        for idx, cid in enumerate(sorted_cids, 1):
            chunk, score = chunk_map[cid]
            sources.append(
                RetrievedSource(
                    rank=idx,
                    score=score,
                    source=chunk.source,
                    section=chunk.section,
                    start_line=chunk.metadata.get("start_line"),
                    end_line=chunk.metadata.get("end_line"),
                    content=chunk.content,
                )
            )
        return sources


    def query(
        self,
        question: str,
        use_rag: bool = True,
        top_k: Optional[int] = None,
        model: Optional[str] = None,
        filter_source: Optional[str] = None,
        temperature: float = 0.2,
    ) -> RAGResult:
        """Execute full pipeline: question -> retrieval (if RAG) -> prompt assembly -> LLM response."""
        t_start = time.time()
        k = top_k or self.default_top_k
        sources: List[RetrievedSource] = []
        retrieval_latency = 0.0
        context_text = ""

        if use_rag:
            t_r0 = time.time()
            sources = self.retrieve_chunks(question, top_k=k, filter_source=filter_source)
            retrieval_latency = time.time() - t_r0
            messages = self.build_rag_prompt(question, sources)
            context_text = messages[1]["content"]
        else:
            messages = self.build_no_rag_prompt(question)

        llm_resp: OpenRouterResponse = self.llm_client.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
        )

        total_latency = time.time() - t_start

        return RAGResult(
            question=question,
            answer=llm_resp.content,
            use_rag=use_rag,
            sources=sources,
            model=llm_resp.model,
            prompt_tokens=llm_resp.prompt_tokens,
            completion_tokens=llm_resp.completion_tokens,
            total_tokens=llm_resp.total_tokens,
            latency_seconds=total_latency,
            retrieval_latency=retrieval_latency,
            llm_latency=llm_resp.latency_seconds,
            context_text=context_text,
        )
