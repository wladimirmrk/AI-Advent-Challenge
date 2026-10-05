import argparse
import io
import os
import sys
import time
from pathlib import Path

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

console = Console(soft_wrap=True)

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
        mock_mode=mock_mode,
    )
    return RAGAgent(
        vector_store=store,
        embedder=embedder,
        llm_client=llm_client,
        default_top_k=getattr(args, "top_k", default_config.default_top_k) or default_config.default_top_k,
    )



def run_ask(args):
    use_rag = getattr(args, "rag", True)
    mode_label = "[bold green]С RAG (Grounded Knowledge)[/bold green]" if use_rag else "[bold yellow]БЕЗ RAG (Pretrained Baseline)[/bold yellow]"

    console.print(f"\n[bold cyan]=== CryptoTrack AI Agent Query ===[/bold cyan]")
    console.print(f"[white]Режим:[/white] {mode_label}")
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
                top_k=args.top_k,
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

    # 1. Display retrieved context if RAG
    if use_rag and res.sources:
        console.print(f"\n[bold magenta]📚 Найденные релевантные источники ({len(res.sources)} чанков):[/bold magenta]")
        for s in res.sources:
            header = f"Rank #{s.rank} | Cosine: {s.score:.4f} | {s.source} (L{s.start_line}-L{s.end_line})"
            preview = s.content[:250].strip() + ("..." if len(s.content) > 250 else "")
            console.print(Panel(preview, title=header, title_align="left", border_style="blue"))

    # 2. Display Model Answer
    border_style = "green" if use_rag else "yellow"
    title = f"🤖 Ответ модели ({res.model}) [{'RAG: ON' if use_rag else 'RAG: OFF'}]"
    console.print(Panel(res.answer, title=title, border_style=border_style))

    # 3. Timing & token stats
    stats_text = (
        f"[dim]Время: общ {res.latency_seconds:.2f}s "
        f"(поиск: {res.retrieval_latency:.2f}s, LLM: {res.llm_latency:.2f}s) | "
        f"Токены: {res.total_tokens} (prompt: {res.prompt_tokens}, completion: {res.completion_tokens})[/dim]"
    )
    console.print(stats_text + "\n")


def run_chat(args):
    use_rag = getattr(args, "rag", True)
    console.print(f"\n[bold green]=== Interactive CryptoTrack AI Chat ===[/bold green]")
    console.print("Commands: `/rag on`, `/rag off`, `/model <name>`, `/topk <k>`, `/sources`, `/exit` or `q`\n")

    try:
        agent = get_rag_agent(args)
    except Exception as exc:
        console.print(f"[red]Initialization error: {exc}[/red]")
        sys.exit(1)

    last_sources = []
    current_model = args.model or agent.llm_client.default_model

    while True:
        try:
            rag_badge = "[bold green]RAG:ON[/bold green]" if use_rag else "[bold yellow]RAG:OFF[/bold yellow]"
            prompt_str = f"\nCryptoTrack [{rag_badge} | {current_model.split('/')[-1]}] > "
            user_input = input(prompt_str).strip()

            if not user_input:
                continue

            if user_input.lower() in {"exit", "quit", "q", "/exit", "/quit"}:
                console.print("[dim]Goodbye![/dim]")
                break

            if user_input.lower() in {"/rag on", "rag on"}:
                use_rag = True
                console.print("[green]✓ RAG mode ENABLED (Grounding in CryptoTrack codebase)[/green]")
                continue
            elif user_input.lower() in {"/rag off", "rag off"}:
                use_rag = False
                console.print("[yellow]✓ RAG mode DISABLED (Pretrained baseline)[/yellow]")
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
                        console.print(f"  • #{s.rank} [{s.score:.4f}] [yellow]{s.source}[/yellow] (L{s.start_line}-L{s.end_line})")
                continue
            elif user_input.lower() in {"/help", "help"}:
                console.print("Available commands:\n  /rag on\n  /rag off\n  /model <name>\n  /topk <k>\n  /sources\n  /exit")
                continue

            with console.status(f"[cyan]Querying...[/cyan]"):
                res = agent.query(
                    question=user_input,
                    use_rag=use_rag,
                    top_k=args.top_k,
                    model=current_model,
                )
            last_sources = res.sources

            border_style = "green" if use_rag else "yellow"
            title = f"🤖 [{rag_badge}] ({res.total_tokens} tok | {res.latency_seconds:.2f}s)"
            console.print(Panel(res.answer, title=title, border_style=border_style))

        except KeyboardInterrupt:
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

    # Generate Markdown report
    model_name = args.model or agent.llm_client.default_model
    report_content = evaluator.generate_markdown_report(summary, model_name)
    report_path = Path(args.output) if args.output else default_config.rag_benchmark_report_path

    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    console.print(f"\n[bold green]✓ Full Benchmark Report saved to:[/bold green] [white]{report_path}[/white]\n")


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

    # 5. ask (NEW Day 22)
    p_ask = subparsers.add_parser("ask", help="Query the AI Agent with RAG or without RAG")
    p_ask.add_argument("question", help="User question to ask the agent")
    p_rag_group = p_ask.add_mutually_exclusive_group()
    p_rag_group.add_argument("--rag", dest="rag", action="store_true", default=True, help="Enable RAG mode (default)")
    p_rag_group.add_argument("--no-rag", dest="rag", action="store_false", help="Disable RAG mode (pure LLM baseline)")
    p_ask.add_argument("--strategy", choices=["fixed", "structural"], default="structural", help="Vector index strategy")
    p_ask.add_argument("--top-k", type=int, default=default_config.default_top_k, help="Number of retrieved chunks")
    p_ask.add_argument("--model", default=None, help="OpenRouter model identifier")
    p_ask.add_argument("--api-key", default=None, help="OpenRouter API Key")
    p_ask.add_argument("--filter", default=None, help="Filter sources by substring")
    p_ask.add_argument("--mock", action="store_true", help="Run in mock/offline mode")

    # 6. chat (NEW Day 22)
    p_chat = subparsers.add_parser("chat", help="Interactive terminal chat with RAG toggle")
    p_chat.add_argument("--rag", dest="rag", action="store_true", default=True, help="Start in RAG mode (default)")
    p_chat.add_argument("--no-rag", dest="rag", action="store_false", help="Start in No-RAG mode")
    p_chat.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_chat.add_argument("--top-k", type=int, default=default_config.default_top_k)
    p_chat.add_argument("--model", default=None)
    p_chat.add_argument("--api-key", default=None)
    p_chat.add_argument("--mock", action="store_true", help="Run in mock/offline mode")

    # 7. eval (NEW Day 22)
    p_eval = subparsers.add_parser("eval", help="Run 10 benchmark questions comparing No-RAG vs With-RAG")
    p_eval.add_argument("--strategy", choices=["fixed", "structural"], default="structural")
    p_eval.add_argument("--top-k", type=int, default=default_config.default_top_k)
    p_eval.add_argument("--model", default=None)
    p_eval.add_argument("--api-key", default=None)
    p_eval.add_argument("--limit", type=int, default=None, help="Limit number of questions to evaluate")
    p_eval.add_argument("--output", default=None, help="Custom output path for markdown report")
    p_eval.add_argument("--mock", action="store_true", help="Run in mock/offline mode")


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
    elif args.command == "eval":
        run_eval(args)


if __name__ == "__main__":
    main()
