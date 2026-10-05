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


def main():
    parser = argparse.ArgumentParser(
        prog="RAG-Indexer",
        description="Document Indexing and Vector Search Pipeline for Android Project (Week 5 Day 21)",
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

    args = parser.parse_args()

    if args.command == "index":
        run_index(args)
    elif args.command == "benchmark":
        run_benchmark(args)
    elif args.command == "search":
        run_search(args)
    elif args.command == "compare":
        run_compare(args)

if __name__ == "__main__":
    main()
