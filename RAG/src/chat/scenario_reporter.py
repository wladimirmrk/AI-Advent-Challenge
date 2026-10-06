"""Генератор отчёта по многораундовым сценариям чата с памятью задачи (День 25)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.chat.models import ChatMessage, ChatSession, ChatTurnResult, TaskState


@dataclass
class ScenarioResult:
    """Результаты выполнения одного многораундового сценария."""

    name: str
    description: str
    session: ChatSession
    turn_results: List[ChatTurnResult] = field(default_factory=list)
    invariant_checks: List[Dict[str, Any]] = field(default_factory=list)


class ScenarioReporter:
    """Генератор сводного Markdown-отчёта по тестовым сценариям диалога."""

    def __init__(
        self,
        model: str = "",
        pipeline_mode: str = "Grounded RAG (Rewrite + Rerank + Grounding + Task Memory)",
    ) -> None:
        self.model = model
        self.pipeline_mode = pipeline_mode
        self.scenarios: List[ScenarioResult] = []

    def add_scenario(self, scenario: ScenarioResult) -> None:
        """Добавить результаты сценария в отчёт."""
        self.scenarios.append(scenario)

    def _render_turn_table(self, scenario: ScenarioResult) -> str:
        """Рендеринг таблицы метрик по раундам."""
        lines = [
            "| # | Вопрос | Длина ответа (симв) | Источников | Top Relevance | Latency (сек) | Токенов |",
            "|:---:|:---|:---:|:---:|:---:|:---:|:---:|",
        ]

        user_messages = [m for m in scenario.session.messages if m.role == "user"]

        for idx, tr in enumerate(scenario.turn_results, 1):
            q_text = user_messages[idx - 1].content if idx - 1 < len(user_messages) else f"Ход {idx}"
            # Сократим длинный вопрос для таблицы
            q_short = (q_text[:45] + "...") if len(q_text) > 45 else q_text
            ans_len = len(tr.answer)
            src_count = len(tr.sources)

            top_score = 0.0
            if tr.sources:
                scores = [s.get("score", 0.0) for s in tr.sources if isinstance(s, dict)]
                top_score = max(scores, default=0.0)

            score_str = f"{top_score:.4f}" if top_score > 0 else "—"

            lines.append(
                f"| {idx} | {q_short} | {ans_len} | {src_count} | {score_str} | {tr.latency_seconds:.2f}s | {tr.total_tokens} |"
            )

        return "\n".join(lines)

    def _render_task_state_evolution(self, scenario: ScenarioResult) -> str:
        """Рендеринг эволюции Task State по ходам."""
        lines = [
            "| Ход | Цель диалога (Goal) | Уточнения (Clarifications) | Ограничения (Constraints) | Ключевые находки (Findings) |",
            "|:---:|:---|:---|:---|:---|",
        ]

        asst_messages = [m for m in scenario.session.messages if m.role == "assistant"]

        for idx, m in enumerate(asst_messages, 1):
            snap = m.task_state_snapshot or {}
            goal = snap.get("goal", "—")
            clarifs = snap.get("clarifications", [])
            constraints = snap.get("constraints", [])
            findings = snap.get("key_findings", [])

            c_str = f"{len(clarifs)}: " + "; ".join(clarifs[-2:]) if clarifs else "—"
            if len(c_str) > 50:
                c_str = c_str[:47] + "..."

            lim_str = f"{len(constraints)}: " + "; ".join(constraints[-2:]) if constraints else "—"
            if len(lim_str) > 50:
                lim_str = lim_str[:47] + "..."

            f_str = f"{len(findings)}: " + "; ".join(findings[-1:]) if findings else "—"
            if len(f_str) > 50:
                f_str = f_str[:47] + "..."

            lines.append(f"| {idx} | {goal} | {c_str} | {lim_str} | {f_str} |")

        return "\n".join(lines)

    def _render_source_coverage(self, scenario: ScenarioResult) -> str:
        """Анализ уникальных источников и покрытия кодовой базы."""
        unique_files: set[str] = set()
        file_freq: dict[str, int] = {}

        for tr in scenario.turn_results:
            for s in tr.sources:
                path = s.get("source", "")
                if path:
                    unique_files.add(path)
                    file_freq[path] = file_freq.get(path, 0) + 1

        top_files = sorted(file_freq.items(), key=lambda x: x[1], reverse=True)[:5]

        lines = [
            f"- **Всего уникальных файлов-источников:** `{len(unique_files)}`",
            f"- **Наиболее часто цитируемые компоненты:**",
        ]
        for fpath, cnt in top_files:
            lines.append(f"  - `{fpath}` (использован в {cnt} раундах)")

        return "\n".join(lines)

    def _render_invariant_checks(self, scenario: ScenarioResult) -> str:
        """Таблица проверки ключевых архитектурных инвариантов."""
        lines = [
            "| Инвариант | Статус | Детали / Значение |",
            "|:---|:---:|:---|",
        ]

        for check in scenario.invariant_checks:
            icon = "✅ PASS" if check.get("passed") else "❌ FAIL"
            name = check.get("name", "")
            detail = check.get("detail", "")
            lines.append(f"| {name} | {icon} | {detail} |")

        return "\n".join(lines)

    def _count_mock_turns(self, scenario: ScenarioResult) -> int:
        """Число ходов, отвеченных заглушкой (mock) вместо реального LLM."""
        mock = 0
        for m in scenario.session.messages:
            if m.role == "assistant" and (m.rag_metadata or {}).get("is_mock", False):
                mock += 1
        return mock

    def generate_report(self) -> str:
        """Сформировать итоговый структурированный Markdown-отчёт."""
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        total_turns = sum(len(s.turn_results) for s in self.scenarios)
        total_mock_turns = sum(self._count_mock_turns(s) for s in self.scenarios)
        real_turns = total_turns - total_mock_turns
        verification_mode = "live (реальный LLM)" if total_mock_turns == 0 else f"mixed/mock (реальных ходов: {real_turns}/{total_turns})"

        lines = [
            "# 📊 Отчёт: Мини-чат с RAG + памятью задачи (День 25)",
            "",
            f"**Дата тестирования:** `{now_str}`  ",
            f"**Модель LLM:** `{self.model or 'OpenRouter'}`  ",
            f"**Режим верификации:** `{verification_mode}`  ",
            f"**Режим RAG:** `{self.pipeline_mode}`  ",
            f"**Количество сценариев:** `{len(self.scenarios)}`  ",
            "",
            "---",
            "",
        ]

        total_tokens = sum(sum(tr.total_tokens for tr in s.turn_results) for s in self.scenarios)
        all_latencies = [tr.latency_seconds for s in self.scenarios for tr in s.turn_results]
        avg_latency = sum(all_latencies) / len(all_latencies) if all_latencies else 0.0

        for s_idx, scenario in enumerate(self.scenarios, 1):
            sc_mock = self._count_mock_turns(scenario)
            sc_total = len(scenario.turn_results)
            sc_mode = "live" if sc_mock == 0 else f"mock/offline ({sc_mock}/{sc_total} ходов на заглушке)"
            lines.extend([
                f"## 🧪 Сценарий {s_idx}: {scenario.name}",
                "",
                f"**Описание:** {scenario.description}  ",
                f"**ID сессии:** `{scenario.session.session_id}`  ",
                f"**Всего раундов:** `{sc_total}`  ",
                f"**Режим сценария:** `{sc_mode}`  ",
                "",
                "### 📈 Метрики по раундам",
                "",
                self._render_turn_table(scenario),
                "",
                "### 🧠 Эволюция памяти задачи (Task State)",
                "",
                self._render_task_state_evolution(scenario),
                "",
                "### 📚 Покрытие источниками",
                "",
                self._render_source_coverage(scenario),
                "",
                "### 🛡️ Проверка инвариантов",
                "",
                self._render_invariant_checks(scenario),
                "",
                "---",
                "",
            ])

        # Сводный вердикт
        all_passed = all(
            check.get("passed", False)
            for s in self.scenarios
            for check in s.invariant_checks
        )
        verdict_str = "✅ ВСЕ ИНВАРИАНТЫ УСПЕШНО ВЫПОЛНЕНЫ (PASS)" if all_passed else "❌ ОБНАРУЖЕНЫ ОТКЛОНЕНИЯ (FAIL)"

        def _find_check(name_part: str) -> Optional[Dict[str, Any]]:
            for s in self.scenarios:
                for check in s.invariant_checks:
                    if name_part in check.get("name", ""):
                        return check
            return None

        goal_check = _find_check("Goal Retention")
        src_check = _find_check("источников")
        goal_str = (
            "100% (цель не теряется на протяжении всех ходов)" if goal_check and goal_check.get("passed") else "❌ см. инварианты"
        )
        src_str = (
            "100% (все ответы содержат проверенные источники)" if src_check and src_check.get("passed") else "❌ см. инварианты"
        )

        lines.extend([
            "## 🏆 Итоговая сводка и вердикт",
            "",
            "| Метрика | Значение |",
            "|:---|:---|",
            f"| Всего обработано раундов | `{total_turns}` |",
            f"| Ходов с реальным LLM | `{real_turns}/{total_turns}` |",
            f"| Суммарно токенов | `{total_tokens:,}` |",
            f"| Средняя задержка раунда (Latency) | `{avg_latency:.2f} сек` |",
            f"| Сохранение цели (Goal Retention) | `{goal_str}` |",
            f"| Постоянство вывода источников | `{src_str}` |",
            "",
            f"### Вердикт: {verdict_str}",
            "",
        ])

        if total_mock_turns > 0:
            lines.append(f"> ⚠️ Внимание: `{total_mock_turns}` из `{total_turns}` ходов выполнены заглушкой (исчерпание дневной квоты или offline-режим). Инварианты проверены, но ответы этих ходов детерминированные.")
        elif all_passed:
            lines.append("> Ассистент успешно удерживает контекст задачи, фиксирует архитектурные ограничения и непрерывно подкрепляет ответы ссылками на исходный код на всей дистанции сценария.")
        else:
            lines.append("> Обнаружены отклонения по части инвариантов — см. таблицы «Проверка инвариантов» по каждому сценарию.")

        lines.append("")

        return "\n".join(lines)

    def save(self, path: Path) -> Path:
        """Сохранить сгенерированный отчёт в файл."""
        path.parent.mkdir(parents=True, exist_ok=True)
        content = self.generate_report()
        path.write_text(content, encoding="utf-8")
        return path
