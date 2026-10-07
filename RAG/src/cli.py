import argparse
import io
import os
import sys
import time
from pathlib import Path
from typing import Optional

# Ensure RAG project root is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Ensure UTF-8 output on Windows console
if sys.platform.startswith("win"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from rich.columns import Columns
from rich.markdown import Markdown

from src.config import default_config
from src.loader.project_loader import ProjectLoader
from src.chunking.fixed_chunker import FixedChunker
from src.chunking.structural_chunker import StructuralChunker
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.storage.vector_store import VectorStore
from src.evaluation.comparator import ChunkComparator
from src.agent.openrouter_client import OpenRouterClient, OpenRouterError
from src.agent.rag_agent import RAGAgent
from src.evaluation.benchmark_dataset import BENCHMARK_QUESTIONS
from src.evaluation.rag_evaluator import RAGEvaluator
from src.evaluation.rerank_evaluator import RerankEvaluator
from src.evaluation.grounded_evaluator import GroundedEvaluator, GROUNDED_BENCHMARK_SUITE
from src.chat import ChatSession, MemoryChatEngine, SessionStore, TaskState

import shutil

def get_terminal_width(preferred_width: Optional[int] = None) -> int:
    """Detect actual visible window width, especially in Windows cmd.exe, with optional override."""
    if preferred_width and preferred_width > 0:
        return preferred_width

    # 1. Respect explicit COLUMNS env var
    env_cols = os.environ.get("COLUMNS")
    if env_cols and env_cols.isdigit():
        return int(env_cols)

    # 2. Try Windows CONOUT$ visible window rectangle (srWindow), NOT the buffer width
    if sys.platform.startswith("win"):
        try:
            import ctypes
            from ctypes import wintypes
            h = ctypes.windll.kernel32.CreateFileW(
                "CONOUT$",
                0x80000000 | 0x40000000,
                0x00000001 | 0x00000002,
                None,
                3,
                0,
                None
            )
            if h and h != -1:
                class SMALL_RECT(ctypes.Structure):
                    _fields_ = [
                        ('Left', ctypes.c_short),
                        ('Top', ctypes.c_short),
                        ('Right', ctypes.c_short),
                        ('Bottom', ctypes.c_short),
                    ]
                class CSBI(ctypes.Structure):
                    _fields_ = [
                        ('dwSize', wintypes._COORD),
                        ('dwCursorPosition', wintypes._COORD),
                        ('wAttributes', wintypes.WORD),
                        ('srWindow', SMALL_RECT),
                        ('dwMaximumWindowSize', wintypes._COORD),
                    ]
                csbi = CSBI()
                if ctypes.windll.kernel32.GetConsoleScreenBufferInfo(h, ctypes.byref(csbi)):
                    win_w = csbi.srWindow.Right - csbi.srWindow.Left + 1
                    ctypes.windll.kernel32.CloseHandle(h)
                    if win_w >= 20:
                        return win_w
                ctypes.windll.kernel32.CloseHandle(h)
        except Exception:
            pass

    # 3. Fallback to shutil
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except Exception:
        return 80


def setup_console(args: Optional[argparse.Namespace] = None) -> Console:
    """Ensure console uses the true visible width of the window."""
    preferred = getattr(args, "width", None) if args else None
    detected = get_terminal_width(preferred)
    console._width = detected
    return console


console = Console()

def run_index(args):
    project_path = args.project_path or default_config.project_path
    console.print(f"\n[bold green]=== Starting Document Indexing ===[/bold green]")
    console.print(f"[cyan]Target Project:[/cyan] {project_path}")
    console.print(f"[cyan]Strategy:[/cyan] {args.strategy}")
    console.print(f"[cyan]Ollama Model:[/cyan] {default_config.ollama_model} ({default_config.ollama_base_url})")

    # 1. Load documents
    ignore_patterns = args.exclude if args.exclude is not None else default_config.ignore_patterns
    loader = ProjectLoader(project_path, ignore_patterns=ignore_patterns)
    console.print("\n[yellow]Scanning project files...[/yellow]")
    if ignore_patterns:
        console.print(f"[dim]Excluded patterns: {ignore_patterns}[/dim]")
    t0 = time.time()
    docs = loader.load_documents(max_docs=args.max_docs)
    load_time = time.time() - t0
    summary = loader.summary(docs)

    console.print(f"[green]✓ Loaded {len(docs)} documents[/green] in {load_time:.2f}s")
    console.print(f"  • Total characters: {summary['total_chars']:,}")
    console.print(f"  • Total lines: {summary['total_lines']:,}")
    console.print(f"  • Estimated standard pages (~1800 chars): [bold]{summary['estimated_pages']}[/bold]")
    console.print(f"  • By type: {summary['by_type']}")

    embedder = OllamaEmbedder(
        base_url=default_config.ollama_base_url,
        model=default_config.ollama_model,
        batch_size=32,
    )

    strategies_to_run = []
    if args.strategy in {"fixed", "both"}:
        strategies_to_run.append("fixed")
    if args.strategy in {"structural", "both"}:
        strategies_to_run.append("structural")

    for strat in strategies_to_run:
        console.print(f"\n[bold magenta]--- Indexing Strategy: {strat.upper()} ---[/bold magenta]")
        if strat == "fixed":
            chunker = FixedChunker(
                chunk_size=args.chunk_size or default_config.fixed_chunk_size,
                chunk_overlap=args.overlap or default_config.fixed_chunk_overlap,
            )
            out_dir = default_config.fixed_index_dir
        else:
            chunker = StructuralChunker(
                max_chunk_size=default_config.structural_max_chunk_size,
                overlap=default_config.structural_chunk_overlap,
            )
            out_dir = default_config.structural_index_dir

        t_c0 = time.time()
        chunks = chunker.chunk_documents(docs)
        t_chunk = time.time() - t_c0
        console.print(f"[green]✓ Generated {len(chunks)} chunks[/green] in {t_chunk:.2f}s")

        # Embed
        texts = [c.content for c in chunks]
        t_e0 = time.time()
        embeddings = embedder.embed_texts(texts, show_progress=True)
        t_embed = time.time() - t_e0
        console.print(f"[green]✓ Generated embeddings ({embeddings.shape})[/green] in {t_embed:.2f}s")

        # Save
        store = VectorStore(dimension=embeddings.shape[1])
        store.add_chunks(chunks, embeddings)
        store.save(out_dir)
        console.print(f"[bold green]✓ Index saved to:[/bold green] {out_dir}")
        console.print(f"  • FAISS index: {out_dir / 'index.faiss'}")
        console.print(f"  • SQLite database: {out_dir / 'chunks.db'}")
        console.print(f"  • JSON metadata: {out_dir / 'chunks_metadata.json'}")

    console.print("\n[bold green]✓ All indexing completed successfully![/bold green]\n")


def run_benchmark(args):
    console.print(f"\n[bold green]=== Running Chunking Strategy Benchmark ===[/bold green]")
    fixed_dir = default_config.fixed_index_dir
    struct_dir = default_config.structural_index_dir

    if not (fixed_dir / "index.faiss").exists() or not (struct_dir / "index.faiss").exists():
        console.print("[red]Error: Indexes not found! Please run `index --strategy both` first.[/red]")
        sys.exit(1)

    console.print("[cyan]Loading Vector Stores...[/cyan]")
    fixed_store = VectorStore.load(fixed_dir)
    struct_store = VectorStore.load(struct_dir)
    console.print(f"  • Fixed Store: {fixed_store.index.ntotal} vectors")
    console.print(f"  • Structural Store: {struct_store.index.ntotal} vectors")

    comparator = ChunkComparator()
    stats_fixed = comparator.compute_statistics(fixed_store.chunks, "fixed")
    stats_struct = comparator.compute_statistics(struct_store.chunks, "structural")

    # Display stats table
    table = Table(title="Chunking Quantitative Statistics", header_style="bold cyan")
    table.add_column("Metric", style="white")
    table.add_column("Fixed-Size", style="yellow")
    table.add_column("Structural", style="green")

    table.add_row("Total Chunks", str(stats_fixed["total_chunks"]), str(stats_struct["total_chunks"]))
    table.add_row("Unique Sources", str(stats_fixed["unique_sources"]), str(stats_struct["unique_sources"]))
    table.add_row("Unique Sections", str(stats_fixed["unique_sections"]), str(stats_struct["unique_sections"]))
    table.add_row("Char Mean (Std)", f"{stats_fixed['char_mean']} (±{stats_fixed['char_std']})", f"{stats_struct['char_mean']} (±{stats_struct['char_std']})")
    table.add_row("Char Median", str(stats_fixed["char_median"]), str(stats_struct["char_median"]))
    table.add_row("Char Range (Min / Max)", f"{stats_fixed['char_min']} / {stats_fixed['char_max']}", f"{stats_struct['char_min']} / {stats_struct['char_max']}")
    table.add_row("Line Mean", str(stats_fixed["line_mean"]), str(stats_struct["line_mean"]))
    table.add_row("Estimated Tokens (Total / Mean)", f"{stats_fixed['total_tokens_est']:,} / {stats_fixed['tokens_mean_est']}", f"{stats_struct['total_tokens_est']:,} / {stats_struct['tokens_mean_est']}")
    table.add_row("Distribution: Small (<250 ch)", f"{stats_fixed['distribution_small_pct']}%", f"{stats_struct['distribution_small_pct']}%")
    table.add_row("Distribution: Medium (250-750 ch)", f"{stats_fixed['distribution_medium_pct']}%", f"{stats_struct['distribution_medium_pct']}%")
    table.add_row("Distribution: Large (>750 ch)", f"{stats_fixed['distribution_large_pct']}%", f"{stats_struct['distribution_large_pct']}%")

    console.print(table)

    embedder = OllamaEmbedder(
        base_url=default_config.ollama_base_url,
        model=default_config.ollama_model,
    )

    console.print("\n[cyan]Executing semantic test queries...[/cyan]")
    benchmark_results = comparator.benchmark(
        fixed_store=fixed_store,
        struct_store=struct_store,
        embedder=embedder,
        top_k=3,
    )

    bench_table = Table(title="Semantic Retrieval Benchmark", header_style="bold magenta")
    bench_table.add_column("Query", style="white", max_width=45)
    bench_table.add_column("Fixed Top-1 (Avg@3)", style="yellow")
    bench_table.add_column("Structural Top-1 (Avg@3)", style="green")
    bench_table.add_column("Advantage", style="bold cyan")

    for r in benchmark_results:
        winner = "Structural" if r.struct_top1_score >= r.fixed_top1_score else "Fixed"
        bench_table.add_row(
            r.query,
            f"{r.fixed_top1_score:.4f} ({r.fixed_avg3_score:.4f})",
            f"{r.struct_top1_score:.4f} ({r.struct_avg3_score:.4f})",
            winner,
        )
    console.print(bench_table)

    # Generate Markdown Report
    report_md = comparator.generate_report_markdown(stats_fixed, stats_struct, benchmark_results)
    out_path = default_config.comparison_report_path
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report_md)

    console.print(f"\n[bold green]✓ Full Markdown report saved to:[/bold green] {out_path}\n")


def run_search(args):
    strat = args.strategy.lower()
    index_dir = default_config.fixed_index_dir if strat == "fixed" else default_config.structural_index_dir

    if not (index_dir / "index.faiss").exists():
        console.print(f"[red]Error: Index for strategy '{strat}' not found in {index_dir}. Run `index` first.[/red]")
        sys.exit(1)

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(
        base_url=default_config.ollama_base_url,
        model=default_config.ollama_model,
    )

    q_vec = embedder.embed_query(args.query)
    results = store.search(q_vec, top_k=args.top_k, filter_source=args.filter)

    console.print(f"\n[bold cyan]Search Query:[/bold cyan] [white]{args.query}[/white]")
    console.print(f"[cyan]Strategy:[/cyan] {strat} | Found: {len(results)} chunks\n")

    for r in results:
        lang = r.chunk.metadata.get("language", "text")
        syntax_lang = "kotlin" if lang in {"kt", "kts"} else ("markdown" if lang == "md" else "xml")

        title = f"Rank #{r.rank} | Score: [bold green]{r.score:.4f}[/bold green] | [yellow]{r.chunk.source}[/yellow]"
        subtitle = f"Section: {r.chunk.section} | Lines: L{r.chunk.metadata.get('start_line', '?')}-L{r.chunk.metadata.get('end_line', '?')}"

        syntax = Syntax(r.chunk.content, syntax_lang, theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=title, subtitle=subtitle, border_style="blue"))


def run_compare(args):
    fixed_dir = default_config.fixed_index_dir
    struct_dir = default_config.structural_index_dir

    if not (fixed_dir / "index.faiss").exists() or not (struct_dir / "index.faiss").exists():
        console.print("[red]Error: Indexes not found! Please run `index --strategy both` first.[/red]")
        sys.exit(1)

    fixed_store = VectorStore.load(fixed_dir)
    struct_store = VectorStore.load(struct_dir)
    embedder = OllamaEmbedder(
        base_url=default_config.ollama_base_url,
        model=default_config.ollama_model,
    )

    def do_query(query: str):
        console.print(f"\n[bold white]====================================================[/bold white]")
        console.print(f"[bold cyan]🔍 Query:[/bold cyan] [bold yellow]{query}[/bold yellow]")
        q_vec = embedder.embed_query(query)

        f_res = fixed_store.search(q_vec, top_k=args.top_k)
        s_res = struct_store.search(q_vec, top_k=args.top_k)

        for i in range(max(len(f_res), len(s_res))):
            f_item = f_res[i] if i < len(f_res) else None
            s_item = s_res[i] if i < len(s_res) else None

            f_panel = ""
            if f_item:
                f_text = f"[bold yellow]Rank #{f_item.rank} | Cosine: {f_item.score:.4f}[/bold yellow]\n"
                f_text += f"[bold]Source:[/bold] {f_item.chunk.source}\n"
                f_text += f"[bold]Section:[/bold] {f_item.chunk.section}\n"
                f_text += f"[dim]Lines: {f_item.chunk.metadata.get('start_line')}-{f_item.chunk.metadata.get('end_line')}[/dim]\n\n"
                f_text += f_item.chunk.content[:400]
                if len(f_item.chunk.content) > 400:
                    f_text += "..."
                f_panel = Panel(f_text, title="[yellow]Fixed-Size Result[/yellow]", border_style="yellow")

            s_panel = ""
            if s_item:
                s_text = f"[bold green]Rank #{s_item.rank} | Cosine: {s_item.score:.4f}[/bold green]\n"
                s_text += f"[bold]Source:[/bold] {s_item.chunk.source}\n"
                s_text += f"[bold]Section:[/bold] {s_item.chunk.section}\n"
                s_text += f"[dim]Lines: {s_item.chunk.metadata.get('start_line')}-{s_item.chunk.metadata.get('end_line')}[/dim]\n\n"
                s_text += s_item.chunk.content[:400]
                if len(s_item.chunk.content) > 400:
                    s_text += "..."
                s_panel = Panel(s_text, title="[green]Structural Result[/green]", border_style="green")

            console.print(Columns([f_panel, s_panel], equal=True))

    if args.query:
        do_query(args.query)
    else:
        console.print("[bold green]=== Interactive Side-by-Side Search Mode ===[/bold green]")
        console.print("Type your query (or 'exit' / 'q' to quit):\n")
        while True:
            try:
                user_q = input("\nQuery > ").strip()
                if not user_q:
                    continue
                if user_q.lower() in {"exit", "quit", "q"}:
                    break
                do_query(user_q)
            except (KeyboardInterrupt, EOFError):
                break


def get_rag_agent(args, default_strat: str = "structural") -> RAGAgent:
    strat = getattr(args, "strategy", None) or default_strat
    index_dir = default_config.fixed_index_dir if strat == "fixed" else default_config.structural_index_dir

    if not (index_dir / "index.faiss").exists():
        console.print(f"[red]Error: Index for strategy '{strat}' not found in {index_dir}. Run `index` first.[/red]")
        sys.exit(1)

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(
        base_url=default_config.ollama_base_url,
        model=default_config.ollama_model,
    )

    api_key = getattr(args, "api_key", None) or default_config.openrouter_api_key
    model = getattr(args, "model", None) or default_config.openrouter_model
    mock_mode = getattr(args, "mock", False)

    llm_client = OpenRouterClient(
        api_key=api_key,
        base_url=default_config.openrouter_base_url,
        default_model=model,
        timeout=default_config.openrouter_timeout,
        mock_mode=mock_mode,
    )
    initial_top_k = getattr(args, "initial_top_k", default_config.rerank_initial_top_k) or default_config.rerank_initial_top_k
    threshold = getattr(args, "threshold", default_config.rerank_similarity_threshold) or default_config.rerank_similarity_threshold

    return RAGAgent(
        vector_store=store,
        embedder=embedder,
        llm_client=llm_client,
        default_top_k=getattr(args, "top_k", default_config.default_top_k) or default_config.default_top_k,
        initial_top_k=initial_top_k,
        similarity_threshold=threshold,
    )



def run_ask(args):
    setup_console(args)
    use_rag = getattr(args, "rag", True)
    use_rewrite = getattr(args, "rewrite", False)
    use_rerank = getattr(args, "rerank", False)
    use_grounded = getattr(args, "grounded", True)
    grounded_thresh = getattr(args, "grounded_threshold", default_config.grounded_relevance_threshold)

    mode_parts = []
    if not use_rag:
        mode_parts.append("[bold yellow]БЕЗ RAG (Pretrained Baseline)[/bold yellow]")
    else:
        mode_parts.append("[bold green]С RAG[/bold green]")
        if use_grounded:
            mode_parts.append(f"[bold green]+ Grounded Citations (cutoff={grounded_thresh})[/bold green]")
        if use_rewrite:
            mode_parts.append("[bold cyan]+ Query Rewrite[/bold cyan]")
        if use_rerank:
            thresh_val = getattr(args, 'threshold', default_config.rerank_similarity_threshold)
            mode_parts.append(f"[bold magenta]+ Rerank & Filter (thresh={thresh_val})[/bold magenta]")

    console.print(f"\n[bold cyan]=== CryptoTrack AI Agent Query ===[/bold cyan]")
    console.print(f"[white]Режим:[/white] {' '.join(mode_parts)}")
    console.print(f"[white]Вопрос:[/white] [bold white]{args.question}[/bold white]")

    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    with console.status(f"[cyan]Generating response using {agent.llm_client.default_model}...[/cyan]"):
        try:
            res = agent.query(
                question=args.question,
                use_rag=use_rag,
                use_rewrite=use_rewrite,
                use_rerank=use_rerank,
                use_grounded=use_grounded,
                top_k=args.top_k,
                initial_top_k=getattr(args, "initial_top_k", None),
                similarity_threshold=getattr(args, "threshold", None),
                grounded_threshold=grounded_thresh,
                model=args.model,
                filter_source=args.filter,
            )
        except OpenRouterError as err:
            console.print(f"\n[bold red]OpenRouter API Error:[/bold red] {err}")
            if err.status_code == 401:
                console.print("[yellow]Hint: Provide your OpenRouter API key via OPENROUTER_API_KEY env var or --api-key flag.[/yellow]")
            sys.exit(1)
        except Exception as exc:
            console.print(f"\n[bold red]Query failed:[/bold red] {exc}")
            sys.exit(1)

    # 1. Display query rewrite info if applied
    if res.rewritten_query:
        console.print(Panel(
            f"[dim]Исходный:[/dim] {args.question}\n[bold cyan]Оптимизированный:[/bold cyan] {res.rewritten_query}",
            title=f"🔄 Query Rewrite ({res.rewrite_latency:.3f}s)",
            border_style="cyan"
        ))

    # 2. Display filtering & rerank stats if applied
    if use_rerank and res.pipeline_result:
        p = res.pipeline_result
        soft_warn = " [yellow](fall-soft активирован)[/yellow]" if p.fall_soft_triggered else ""
        console.print(
            f"[dim]Фильтрация кандидатов (порог {p.threshold}): "
            f"{p.initial_count} найдено -> отсеяно {p.dropped_by_filter} шума -> {len(res.sources)} в контексте{soft_warn} "
            f"(время 2-го этапа: {res.rerank_latency:.3f}s, движок: {p.rerank_engine})[/dim]"
        )

    # 3. Grounded Answer Formatting (Day 24)
    g = res.grounded_answer
    if g:
        if g.is_refusal:
            console.print(Panel(
                f"[bold yellow]{g.answer}[/bold yellow]\n\n"
                f"[cyan]💡 Уточнение:[/cyan] {g.clarification_prompt or 'Пожалуйста, уточните ваш вопрос по проекту CryptoTrack.'}",
                title="🛡️ Анти-галлюцинация: Режим отказа («не знаю»)",
                border_style="yellow",
            ))
        else:
            # Model Answer
            console.print(Panel(Markdown(g.answer), title=f"🤖 Ответ модели ({res.model}) [Grounded RAG]", border_style="green"))

            # Sources Table
            if g.sources:
                st = Table(title="📚 Список подтвержденных источников", show_lines=False)
                st.add_column("#", justify="center", style="cyan")
                st.add_column("Файл / Источник", style="bold white", overflow="fold")
                st.add_column("Секция / Символ", style="green", overflow="fold")
                st.add_column("Строки", justify="center", style="yellow")
                st.add_column("Chunk ID", justify="center", style="dim")
                st.add_column("Релевантность", justify="right", style="magenta")

                for idx, src in enumerate(g.sources, 1):
                    lines_str = f"L{src.start_line}-L{src.end_line}" if src.start_line is not None else "—"
                    score_str = f"{src.score:.3f}" if src.score else "—"
                    st.add_row(str(idx), src.source, src.section or "—", lines_str, src.chunk_id or "—", score_str)
                console.print(st)

            # Quotes Panel
            if g.quotes:
                console.print(f"\n[bold cyan]💬 Подтвержденные цитаты из контекста ({len(g.quotes)} фрагментов):[/bold cyan]")
                for idx, q in enumerate(g.quotes, 1):
                    v_icon = "[bold green]✓ Verified[/bold green]" if q.is_exact_match else "[yellow]~ Partial[/yellow]"
                    src_short = q.source.split("/")[-1] if q.source else ""
                    src_tag = f" ({src_short})" if src_short else ""
                    quote_content = f"[white]{q.text}[/white]"
                    if q.source:
                        quote_content += f"\n[dim]Источник: {q.source}[/dim]"
                    console.print(Panel(
                        quote_content,
                        title=f"Цитата #{idx}{src_tag} [{v_icon}]",
                        border_style="cyan" if q.is_exact_match else "dim yellow"
                    ))

            # Grounding and Faithfulness Metrics
            console.print(
                f"\n[dim]Метрики привязки: Подлинность цитат: [bold]{g.grounding_score*100:.1f}%[/bold] | "
                f"Семантическое соответствие: [bold]{g.faithfulness_score*100:.1f}%[/bold] | "
                f"Top Relevance: [bold]{g.top_relevance_score:.4f}[/bold] (Порог: {g.cutoff_threshold:.2f})[/dim]"
            )
    else:
        # Fallback raw answer
        border_style = "green" if use_rag else "yellow"
        title = f"🤖 Ответ модели ({res.model}) [{'RAG: ON' if use_rag else 'RAG: OFF'}]"
        console.print(Panel(Markdown(res.answer), title=title, border_style=border_style))

    # 4. Timing & token stats
    stats_text = (
        f"[dim]Время: общ {res.latency_seconds:.2f}s "
        f"(rewrite: {res.rewrite_latency:.2f}s, поиск: {res.retrieval_latency:.2f}s, rerank: {res.rerank_latency:.2f}s, LLM: {res.llm_latency:.2f}s) | "
        f"Токены: {res.total_tokens} (prompt: {res.prompt_tokens}, completion: {res.completion_tokens})[/dim]"
    )
    console.print(stats_text + "\n")


def run_chat(args):
    setup_console(args)
    use_rag = getattr(args, "rag", True)
    use_rewrite = getattr(args, "rewrite", False)
    use_rerank = getattr(args, "rerank", False)
    threshold = getattr(args, "threshold", default_config.rerank_similarity_threshold)

    console.print(f"\n[bold green]=== Interactive CryptoTrack AI Chat ===[/bold green]")
    console.print("Commands: `/rag on/off`, `/rewrite on/off`, `/rerank on/off`, `/thresh <val>`, `/model <name>`, `/topk <k>`, `/sources`, `/exit`\n")

    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    last_sources = []
    current_model = args.model or agent.llm_client.default_model

    while True:
        try:
            badges = []
            badges.append("[bold green]RAG:ON[/bold green]" if use_rag else "[bold yellow]RAG:OFF[/bold yellow]")
            if use_rag:
                if use_rewrite:
                    badges.append("[cyan]RW[/cyan]")
                if use_rerank:
                    badges.append(f"[magenta]RR({threshold})[/magenta]")

            prompt_str = f"\nCryptoTrack [{'/'.join(badges)} | {current_model.split('/')[-1]}] > "
            user_input = input(prompt_str).strip()

            if not user_input:
                continue

            if user_input.lower() in {"exit", "quit", "q", "/exit", "/quit"}:
                console.print("[dim]Goodbye![/dim]")
                break

            if user_input.lower() in {"/rag on", "rag on"}:
                use_rag = True
                console.print("[green]✓ RAG mode ENABLED[/green]")
                continue
            elif user_input.lower() in {"/rag off", "rag off"}:
                use_rag = False
                console.print("[yellow]✓ RAG mode DISABLED (Pretrained baseline)[/yellow]")
                continue
            elif user_input.lower() in {"/rewrite on", "rewrite on"}:
                use_rewrite = True
                console.print("[cyan]✓ Query Rewrite ENABLED[/cyan]")
                continue
            elif user_input.lower() in {"/rewrite off", "rewrite off"}:
                use_rewrite = False
                console.print("[dim]✓ Query Rewrite DISABLED[/dim]")
                continue
            elif user_input.lower() in {"/rerank on", "rerank on"}:
                use_rerank = True
                console.print(f"[magenta]✓ Cross-Encoder Rerank & Filtering ENABLED (threshold={threshold})[/magenta]")
                continue
            elif user_input.lower() in {"/rerank off", "rerank off"}:
                use_rerank = False
                console.print("[dim]✓ Rerank & Filtering DISABLED[/dim]")
                continue
            elif user_input.startswith("/thresh "):
                try:
                    threshold = float(user_input.split()[1])
                    agent.similarity_threshold = threshold
                    console.print(f"[magenta]✓ Similarity threshold set to: {threshold}[/magenta]")
                except ValueError:
                    console.print("[red]Invalid float for threshold[/red]")
                continue
            elif user_input.startswith("/model "):
                current_model = user_input.split(maxsplit=1)[1].strip()
                console.print(f"[cyan]✓ Model switched to: {current_model}[/cyan]")
                continue
            elif user_input.startswith("/topk "):
                try:
                    args.top_k = int(user_input.split()[1])
                    agent.default_top_k = args.top_k
                    console.print(f"[cyan]✓ Top-K set to: {args.top_k}[/cyan]")
                except ValueError:
                    console.print("[red]Invalid integer for top_k[/red]")
                continue
            elif user_input.lower() in {"/sources", "sources"}:
                if not last_sources:
                    console.print("[dim]No sources in the last query.[/dim]")
                else:
                    console.print(f"[bold magenta]Last query sources ({len(last_sources)}):[/bold magenta]")
                    for s in last_sources:
                        rr_info = f" | Rerank: {s.rerank_score:.4f}" if s.rerank_score is not None else ""
                        console.print(f"  • #{s.rank} [{s.score:.4f}{rr_info}] [yellow]{s.source}[/yellow] (L{s.start_line}-L{s.end_line})")
                continue
            elif user_input.lower() in {"/help", "help"}:
                console.print("Available commands:\n  /rag on|off\n  /rewrite on|off\n  /rerank on|off\n  /thresh <val>\n  /model <name>\n  /topk <k>\n  /sources\n  /exit")
                continue

            with console.status(f"[cyan]Querying...[/cyan]"):
                res = agent.query(
                    question=user_input,
                    use_rag=use_rag,
                    use_rewrite=use_rewrite,
                    use_rerank=use_rerank,
                    top_k=args.top_k,
                    similarity_threshold=threshold,
                    model=current_model,
                )
            last_sources = res.sources

            border_style = "green" if use_rag else "yellow"
            title = f"🤖 [{' / '.join(badges)}] ({res.total_tokens} tok | {res.latency_seconds:.2f}s)"
            console.print(Panel(Markdown(res.answer), title=title, border_style=border_style))

        except KeyboardInterrupt:
            break
        except OpenRouterError as err:
            console.print(f"[red]OpenRouter API Error: {err}[/red]")
        except Exception as exc:
            console.print(f"[red]Error: {exc}[/red]")


def run_chat_memory(args):
    """Интерактивный чат с RAG, историей и памятью задачи (Task State) - Day 25."""
    setup_console(args)
    sessions_dir = default_config.data_dir / "sessions"
    store = SessionStore(sessions_dir)

    if getattr(args, "list_sessions", False):
        sessions = store.list_sessions()
        if not sessions:
            console.print("[dim]Нет сохранённых сессий.[/dim]")
            return
        table = Table(title="Сохранённые сессии чата", header_style="bold cyan")
        table.add_column("#", justify="right", style="bold yellow")
        table.add_column("Session ID", style="green")
        table.add_column("Цель / Тема диалога", style="white")
        table.add_column("Сообщений", justify="right", style="cyan")
        table.add_column("Дата создания", style="dim")
        for idx, s in enumerate(sessions, 1):
            table.add_row(
                str(idx),
                s["session_id"],
                s.get("goal", "—")[:60],
                str(s["message_count"]),
                s["created_at"][:19],
            )
        console.print(table)
        return

    # Загрузка или создание сессии
    session_id = getattr(args, "session", None)
    if session_id:
        try:
            session = store.load(session_id)
            console.print(f"[green]✓ Загружена существующая сессия:[/green] [bold]{session_id}[/bold] ({len(session.messages)} сообщений)")
        except FileNotFoundError:
            console.print(f"[red]Сессия '{session_id}' не найдена. Создаётся новая.[/red]")
            session = ChatSession(session_id=session_id)
    else:
        session = ChatSession()
        console.print(f"[green]✓ Создана новая сессия:[/green] [bold]{session.session_id}[/bold]")

    use_rag = getattr(args, "rag", True)
    use_rewrite = getattr(args, "rewrite", True)
    use_rerank = getattr(args, "rerank", True)
    threshold = getattr(args, "threshold", default_config.rerank_similarity_threshold)
    window_size = getattr(args, "window", 10)

    existing_sessions = store.list_sessions()
    console.print(f"\n[bold green]=== Production-like RAG Chat with Task Memory ===[/bold green]")
    if existing_sessions:
        console.print(f"[dim]💡 Сохранённых сессий: {len(existing_sessions)} (введите [bold cyan]/switch[/bold cyan] для выбора)[/dim]")
    console.print("Команды: `/switch [№]`, `/state`, `/sources`, `/history`, `/new`, `/save`, `/rag on/off`, `/topk <k>`, `/exit`\n")

    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Ошибка инициализации: {exc}[/red]")
        sys.exit(1)

    engine = MemoryChatEngine(
        rag_agent=agent,
        session=session,
        session_store=store,
        window_size=window_size,
    )

    current_model = args.model or agent.llm_client.default_model

    while True:
        try:
            badges = []
            badges.append("[bold green]RAG:ON[/bold green]" if use_rag else "[bold yellow]RAG:OFF[/bold yellow]")
            if use_rag:
                if use_rewrite:
                    badges.append("[cyan]RW[/cyan]")
                if use_rerank:
                    badges.append(f"[magenta]RR({threshold})[/magenta]")
            badges.append(f"[blue]Turn:{session.task_state.turn_number}[/blue]")

            prompt_str = f"\nCryptoTrack [{'/'.join(badges)} | {current_model.split('/')[-1]}] > "
            user_input = input(prompt_str).strip()

            if not user_input:
                continue

            if user_input.lower() in {"exit", "quit", "q", "/exit", "/quit"}:
                store.save(session)
                console.print(f"[dim]Сессия {session.session_id} сохранена. До свидания![/dim]")
                break

            if user_input.lower() in {"/state", "state"}:
                console.print(Panel(
                    session.task_state.to_summary(),
                    title="🧠 Память задачи (Task State)",
                    border_style="cyan",
                ))
                continue

            if user_input.lower() in {"/sources", "sources"}:
                last_asst = next((m for m in reversed(session.messages) if m.role == "assistant"), None)
                if not last_asst or not last_asst.sources:
                    console.print("[dim]Нет источников в последнем ответе.[/dim]")
                else:
                    console.print(f"[bold magenta]Источники последнего ответа ({len(last_asst.sources)}):[/bold magenta]")
                    for s in last_asst.sources:
                        score_part = f" [{s.get('score', 0):.4f}]" if "score" in s else ""
                        console.print(f"  • {score_part} [yellow]{s.get('source')}[/yellow] ({s.get('section', '')})")
                continue

            if user_input.lower() in {"/history", "history"}:
                console.print(f"[bold cyan]История диалога ({len(session.messages)} сообщений):[/bold cyan]")
                for m in session.messages:
                    icon = "👤" if m.role == "user" else "🤖"
                    console.print(f"{icon} [bold]{m.role.upper()}:[/bold] {m.content[:100]}...")
                continue

            if user_input.lower().startswith("/switch") or user_input.lower() in {"/sessions", "sessions", "switch"}:
                parts = user_input.split()
                target_idx = None
                if len(parts) > 1 and parts[1].isdigit():
                    target_idx = int(parts[1])

                sessions = store.list_sessions()
                if not sessions:
                    console.print("[dim]Нет сохранённых сессий.[/dim]")
                    continue

                if target_idx is None:
                    table = Table(title="📋 Сохранённые сессии диалога", header_style="bold cyan")
                    table.add_column("#", justify="right", style="bold yellow")
                    table.add_column("Статус", justify="center")
                    table.add_column("Цель / Тема диалога", style="white")
                    table.add_column("Сообщений", justify="right", style="cyan")
                    table.add_column("Дата", style="dim")

                    for idx, s in enumerate(sessions, 1):
                        is_active = s["session_id"] == session.session_id
                        status_badge = "[bold green][ACTIVE][/bold green]" if is_active else ""
                        row_style = "bold white on dark_green" if is_active else None
                        table.add_row(
                            str(idx),
                            status_badge,
                            s.get("goal", "—")[:65],
                            str(s["message_count"]),
                            s["created_at"][:19],
                            style=row_style,
                        )
                    console.print(table)
                    console.print(f"[dim]Введите номер сессии (1-{len(sessions)}), '0' для отмены, или 'n' для новой сессии[/dim]")

                    try:
                        choice = input("Сессия > ").strip()
                    except (KeyboardInterrupt, EOFError):
                        continue

                    if not choice or choice == "0":
                        console.print("[dim]Переключение отменено.[/dim]")
                        continue
                    if choice.lower() in {"n", "new", "/new"}:
                        store.save(session)
                        session = ChatSession()
                        engine.session = session
                        console.print(f"[green]✓ Начата новая сессия: [bold]{session.session_id}[/bold][/green]")
                        continue
                    if choice.isdigit():
                        target_idx = int(choice)
                    else:
                        console.print(f"[red]Неверный ввод. Введите число от 1 до {len(sessions)}.[/red]")
                        continue

                if target_idx is not None:
                    if 1 <= target_idx <= len(sessions):
                        chosen = sessions[target_idx - 1]
                        if chosen["session_id"] == session.session_id:
                            console.print(f"[yellow]Сессия #{target_idx} уже активна.[/yellow]")
                            continue

                        store.save(session)
                        try:
                            new_session = store.load(chosen["session_id"])
                            session = new_session
                            engine.session = session

                            last_q = next((m.content for m in reversed(session.messages) if m.role == "user"), "—")
                            card = (
                                f"[bold green]✓ Переключено на сессию #{target_idx}:[/bold green] [bold]{session.session_id}[/bold]\n"
                                f"[cyan]Цель:[/cyan] {session.task_state.goal or 'Не определена'}\n"
                                f"[cyan]Сообщений в диалоге:[/cyan] {len(session.messages)} (Ходов: {session.task_state.turn_number})\n"
                                f"[cyan]Последний вопрос:[/cyan] {last_q[:85]}"
                            )
                            console.print(Panel(card, title="🔄 Активная сессия", border_style="green"))
                        except Exception as e:
                            console.print(f"[red]Ошибка загрузки сессии: {e}[/red]")
                    else:
                        console.print(f"[red]Номер сессии вне диапазона (1-{len(sessions)}).[/red]")
                continue

            if user_input.lower() in {"/save", "save"}:
                p = store.save(session)
                console.print(f"[green]✓ Сессия сохранена в {p}[/green]")
                continue

            if user_input.lower() in {"/new", "new"}:
                store.save(session)
                session = ChatSession()
                engine.session = session
                console.print(f"[green]✓ Начата новая сессия: [bold]{session.session_id}[/bold][/green]")
                continue

            if user_input.lower() in {"/rag on", "rag on"}:
                use_rag = True
                console.print("[green]✓ RAG включен[/green]")
                continue
            elif user_input.lower() in {"/rag off", "rag off"}:
                use_rag = False
                console.print("[yellow]✓ RAG отключен[/yellow]")
                continue
            elif user_input.lower() in {"/rewrite on", "rewrite on"}:
                use_rewrite = True
                console.print("[cyan]✓ Query Rewrite включен[/cyan]")
                continue
            elif user_input.lower() in {"/rewrite off", "rewrite off"}:
                use_rewrite = False
                console.print("[dim]✓ Query Rewrite отключен[/dim]")
                continue
            elif user_input.lower() in {"/rerank on", "rerank on"}:
                use_rerank = True
                console.print("[magenta]✓ Rerank & Filter включен[/magenta]")
                continue
            elif user_input.lower() in {"/rerank off", "rerank off"}:
                use_rerank = False
                console.print("[dim]✓ Rerank & Filter отключен[/dim]")
                continue
            elif user_input.startswith("/model "):
                current_model = user_input.split(maxsplit=1)[1].strip()
                console.print(f"[cyan]✓ Модель переключена на: {current_model}[/cyan]")
                continue
            elif user_input.startswith("/topk "):
                try:
                    args.top_k = int(user_input.split()[1])
                    agent.default_top_k = args.top_k
                    console.print(f"[cyan]✓ Top-K установлен: {args.top_k}[/cyan]")
                except ValueError:
                    console.print("[red]Неверное число для top_k[/red]")
                continue
            elif user_input.lower() in {"/help", "help"}:
                console.print("Доступные команды:\n  /switch [№] - Выбрать и переключить активную сессию по номеру\n  /state      - Показать текущую память задачи\n  /sources    - Показать источники последнего ответа\n  /history    - Просмотреть историю диалога\n  /save       - Сохранить текущую сессию\n  /new        - Начать новую сессию\n  /rag on|off - Переключить RAG\n  /rewrite on|off - Переключить Query Rewrite\n  /rerank on|off  - Переключить Rerank\n  /model <name>   - Сменить модель LLM\n  /topk <k>       - Изменить количество чанков\n  /exit       - Выход")
                continue

            with console.status(f"[cyan]Поиск в кодовой базе и генерация ответа...[/cyan]"):
                res = engine.process_turn(
                    user_question=user_input,
                    model=current_model,
                    use_rag=use_rag,
                    use_rewrite=use_rewrite,
                    use_rerank=use_rerank,
                    top_k=args.top_k,
                )

            border_style = "green" if use_rag else "yellow"
            title = f"🤖 [Ход #{session.task_state.turn_number} | {res.total_tokens} токенов | {res.latency_seconds:.2f}с]"
            console.print(Panel(Markdown(res.answer), title=title, border_style=border_style))

            if res.sources:
                src_lines = []
                for s in res.sources[:4]:
                    loc = f":L{s['start_line']}-L{s['end_line']}" if s.get('start_line') else ""
                    sec = f" (`{s['section']}`)" if s.get('section') else ""
                    score = f" [score: {s['score']:.3f}]" if 'score' in s else ""
                    src_lines.append(f"  📚 `{s['source']}{loc}`{sec}{score}")
                console.print("\n".join(src_lines))

            state_brief = (
                f"[bold cyan]Цель:[/bold cyan] {session.task_state.goal or 'Не определена'}\n"
                f"[bold cyan]Уточнений:[/bold cyan] {len(session.task_state.clarifications)} | "
                f"[bold cyan]Ограничений:[/bold cyan] {len(session.task_state.constraints)} | "
                f"[bold cyan]Находок:[/bold cyan] {len(session.task_state.key_findings)}"
            )
            console.print(Panel(state_brief, title="🧠 Память задачи (Task State)", border_style="blue"))

        except KeyboardInterrupt:
            store.save(session)
            break
        except OpenRouterError as err:
            console.print(f"[red]OpenRouter API Error: {err}[/red]")
        except Exception as exc:
            console.print(f"[red]Error: {exc}[/red]")


def run_eval(args):
    console.print(f"\n[bold green]=== Running RAG vs No-RAG 10 Questions Benchmark ===[/bold green]")
    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    evaluator = RAGEvaluator(agent=agent, console=console)
    questions = BENCHMARK_QUESTIONS
    if args.limit and args.limit > 0:
        questions = questions[:args.limit]
        console.print(f"[yellow]Note: Limiting benchmark to first {args.limit} questions[/yellow]")

    console.print(f"[cyan]Target Model:[/cyan] {args.model or agent.llm_client.default_model}")
    console.print(f"[cyan]Total Questions:[/cyan] {len(questions)}")
    console.print(f"[cyan]Strategy:[/cyan] {args.strategy}\n")

    def on_progress(current, total, bq):
        console.print(f"[{current}/{total}] [bold white]Evaluating Q{bq.id}:[/bold white] [cyan]{bq.question[:60]}...[/cyan]")

    summary = evaluator.run_benchmark(
        questions=questions,
        top_k=args.top_k,
        model=args.model,
        progress_callback=on_progress,
    )

    console.print("\n")
    evaluator.print_summary_table(summary)

    # Generate    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    console.print(f"\n[bold green]✓ Full Benchmark Report saved to:[/bold green] [white]{report_path}[/white]\n")


def run_compare_rerank(args):
    setup_console(args)
    console.print(f"\n[bold green]=== Multi-Mode RAG Comparison: Baseline vs Rewrite vs Enhanced RAG ===[/bold green]")
    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    evaluator = RerankEvaluator(agent=agent, console=console)

    if args.query:
        # Run on single query
        from src.evaluation.benchmark_dataset import BenchmarkQuestion
        dummy_bq = BenchmarkQuestion(
            id=1,
            category="custom",
            question=args.query,
            expected_sources=[],
            key_entities=[],
            expectation="",
        )
        with console.status("[cyan]Evaluating query across 3 RAG modes...[/cyan]"):
            res = evaluator.evaluate_question(
                bq=dummy_bq,
                top_k=args.top_k,
                initial_top_k=args.initial_top_k,
                threshold=args.threshold,
                model=args.model,
            )

        console.print(f"\n[bold cyan]1. Baseline RAG (Raw retrieval, top_k={args.top_k}):[/bold cyan]")
        console.print(f"[dim]Sources: {len(res.result_baseline.sources)} | Latency: {res.result_baseline.latency_seconds:.2f}s | Tokens: {res.result_baseline.total_tokens}[/dim]")
        console.print(Panel(Markdown(res.result_baseline.answer), title="Baseline Answer", border_style="yellow"))

        console.print(f"\n[bold cyan]2. RAG + Query Rewrite (top_k={args.top_k}):[/bold cyan]")
        console.print(f"[dim]Rewritten Query: {res.result_rewrite.rewritten_query}[/dim]")
        console.print(f"[dim]Sources: {len(res.result_rewrite.sources)} | Latency: {res.result_rewrite.latency_seconds:.2f}s | Tokens: {res.result_rewrite.total_tokens}[/dim]")
        console.print(Panel(Markdown(res.result_rewrite.answer), title="Rewrite Answer", border_style="blue"))

        console.print(f"\n[bold cyan]3. Enhanced RAG (Rewrite + Similarity Filter >= {args.threshold} + Cross-Encoder Rerank):[/bold cyan]")
        console.print(f"[dim]Rewritten Query: {res.result_enhanced.rewritten_query}[/dim]")
        console.print(f"[dim]Filter & Rerank: {res.initial_candidates} candidates -> {res.dropped_candidates} noise dropped ({res.noise_reduction_pct:.0f}%) -> {len(res.result_enhanced.sources)} final sources[/dim]")
        console.print(f"[dim]Latency: {res.result_enhanced.latency_seconds:.2f}s | Tokens: {res.result_enhanced.total_tokens}[/dim]")
        console.print(Panel(Markdown(res.result_enhanced.answer), title="Enhanced RAG Answer", border_style="green"))

        console.print(f"\n[bold magenta]Вердикт:[/bold magenta] {res.verdict}\n")
    else:
        # Run on benchmark suite
        questions = BENCHMARK_QUESTIONS
        if args.limit and args.limit > 0:
            questions = questions[:args.limit]
            console.print(f"[yellow]Note: Limiting benchmark to first {args.limit} questions[/yellow]")

        console.print(f"[cyan]Target Model:[/cyan] {args.model or agent.llm_client.default_model}")
        console.print(f"[cyan]Total Questions:[/cyan] {len(questions)}")
        console.print(f"[cyan]Threshold:[/cyan] {args.threshold} | Initial Top-K: {args.initial_top_k} | Final Top-K: {args.top_k}\n")

        def on_progress(current, total, bq):
            console.print(f"[{current}/{total}] [bold white]Evaluating Q{bq.id}:[/bold white] [cyan]{bq.question[:60]}...[/cyan]")

        summary = evaluator.run_benchmark(
            questions=questions,
            top_k=args.top_k,
            initial_top_k=args.initial_top_k,
            threshold=args.threshold,
            model=args.model,
            progress_callback=on_progress,
        )

        console.print("\n")
        evaluator.render_table(summary)

        # Markdown report
        report_path = Path(args.output) if args.output else default_config.rerank_benchmark_report_path
        evaluator.generate_markdown_report(summary, report_path)
        console.print(f"\n[bold green]✓ Full Multi-Mode Benchmark Report saved to:[/bold green] [white]{report_path}[/white]\n")


def run_benchmark_grounded(args):
    console.print(f"\n[bold green]=== Day 24 Benchmark: Citations, Sources & Anti-Hallucinations ===[/bold green]")
    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    evaluator = GroundedEvaluator(agent)
    suite = GROUNDED_BENCHMARK_SUITE
    if args.limit and args.limit > 0:
        suite = suite[:args.limit]
        console.print(f"[yellow]Note: Limiting benchmark to first {args.limit} questions[/yellow]")

    console.print(f"[cyan]Target Model:[/cyan] {args.model or agent.llm_client.default_model}")
    console.print(f"[cyan]Total Questions:[/cyan] {len(suite)} (7 In-Domain + 3 Adversarial)")
    console.print(f"[cyan]Cutoff Threshold:[/cyan] {args.threshold} | Top-K: {args.top_k}\n")

    def on_progress(current, total, q):
        q_type = "[green]In-Domain[/green]" if q.is_in_domain else "[yellow]Adversarial[/yellow]"
        console.print(f"[{current}/{total}] {q_type} [bold white]Q{q.id}:[/bold white] [cyan]{q.question[:65]}...[/cyan]")

    delay = getattr(args, "delay", default_config.grounded_eval_delay)
    summary = evaluator.run_benchmark(
        questions=suite,
        top_k=args.top_k,
        threshold=args.threshold,
        model=args.model,
        progress_callback=on_progress,
        delay=delay,
    )

    console.print("\n")
    evaluator.render_table(summary)

    report_path = Path(args.output) if args.output else default_config.grounded_benchmark_report_path
    evaluator.generate_markdown_report(summary, report_path)
    console.print(f"\n[bold green]✓ Full Grounded Benchmark Report saved to:[/bold green] [white]{report_path}[/white]\n")


def main():
    parser = argparse.ArgumentParser(
        prog="RAG-Indexer",
        description="RAG Pipeline and Document Indexing for Android Project CryptoTrack (Week 5)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 1. index
    p_index = subparsers.add_parser("index", help="Index project files and save FAISS + SQLite stores")
    p_index.add_argument("--project-path", default=None, help="Path to Android project")
    p_index.add_argument("--strategy", choices=["fixed", "structural", "both"], default="both", help="Chunking strategy")
    p_index.add_argument("--max-docs", type=int, default=None, help="Limit number of documents to index (prioritizes docs/configs first)")
    p_index.add_argument("--exclude", nargs="*", default=None, help="Glob patterns to exclude from indexing")
    p_index.add_argument("--chunk-size", type=int, default=500, help="Fixed chunk size in characters")
    p_index.add_argument("--overlap", type=int, default=50, help="Fixed chunk overlap in characters")

    # 2. benchmark
    p_bench = subparsers.add_parser("benchmark", help="Compare fixed vs structural chunking metrics & retrieval")

    # 3. search
    p_search = subparsers.add_parser("search", help="Search the index with a text query")
    p_search.add_argument("--query", required=True, help="Search query text")
    p_search.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_search.add_argument("--top-k", type=int, default=5, help="Number of results")
    p_search.add_argument("--filter", default=None, help="Filter by source substring")

    # 4. compare
    p_compare = subparsers.add_parser("compare", help="Compare search results side-by-side between strategies")
    p_compare.add_argument("--query", default=None, help="Single query to compare (if omitted, launches interactive mode)")
    p_compare.add_argument("--top-k", type=int, default=3, help="Top K results per strategy")

    # 5. ask (NEW Day 22, updated Day 23 & 24)
    p_ask = subparsers.add_parser("ask", help="Query the AI Agent with RAG or without RAG")
    p_ask.add_argument("question", help="User question to ask the agent")
    p_rag_group = p_ask.add_mutually_exclusive_group()
    p_rag_group.add_argument("--rag", dest="rag", action="store_true", default=True, help="Enable RAG mode (default)")
    p_rag_group.add_argument("--no-rag", dest="rag", action="store_false", help="Disable RAG mode (pure LLM baseline)")
    p_grounded_group = p_ask.add_mutually_exclusive_group()
    p_grounded_group.add_argument("--grounded", dest="grounded", action="store_true", default=True, help="Enable Grounded Citations & Anti-Hallucination mode (default)")
    p_grounded_group.add_argument("--no-grounded", dest="grounded", action="store_false", help="Disable Grounded mode")
    p_ask.add_argument("--grounded-threshold", type=float, default=default_config.grounded_relevance_threshold, help="Relevance cutoff threshold for 'I don't know' refusal")
    p_ask.add_argument("--rewrite", action="store_true", default=False, help="Enable Query Rewrite")
    p_ask.add_argument("--rerank", action="store_true", default=False, help="Enable Stage 2 Filter & Rerank")
    p_ask.add_argument("--initial-top-k", type=int, default=default_config.rerank_initial_top_k, help="Candidate chunks before filtering")
    p_ask.add_argument("--threshold", type=float, default=default_config.rerank_similarity_threshold, help="Similarity cutoff threshold")
    p_ask.add_argument("--strategy", choices=["fixed", "structural"], default="structural", help="Vector index strategy")
    p_ask.add_argument("--top-k", type=int, default=default_config.default_top_k, help="Number of retrieved chunks")
    p_ask.add_argument("--model", default=None, help="OpenRouter model identifier")
    p_ask.add_argument("--api-key", default=None, help="OpenRouter API Key")
    p_ask.add_argument("--filter", default=None, help="Filter sources by substring")
    p_ask.add_argument("--mock", action="store_true", help="Run in mock/offline mode")
    p_ask.add_argument("--width", type=int, default=None, help="Explicit console width (default: auto-detected visible window width)")

    # 6. chat (NEW Day 22, updated Day 23)
    p_chat = subparsers.add_parser("chat", help="Interactive terminal chat with RAG toggle")
    p_chat.add_argument("--rag", dest="rag", action="store_true", default=True, help="Start in RAG mode (default)")
    p_chat.add_argument("--no-rag", dest="rag", action="store_false", help="Start in No-RAG mode")
    p_chat.add_argument("--rewrite", action="store_true", default=False, help="Start with Query Rewrite enabled")
    p_chat.add_argument("--rerank", action="store_true", default=False, help="Start with Filter & Rerank enabled")
    p_chat.add_argument("--threshold", type=float, default=default_config.rerank_similarity_threshold)
    p_chat.add_argument("--initial-top-k", type=int, default=default_config.rerank_initial_top_k)
    p_chat.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_chat.add_argument("--top-k", type=int, default=default_config.default_top_k)
    p_chat.add_argument("--model", default=None)
    p_chat.add_argument("--api-key", default=None)
    p_chat.add_argument("--mock", action="store_true", help="Run in mock/offline mode")
    p_chat.add_argument("--width", type=int, default=None, help="Explicit console width (default: auto-detected visible window width)")

    # 7. eval (NEW Day 22)
    p_eval = subparsers.add_parser("eval", help="Run 10 benchmark questions comparing No-RAG vs With-RAG")
    p_eval.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_eval.add_argument("--top-k", type=int, default=default_config.default_top_k)
    p_eval.add_argument("--model", default=None)
    p_eval.add_argument("--api-key", default=None)
    p_eval.add_argument("--limit", type=int, default=None, help="Limit number of questions to evaluate")
    p_eval.add_argument("--output", default=None, help="Custom output path for markdown report")
    p_eval.add_argument("--mock", action="store_true", help="Run in mock/offline mode")

    # 8. compare-rerank (NEW Day 23)
    p_cr = subparsers.add_parser("compare-rerank", help="Compare Baseline RAG, Query Rewrite, and Enhanced RAG modes")
    p_cr.add_argument("--query", default=None, help="Single query to compare across 3 modes")
    p_cr.add_argument("--benchmark", action="store_true", default=False, help="Run on benchmark question suite")
    p_cr.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_cr.add_argument("--top-k", type=int, default=default_config.rerank_final_top_k, help="Final top-K chunks")
    p_cr.add_argument("--initial-top-k", type=int, default=default_config.rerank_initial_top_k, help="Initial candidate chunks")
    p_cr.add_argument("--threshold", type=float, default=default_config.rerank_similarity_threshold, help="Similarity cutoff threshold")
    p_cr.add_argument("--model", default=None)
    p_cr.add_argument("--api-key", default=None)
    p_cr.add_argument("--limit", type=int, default=None, help="Limit number of benchmark questions")
    p_cr.add_argument("--output", default=None, help="Custom output path for markdown report")
    p_cr.add_argument("--mock", action="store_true", help="Run in mock/offline mode")
    p_cr.add_argument("--width", type=int, default=None, help="Explicit console width (default: auto-detected visible window width)")

    # 9. benchmark-grounded (NEW Day 24)
    p_bg = subparsers.add_parser("benchmark-grounded", help="Run 10-question citations, quotes, and anti-hallucination benchmark (Day 24)")
    p_bg.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_bg.add_argument("--top-k", type=int, default=default_config.rerank_final_top_k, help="Number of retrieved chunks")
    p_bg.add_argument("--threshold", type=float, default=default_config.grounded_relevance_threshold, help="Cutoff threshold for 'I don't know' refusal")
    p_bg.add_argument("--model", default=None)
    p_bg.add_argument("--api-key", default=None)
    p_bg.add_argument("--limit", type=int, default=None, help="Limit number of benchmark questions")
    p_bg.add_argument("--delay", type=float, default=default_config.grounded_eval_delay, help="Delay in seconds between questions to prevent rate limits")
    p_bg.add_argument("--output", default=None, help="Custom output path for markdown report")
    p_bg.add_argument("--width", type=int, default=None, help="Explicit console width (default: auto-detected visible window width)")
    # 10. chat-memory (NEW Day 25: RAG Chat with Task Memory)
    p_cm = subparsers.add_parser("chat-memory", help="Production-like RAG chat with Task Memory and session persistence (Day 25)")
    p_cm.add_argument("--session", default=None, help="Existing session ID to resume")
    p_cm.add_argument("--list-sessions", action="store_true", help="List all saved sessions and exit")
    p_cm.add_argument("--rag", dest="rag", action="store_true", default=True, help="Enable RAG retrieval (default)")
    p_cm.add_argument("--no-rag", dest="rag", action="store_false", help="Disable RAG retrieval")
    p_cm.add_argument("--rewrite", action="store_true", default=True, help="Enable query rewrite (default: True)")
    p_cm.add_argument("--no-rewrite", dest="rewrite", action="store_false", help="Disable query rewrite")
    p_cm.add_argument("--rerank", action="store_true", default=True, help="Enable cross-encoder rerank (default: True)")
    p_cm.add_argument("--no-rerank", dest="rerank", action="store_false", help="Disable cross-encoder rerank")
    p_cm.add_argument("--threshold", type=float, default=default_config.rerank_similarity_threshold, help="Cutoff similarity threshold")
    p_cm.add_argument("--initial-top-k", type=int, default=default_config.rerank_initial_top_k, help="Initial candidate chunks")
    p_cm.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_cm.add_argument("--top-k", type=int, default=default_config.default_top_k)
    p_cm.add_argument("--window", type=int, default=10, help="Sliding window size for chat history")
    p_cm.add_argument("--model", default=None)
    p_cm.add_argument("--api-key", default=None)
    p_cm.add_argument("--mock", action="store_true", help="Run in mock/offline mode")
    p_cm.add_argument("--width", type=int, default=None, help="Explicit console width (default: auto-detected visible window width)")

    args = parser.parse_args()

    if args.command == "index":
        run_index(args)
    elif args.command == "benchmark":
        run_benchmark(args)
    elif args.command == "search":
        run_search(args)
    elif args.command == "compare":
        run_compare(args)
    elif args.command == "ask":
        run_ask(args)
    elif args.command == "chat":
        run_chat(args)
    elif args.command == "chat-memory":
        run_chat_memory(args)
    elif args.command == "eval":
        run_eval(args)
    elif args.command == "compare-rerank":
        run_compare_rerank(args)
    elif args.command == "benchmark-grounded":
        run_benchmark_grounded(args)


if __name__ == "__main__":
    main()

