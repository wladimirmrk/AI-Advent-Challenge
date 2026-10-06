"""Модели данных для чат-модуля с поддержкой task memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, List, Optional
import uuid


@dataclass
class TaskState:
    """Память текущей задачи/диалога."""

    goal: str = ""
    clarifications: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    key_findings: list[str] = field(default_factory=list)
    turn_number: int = 0

    def to_dict(self) -> dict:
        """Сериализация в словарь."""
        return {
            "goal": self.goal,
            "clarifications": list(self.clarifications),
            "constraints": list(self.constraints),
            "key_findings": list(self.key_findings),
            "turn_number": self.turn_number,
        }

    @classmethod
    def from_dict(cls, data: dict) -> TaskState:
        """Десериализация из словаря."""
        return cls(
            goal=data.get("goal", ""),
            clarifications=data.get("clarifications", []),
            constraints=data.get("constraints", []),
            key_findings=data.get("key_findings", []),
            turn_number=data.get("turn_number", 0),
        )

    def to_summary(self) -> str:
        """Компактное текстовое резюме для системного промпта."""
        def _bullet_list(items: list[str]) -> str:
            if not items:
                return "нет"
            return "\n".join(f"  - {item}" for item in items)

        return (
            f"🎯 Цель: {self.goal or 'не определена'}\n"
            f"📋 Уточнения: {_bullet_list(self.clarifications)}\n"
            f"🔒 Ограничения: {_bullet_list(self.constraints)}\n"
            f"🔍 Ключевые находки: {_bullet_list(self.key_findings)}\n"
            f"🔄 Ход: {self.turn_number}"
        )

    def update(self, update_dict: dict) -> None:
        """Применить обновление из JSON-ответа LLM.

        Ключи update_dict:
          - goal (str | None): если не None — заменить цель
          - new_clarifications (list[str]): добавить к уточнениям
          - new_constraints (list[str]): добавить к ограничениям
          - new_findings (list[str]): добавить к ключевым находкам
        """
        placeholder_values = {"", "...", "…", "-", "—"}

        goal = update_dict.get("goal")
        if goal is not None and str(goal).strip().lower() not in placeholder_values:
            self.goal = str(goal).strip()

        for key, target in (
            ("new_clarifications", self.clarifications),
            ("new_constraints", self.constraints),
            ("new_findings", self.key_findings),
        ):
            for item in update_dict.get(key, []):
                text = str(item).strip()
                if text.lower() not in placeholder_values:
                    target.append(text)

        self.turn_number += 1


@dataclass
class ChatMessage:
    """Одно сообщение в диалоге."""

    role: str
    content: str
    sources: list[dict] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    task_state_snapshot: dict | None = None
    rag_metadata: dict | None = None

    def to_dict(self) -> dict:
        """Сериализация в словарь."""
        return {
            "role": self.role,
            "content": self.content,
            "sources": list(self.sources),
            "timestamp": self.timestamp,
            "task_state_snapshot": self.task_state_snapshot,
            "rag_metadata": self.rag_metadata,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ChatMessage:
        """Десериализация из словаря."""
        return cls(
            role=data["role"],
            content=data["content"],
            sources=data.get("sources", []),
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            task_state_snapshot=data.get("task_state_snapshot"),
            rag_metadata=data.get("rag_metadata"),
        )


@dataclass
class ChatSession:
    """Полная сессия чата."""

    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    messages: list[ChatMessage] = field(default_factory=list)
    task_state: TaskState = field(default_factory=TaskState)
    config: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Сериализация в словарь."""
        return {
            "session_id": self.session_id,
            "created_at": self.created_at,
            "messages": [msg.to_dict() for msg in self.messages],
            "task_state": self.task_state.to_dict(),
            "config": dict(self.config),
        }

    @classmethod
    def from_dict(cls, data: dict) -> ChatSession:
        """Десериализация из словаря."""
        return cls(
            session_id=data["session_id"],
            created_at=data.get("created_at", datetime.now().isoformat()),
            messages=[
                ChatMessage.from_dict(m) for m in data.get("messages", [])
            ],
            task_state=TaskState.from_dict(data.get("task_state", {})),
            config=data.get("config", {}),
        )

    def add_message(self, msg: ChatMessage) -> None:
        """Добавить сообщение в сессию."""
        self.messages.append(msg)

    def get_history_window(self, window_size: int = 10) -> list[ChatMessage]:
        """Вернуть последние N сообщений."""
        return self.messages[-window_size:]

    @property
    def turn_count(self) -> int:
        """Количество пользовательских сообщений."""
        return sum(1 for m in self.messages if m.role == "user")


@dataclass
class ChatTurnResult:
    """Результат одного хода чата."""

    answer: str
    sources: list[dict] = field(default_factory=list)
    task_state: TaskState = field(default_factory=TaskState)
    rag_result: Any = None
    latency_seconds: float = 0.0
    total_tokens: int = 0
