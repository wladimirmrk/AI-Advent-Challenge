"""CLI Command: code-review

Fetches a Pull Request diff from CryptoTrack, retrieves architectural and codebase
context via RAG, invokes an AI agent (nvidia/nemotron-3-ultra-550b-a55b:free),
and generates a structured code review saved to a Markdown file.
"""

import argparse
import logging
import os
from pathlib import Path
import sys
import time
from typing import Optional

# Setup encoding for Windows console
if sys.platform.startswith("win"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Ensure parent project is on sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown

from config import default_config
from git_client import GitClient, GitClientError
from rag_retriever import CodeReviewRAGRetriever
from review_agent import CodeReviewAgent

console = Console()


def setup_cli_parser() -> argparse.ArgumentParser:
    """Setup argument parser for code-review CLI."""
    parser = argparse.ArgumentParser(
        prog="code-review",
        description="Automated AI Code Review CLI using RAG and OpenRouter LLM.",
    )
    parser.add_argument(
        "pr_number",
        type=int,
        help="Pull Request number to review (e.g. 2)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=str,
        default=None,
        help="Output path for the review Markdown file (default: review_pr_<number>.md)",
    )
    parser.add_argument(
        "-d",
        "--diff-file",
        type=str,
        default=None,
        help="Path where the git diff should be saved (default: diff_pr_<number>.diff)",
    )
    parser.add_argument(
        "--repo",
        type=str,
        default=str(default_config.crypto_track_path),
        help=f"Path to the target repository (default: {default_config.crypto_track_path})",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=default_config.openrouter_model,
        help=f"OpenRouter model to use (default: {default_config.openrouter_model})",
    )
    parser.add_argument(
        "--no-rag",
        action="store_true",
        help="Disable RAG knowledge base retrieval (baseline LLM review)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch diff and retrieve RAG context without generating review via LLM",
    )
    return parser


def main():
    """Main CLI entry point."""
    parser = setup_cli_parser()
    args = parser.parse_args()

    pr_number = args.pr_number
    repo_path = Path(args.repo).resolve()
    model_name = args.model

    # Resolve output file paths
    diff_file = (
        Path(args.diff_file).resolve()
        if args.diff_file
        else (SCRIPT_DIR / f"diff_pr_{pr_number}.diff")
    )
    output_file = (
        Path(args.output).resolve()
        if args.output
        else (SCRIPT_DIR / f"review_pr_{pr_number}.md")
    )

    console.print(
        Panel.fit(
            f"[bold cyan]CryptoTrack AI Code Review CLI[/bold cyan]\n"
            f"[dim]Pull Request #[bold]{pr_number}[/bold] | Model: [green]{model_name}[/green][/dim]",
            border_style="cyan",
        )
    )

    # 1. Fetch PR Diff & Metadata via GitHub CLI
    git_client = GitClient()
    with console.status(f"[bold yellow]Fetching PR #{pr_number} metadata and diff via gh...[/bold yellow]"):
        try:
            metadata = git_client.get_pr_metadata(pr_number, repo_path=repo_path)
            diff_text, saved_diff_path = git_client.get_pr_diff(
                pr_number, repo_path=repo_path, output_file=diff_file
            )
        except GitClientError as e:
            console.print(f"[bold red]Git Error:[/bold red] {e}")
            sys.exit(1)

    pr_title = metadata.get("title", f"PR #{pr_number}")
    pr_author = (
        metadata.get("author", {}).get("login", "unknown")
        if isinstance(metadata.get("author"), dict)
        else str(metadata.get("author", "unknown"))
    )
    pr_state = metadata.get("state", "UNKNOWN")

    console.print(f"[green]✓[/green] Diff saved to: [dim]{saved_diff_path}[/dim]")

    # 2. RAG Context Retrieval
    rag_context_text = ""
    retrieved_chunks = []
    if not args.no_rag:
        with console.status("[bold blue]Retrieving architectural context from RAG...[/bold blue]"):
            retriever = CodeReviewRAGRetriever(
                index_dir=default_config.rag_structural_index_dir,
                ollama_base_url=default_config.ollama_base_url,
                embed_model=default_config.ollama_embed_model,
                top_k=default_config.rag_top_k,
            )
            retrieved_chunks = retriever.retrieve_context_for_diff(diff_text)
            rag_context_text = retriever.format_context_block(retrieved_chunks)
        console.print(f"[green]✓[/green] Retrieved [bold]{len(retrieved_chunks)}[/bold] RAG context chunks from knowledge base.")
    else:
        console.print("[yellow]![/yellow] RAG retrieval skipped (--no-rag active).")

    # Display PR and Diff Summary Table
    table = Table(title=f"PR #{pr_number} Overview", show_header=True, header_style="bold magenta")
    table.add_column("Property", style="dim", width=20)
    table.add_column("Value", style="cyan")

    table.add_row("Title", pr_title)
    table.add_row("Author", f"@{pr_author}")
    table.add_row("State", pr_state)
    table.add_row("Diff Size", f"{len(diff_text.splitlines())} lines ({len(diff_text)} bytes)")
    table.add_row("Diff File", str(saved_diff_path))
    table.add_row("RAG Context", f"{len(retrieved_chunks)} chunks" if not args.no_rag else "Disabled")
    table.add_row("LLM Model", model_name)
    console.print(table)

    # If Dry Run, stop here
    if args.dry_run:
        console.print("\n[bold yellow]Dry-run mode completed.[/bold yellow] Diff and RAG context prepared without calling LLM.")
        return

    # 3. Invoke Code Review Agent with LLM
    with console.status(f"[bold magenta]Analyzing diff with LLM ({model_name})...[/bold magenta]"):
        agent = CodeReviewAgent(
            model=model_name,
            api_key=default_config.openrouter_api_key,
            base_url=default_config.openrouter_base_url,
            timeout=default_config.openrouter_timeout,
        )
        try:
            result = agent.review(
                pr_number=pr_number,
                metadata=metadata,
                diff_text=diff_text,
                rag_context_text=rag_context_text,
            )
        except Exception as e:
            console.print(f"[bold red]LLM Generation Error:[/bold red] {e}")
            sys.exit(1)

    # 4. Save Review to Markdown File
    full_report = (
        f"# Code Review: PR #{pr_number} - {pr_title}\n\n"
        f"- **Repository:** `{repo_path.name}`\n"
        f"- **Author:** `@{pr_author}`\n"
        f"- **Model:** `{result.model}`\n"
        f"- **RAG Chunks Used:** {len(retrieved_chunks)}\n"
        f"- **Generated At:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"- **Tokens:** {result.total_tokens} (prompt: {result.prompt_tokens}, completion: {result.completion_tokens})\n"
        f"- **Latency:** {result.latency_seconds:.2f}s\n\n"
        f"---\n\n"
        f"{result.review_markdown}\n"
    )

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(full_report)

    console.print(f"\n[green]✓[/green] Code review successfully saved to: [bold cyan]{output_file}[/bold cyan]")

    # 5. Display Review Preview
    console.print("\n" + "=" * 80)
    console.print(Markdown(result.review_markdown))
    console.print("=" * 80 + "\n")

    # 6. Verdict summary badge
    verdict_color = "green" if result.verdict == "APPROVE" else "yellow" if result.verdict == "COMMENT" else "red"
    console.print(
        Panel.fit(
            f"[bold {verdict_color}]Verdict: {result.verdict}[/bold {verdict_color}] | "
            f"Latency: [cyan]{result.latency_seconds:.2f}s[/cyan] | "
            f"Tokens: [cyan]{result.total_tokens}[/cyan]",
            border_style=verdict_color,
        )
    )


if __name__ == "__main__":
    main()
