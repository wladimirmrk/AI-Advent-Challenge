"""Файловое хранилище сессий чата (JSON)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from src.chat.models import ChatSession


class SessionStore:
    """Персистентное хранилище сессий на основе JSON-файлов."""

    def __init__(self, sessions_dir: Path) -> None:
        self.sessions_dir = sessions_dir
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def _session_path(self, session_id: str) -> Path:
        """Путь к файлу сессии."""
        return self.sessions_dir / f"{session_id}.json"

    def save(self, session: ChatSession) -> Path:
        """Сохранить сессию в JSON-файл. Возвращает путь к файлу."""
        path = self._session_path(session.session_id)
        path.write_text(
            json.dumps(session.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return path

    def load(self, session_id: str) -> ChatSession:
        """Загрузить сессию из JSON-файла.

        Raises:
            FileNotFoundError: если файл сессии не найден.
        """
        path = self._session_path(session_id)
        if not path.exists():
            raise FileNotFoundError(f"Сессия не найдена: {session_id}")
        data = json.loads(path.read_text(encoding="utf-8"))
        return ChatSession.from_dict(data)

    def list_sessions(self) -> list[dict]:
        """Список всех сессий (краткая информация).

        Возвращает список словарей с полями session_id, created_at,
        message_count, отсортированный по created_at (новые первыми).
        """
        sessions: list[dict] = []
        for json_file in self.sessions_dir.glob("*.json"):
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                goal = data.get("task_state", {}).get("goal", "").strip()
                if not goal:
                    for msg in data.get("messages", []):
                        if msg.get("role") == "user":
                            raw_q = msg.get("content", "").strip()
                            goal = (raw_q[:57] + "...") if len(raw_q) > 60 else raw_q
                            break

                sessions.append(
                    {
                        "session_id": data.get("session_id", json_file.stem),
                        "created_at": data.get("created_at", ""),
                        "message_count": len(data.get("messages", [])),
                        "goal": goal or "Диалог без темы",
                    }
                )
            except (json.JSONDecodeError, KeyError):
                continue
        sessions.sort(key=lambda s: s["created_at"], reverse=True)
        return sessions

    def delete(self, session_id: str) -> bool:
        """Удалить файл сессии. Возвращает True если удалён, False если не найден."""
        path = self._session_path(session_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def exists(self, session_id: str) -> bool:
        """Проверить, существует ли файл сессии."""
        return self._session_path(session_id).exists()
