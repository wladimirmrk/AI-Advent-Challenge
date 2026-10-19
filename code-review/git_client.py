"""GitHub CLI client for fetching pull request diffs and metadata."""

import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


class GitClientError(Exception):
    """Exception raised for errors during GitHub CLI operations."""
    pass


class GitClient:
    """Wrapper for interacting with GitHub CLI (`gh`)."""

    def __init__(self, gh_executable: Optional[str] = None):
        self.gh_executable = gh_executable or self._resolve_gh_executable()

    @staticmethod
    def _resolve_gh_executable() -> str:
        """Find the `gh` binary in PATH or common Windows installation paths."""
        # 1. Check PATH
        path_which = shutil.which("gh")
        if path_which:
            return path_which

        # 2. Check common Windows install paths
        candidates = [
            Path(r"C:\Program Files\GitHub CLI\gh.exe"),
            Path(r"C:\Program Files (x86)\GitHub CLI\gh.exe"),
            Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe")),
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)

        # Fallback to plain name (may fail if not in PATH, will report clean error)
        return "gh"

    def _run_gh_command(self, args: list[str], cwd: Path) -> subprocess.CompletedProcess:
        """Run gh command with given arguments in specified directory."""
        if not cwd.is_dir():
            raise GitClientError(f"Directory not found: {cwd}")

        cmd = [self.gh_executable] + args
        try:
            result = subprocess.run(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            return result
        except FileNotFoundError:
            raise GitClientError(
                f"GitHub CLI ('gh') was not found at '{self.gh_executable}'. "
                "Please verify GitHub CLI is installed."
            )
        except Exception as e:
            raise GitClientError(f"Failed to execute gh command: {e}") from e

    def get_pr_metadata(self, pr_number: int, repo_path: Path) -> Dict[str, Any]:
        """Fetch pull request metadata using `gh pr view`."""
        args = [
            "pr",
            "view",
            str(pr_number),
            "--json",
            "number,title,body,state,baseRefName,headRefName,author,url",
        ]
        proc = self._run_gh_command(args, cwd=repo_path)
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            raise GitClientError(f"Failed to fetch metadata for PR #{pr_number}: {err}")

        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            logger.warning("Could not parse JSON metadata for PR #%s: %s", pr_number, e)
            return {"number": pr_number, "raw": proc.stdout}

    def get_pr_diff(
        self,
        pr_number: int,
        repo_path: Path,
        output_file: Optional[Path] = None,
    ) -> Tuple[str, Path]:
        """
        Fetch pull request diff using `gh pr diff <pr_number>` and save to output_file.
        Returns a tuple of (diff_content, output_file_path).
        """
        args = ["pr", "diff", str(pr_number)]
        proc = self._run_gh_command(args, cwd=repo_path)
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            raise GitClientError(f"Failed to fetch diff for PR #{pr_number}: {err}")

        diff_content = proc.stdout
        if not diff_content.strip():
            logger.warning("PR #%s returned an empty diff.", pr_number)

        target_file = output_file or (repo_path / f"diff_pr_{pr_number}.diff")
        target_file.parent.mkdir(parents=True, exist_ok=True)

        with open(target_file, "w", encoding="utf-8") as f:
            f.write(diff_content)

        return diff_content, target_file
