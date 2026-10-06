"""Тесты для мини-чата с RAG и памятью задачи (Day 25).

Включает:
1. Быстрые unit-тесты (TaskState, SessionStore, MemoryChatEngine с mock)
2. Live-тесты двух длинных сценариев по 10 сообщений с генерацией отчёта (маркер @pytest.mark.live)
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
import pytest

if sys.platform.startswith("win"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from src.config import default_config
from src.agent.openrouter_client import OpenRouterClient
from src.agent.rag_agent import RAGAgent
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.storage.vector_store import VectorStore
from src.chat.models import ChatMessage, ChatSession, ChatTurnResult, TaskState
from src.chat.session_store import SessionStore
from src.chat.memory_chat import MemoryChatEngine
from src.chat.scenario_reporter import ScenarioReporter, ScenarioResult


# ---------------------------------------------------------------------------
# Unit Tests (Fast, offline, no API key needed)
# ---------------------------------------------------------------------------


def test_task_state_lifecycle():
    """Проверка жизненного цикла TaskState: сериализация, обновление, summary."""
    ts = TaskState(goal="Изучение архитектуры базы данных")
    assert ts.turn_number == 0
    assert "Изучение архитектуры" in ts.to_summary()

    # Обновление состояния
    update_data = {
        "goal": "Углубленный анализ Room в CryptoTrack",
        "new_clarifications": ["Пользователь спросил про DAO"],
        "new_constraints": ["Версия Room 2.6.1"],
        "new_findings": ["Обнаружено 5 DAO интерфейсов"],
    }
    ts.update(update_data)

    assert ts.turn_number == 1
    assert ts.goal == "Углубленный анализ Room в CryptoTrack"
    assert len(ts.clarifications) == 1
    assert len(ts.constraints) == 1
    assert len(ts.key_findings) == 1

    # Сериализация и десериализация
    d = ts.to_dict()
    restored = TaskState.from_dict(d)
    assert restored.goal == ts.goal
    assert restored.turn_number == ts.turn_number
    assert restored.clarifications == ts.clarifications


def test_session_store_crud(tmp_path: Path):
    """Проверка персистентного хранилища SessionStore: создание, загрузка, удаление."""
    store = SessionStore(tmp_path / "sessions")
    assert len(store.list_sessions()) == 0

    session = ChatSession()
    session.task_state.goal = "Тестовая цель"
    session.add_message(ChatMessage(role="user", content="Привет"))
    session.add_message(ChatMessage(role="assistant", content="Здравствуйте! Чем помочь?"))

    # Сохранение
    file_path = store.save(session)
    assert file_path.exists()
    assert store.exists(session.session_id)

    # Список
    sessions_list = store.list_sessions()
    assert len(sessions_list) == 1
    assert sessions_list[0]["session_id"] == session.session_id
    assert sessions_list[0]["message_count"] == 2
    assert sessions_list[0]["goal"] == "Тестовая цель"

    # Загрузка
    loaded = store.load(session.session_id)
    assert loaded.session_id == session.session_id
    assert loaded.task_state.goal == "Тестовая цель"
    assert len(loaded.messages) == 2
    assert loaded.messages[0].content == "Привет"

    # Удаление
    assert store.delete(session.session_id) is True
    assert not store.exists(session.session_id)
    assert len(store.list_sessions()) == 0


def test_session_store_list_with_goal_and_fallback(tmp_path: Path):
    """Проверка извлечения цели и темы диалога в list_sessions."""
    store = SessionStore(tmp_path / "sessions")

    # Сессия 1: Явная цель в TaskState
    s1 = ChatSession()
    s1.task_state.goal = "Архитектура Room и DAO"
    s1.add_message(ChatMessage(role="user", content="Вопрос 1"))
    store.save(s1)

    # Сессия 2: Без явной цели, тема извлекается из первого вопроса
    s2 = ChatSession()
    s2.add_message(ChatMessage(role="user", content="Как работает навигация в Compose?"))
    store.save(s2)

    sessions = store.list_sessions()
    assert len(sessions) == 2
    by_id = {s["session_id"]: s for s in sessions}

    assert by_id[s1.session_id]["goal"] == "Архитектура Room и DAO"
    assert "навигация в Compose" in by_id[s2.session_id]["goal"]


def test_memory_chat_sliding_window(tmp_path: Path):
    """Проверка скользящего окна истории сообщений."""
    session = ChatSession()
    for i in range(15):
        session.add_message(ChatMessage(role="user", content=f"Q{i}"))
        session.add_message(ChatMessage(role="assistant", content=f"A{i}"))

    assert len(session.messages) == 30
    window = session.get_history_window(window_size=6)
    assert len(window) == 6
    assert window[0].content == "Q12"
    assert window[-1].content == "A14"


def test_memory_chat_engine_mock(tmp_path: Path):
    """Проверка движка диалога MemoryChatEngine в Mock-режиме."""
    index_dir = default_config.structural_index_dir
    if not (index_dir / "index.faiss").exists():
        pytest.skip("Index not found, skipping mock engine test")

    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(base_url=default_config.ollama_base_url, model=default_config.ollama_model)
    llm = OpenRouterClient(mock_mode=True)
    agent = RAGAgent(vector_store=store, embedder=embedder, llm_client=llm)

    session_store = SessionStore(tmp_path / "sessions")
    session = ChatSession()
    engine = MemoryChatEngine(
        rag_agent=agent,
        session=session,
        session_store=session_store,
        window_size=6,
    )

    # Раунд 1
    res1 = engine.process_turn("Какие базы данных используются в CryptoTrack?")
    assert len(res1.answer) > 0
    assert session.task_state.turn_number == 1
    assert session.turn_count == 1
    assert len(session.messages) == 2
    assert len(res1.sources) > 0
    assert session_store.exists(session.session_id)

    # Раунд 2
    res2 = engine.process_turn("Расскажи подробнее про CryptoTrackDatabase и Room")
    assert len(res2.answer) > 0
    assert session.task_state.turn_number == 2
    assert session.turn_count == 2
    assert len(session.messages) == 4


# ---------------------------------------------------------------------------
# Live Scenario Tests (2 scenarios of 10 messages each, writes report)
# ---------------------------------------------------------------------------

SCENARIO_1_QUESTIONS = [
    "Какие базы данных или локальные хранилища используются в Android-приложении CryptoTrack?",
    "Расскажи подробнее про Room: какой класс представляет основную базу данных и какая у неё версия схемы?",
    "Какие DAO-интерфейсы зарегистрированы в CryptoTrackDatabase?",
    "Как устроена работа с кэшем котировок и временем жизни данных в CacheMetaDao?",
    "Есть ли в проекте миграции базы данных Room или используется fallbackToDestructiveMigration?",
    "Как Room связывается с UseCase и репозиториями через Hilt (Dependency Injection)?",
    "Какая стратегия кэширования применяется при получении данных о монетах: Single Source of Truth?",
    "Как сохраняются и обновляются избранные монеты в FavoriteDao?",
    "Где хранятся пользовательские настройки (выбранная фиатная валюта, тема оформления)?",
    "Подведи итог: опиши полную сквозную архитектуру слоя данных (Data Layer) в приложении CryptoTrack.",
]

SCENARIO_2_QUESTIONS = [
    "Какие основные экраны и направления навигации (destinations) реализованы в CryptoTrack?",
    "Как устроена нижняя панель навигации ApexBottomBar и какие вкладки в неё входят?",
    "Как организована Compose-навигация и NavHost между экранами приложения?",
    "Расскажи про экран детальной информации о монете (CoinDetailScreen): какие данные он отображает?",
    "Используются ли UseCase в модулях экранов, например ObserveCoinDetailsUseCase?",
    "Как на экранах обрабатываются состояния загрузки (Loading), ошибки (Error) и отображения данных?",
    "Как устроена пагинация или обновление списков криптовалют при скролле?",
    "Где и как реализована валидация суммы актива AssetAmountValidator при добавлении в портфель?",
    "Как устроена дизайн-система приложения: темы, цвета, компоненты в модуле core:designsystem?",
    "Подведи итог: сформируй архитектурное резюме UI-слоя и навигации CryptoTrack с перечнем ключевых компонентов.",
]


@pytest.mark.live
def test_two_long_scenarios_with_report():
    """Выполнение 2 длинных сценариев по 10 сообщений с RAG, историей и памятью задачи.

    Проверяет:
    - Ассистент не теряет цель на протяжении 10 ходов
    - Выводит проверенные источники в ответах
    - Актуализирует память задачи (task state)
    - Сохраняет историю диалога
    - Генерирует итоговый отчёт data/chat_scenario_report.md
    """
    index_dir = default_config.structural_index_dir
    if not (index_dir / "index.faiss").exists():
        pytest.skip(f"Index not found in {index_dir}. Run `index` first.")

    api_key = default_config.openrouter_api_key
    model = default_config.openrouter_model

    # Инициализация RAG Agent
    store = VectorStore.load(index_dir)
    embedder = OllamaEmbedder(base_url=default_config.ollama_base_url, model=default_config.ollama_model)
    llm = OpenRouterClient(api_key=api_key, default_model=model)
    agent = RAGAgent(vector_store=store, embedder=embedder, llm_client=llm)

    sessions_dir = default_config.data_dir / "sessions"
    session_store = SessionStore(sessions_dir)
    reporter = ScenarioReporter(model=model)

    scenarios_meta = [
        (
            "Архитектура хранения данных CryptoTrack",
            "10 раундов диалога об организации Room, DAO, стратегиях кэширования и Data Layer",
            SCENARIO_1_QUESTIONS,
        ),
        (
            "UI и навигация в CryptoTrack",
            "10 раундов диалога об организации экранов, Compose-навигации, валидации и дизайн-системе",
            SCENARIO_2_QUESTIONS,
        ),
    ]

    for sc_name, sc_desc, questions in scenarios_meta:
        print(f"\n=======================================================")
        print(f"Запуск сценария: {sc_name}")
        print(f"=======================================================")

        session = ChatSession()
        engine = MemoryChatEngine(
            rag_agent=agent,
            session=session,
            session_store=session_store,
            window_size=10,
        )

        turn_results: list[ChatTurnResult] = []

        for turn_idx, q in enumerate(questions, 1):
            print(f"[{turn_idx}/10] Вопрос: {q}")
            res = engine.process_turn(
                user_question=q,
                use_rag=True,
                use_rewrite=True,
                use_rerank=True,
                top_k=4,
            )
            turn_results.append(res)
            print(f"       -> Ответ ({len(res.answer)} симв), Источников: {len(res.sources)}, Время: {res.latency_seconds:.2f}с")
            print(f"       -> Память: Цель='{session.task_state.goal[:40]}...', Ход={session.task_state.turn_number}")

            if turn_idx < len(questions):
                time.sleep(float(os.getenv("CHAT_SCENARIO_DELAY", "1.5")))

        # Проверка инвариантов для сценария
        invariant_checks = []

        # 1. Длина диалога
        has_10_turns = session.turn_count == 10
        invariant_checks.append({
            "name": "10 завершённых пользовательских раундов",
            "passed": has_10_turns,
            "detail": f"Всего пользовательских сообщений: {session.turn_count}",
        })

        # 2. Непустой ответ на каждом шаге
        all_answers_ok = all(len(tr.answer) >= 50 for tr in turn_results)
        invariant_checks.append({
            "name": "Качественные непустые ответы на всех шагах (>=50 симв)",
            "passed": all_answers_ok,
            "detail": f"Минимальная длина ответа: {min(len(tr.answer) for tr in turn_results)} симв",
        })

        # 3. Наличие источников
        turns_with_sources = sum(1 for tr in turn_results if len(tr.sources) > 0)
        sources_ok = turns_with_sources >= 9  # допускаем 1 раунд без прямых совпадений
        invariant_checks.append({
            "name": "Наличие источников из кодовой базы в ответах (>=90%)",
            "passed": sources_ok,
            "detail": f"{turns_with_sources}/10 раундов содержат проверенные источники",
        })

        # 4. Удержание цели (Goal retention)
        final_goal = session.task_state.goal
        goal_ok = bool(final_goal and len(final_goal) >= 10)
        invariant_checks.append({
            "name": "Удержание и фиксация цели диалога (Goal Retention)",
            "passed": goal_ok,
            "detail": f"Итоговая цель: '{final_goal}'",
        })

        # 5. Накопление уточнений/ограничений
        clarifs_count = len(session.task_state.clarifications)
        clarifs_ok = clarifs_count >= 5
        invariant_checks.append({
            "name": "Динамическое накопление уточнений в памяти задачи",
            "passed": clarifs_ok,
            "detail": f"Зафиксировано уточнений: {clarifs_count}",
        })

        # 6. Персистентность сессии
        persisted = session_store.exists(session.session_id)
        invariant_checks.append({
            "name": "Успешное сохранение сессии в JSON-хранилище",
            "passed": persisted,
            "detail": f"Файл сессии data/sessions/{session.session_id}.json существует",
        })

        sc_result = ScenarioResult(
            name=sc_name,
            description=sc_desc,
            session=session,
            turn_results=turn_results,
            invariant_checks=invariant_checks,
        )
        reporter.add_scenario(sc_result)

    # Генерация и сохранение отчёта
    report_path = default_config.data_dir / "chat_scenario_report.md"
    saved_path = reporter.save(report_path)
    print(f"\n[bold green]✓ Отчёт по двум сценариям успешно сгенерирован и сохранён в:[/bold green] {saved_path}")

    # Защита от ложного PASS: если дневная квота исчерпалась и клиент деградировал в mock,
    # прогон не считается честной верификацией
    if getattr(agent.llm_client, "degraded_to_mock", False):
        pytest.fail(
            "Прогон деградировал в mock-режим (дневная квота free-модели исчерпана). "
            "Отчёт сохранён, но не является верификацией реального LLM. "
            "Перезапустите тест после сброса квоты или с другой моделью (OPENROUTER_MODEL)."
        )

    # Утверждения тестов
    for sc in reporter.scenarios:
        for check in sc.invariant_checks:
            assert check["passed"] is True, f"Invariant failed in '{sc.name}': {check['name']} ({check['detail']})"
