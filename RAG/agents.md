# Руководство для AI-агентов: RAG Subproject (CryptoTrack Knowledge Engine)

Данный документ предназначен для AI-ассистентов и разработчиков, работающих с подпроектом **RAG** в директории `RAG/`. Здесь описаны архитектура поисково-генеративного контура (Retrieval-Augmented Generation), структура модулей, работа с целевой кодовой базой CryptoTrack, инварианты валидации ответов и команды интерфейса командной строки (CLI).

---

## 1. Обзор подпроекта

**RAG Knowledge Engine** — автономная Python-система для анализа, индексации и интеллектуального поиска по кодовой базе реального Android-приложения **CryptoTrack** (`C:\Users\W\Projects\CryptoTrack`).

### Ключевые возможности:
- **Загрузка и фильтрация документов**: сканирование файлов Kotlin (`.kt`), Gradle (`.kts`), Markdown (`.md`), XML (`.xml`), TOML (`.toml`), Properties (`.properties`).
- **Две стратегии чанкинга**:
  1. `fixed`: скользящее окно фиксированного размера (по умолчанию 500 символов, 50 символов overlap) с мягким выравниванием по границам слов/строк.
  2. `structural`: синтаксический структурный чанкинг с учетом AST/сигнатур Kotlin (`class`, `interface`, `fun`), секций Markdown и тегов конфигураций.
- **Векторные эмбеддинги**: локальная модель Ollama **`nomic-embed-text`** (размерность 768) с L2-нормализацией векторов.
- **Гибридное хранилище (VectorStore)**:
  - **FAISS (`index.faiss`)**: быстрый поиск по индексу `IndexFlatIP` (косинусное сходство).
  - **SQLite (`chunks.db`)**: реляционное хранение полного текста чанков и структурированных метаданных.
  - **JSON (`chunks_metadata.json`)**: экспорт метаданных для внешнего анализа.
- **Многоступенчатый Retrieval & Reranking**:
  - Обогащение запроса (Query Rewriter).
  - Поиск топ-$K$ кандидатов в FAISS.
  - Кросс-энкодер реранкер (**FlashRank** / ONNX `ms-marco-TinyBERT-L-2-v2`).
  - Фильтрация нерелевантного шума (`RelevanceFilter`).
- **Антигаллюцинация и Grounding (День 24)**:
  - Проверка цитат и точных совпадений сниппетов кода в извлеченных источниках.
  - Штрафы за неподтвержденные утверждения и автоматический расчет метрики Grounding Score.
- **Чат с долговременной памятью задачи (Task State, День 25)**:
  - Удержание цели диалога (Goal Retention).
  - Накопление архитектурных находок и ограничений пользователя.
  - Персистентные JSON-сессии (`SessionStore`).
- **Автономный локальный контур (Дни 28–29)**:
  - Инференс через локальные LLM Ollama (`qwen3:8b`, `tinyllama:latest`) или облачные модели OpenRouter.
  - Оптимизация параметров генерации (`num_ctx`, `temperature`, `top_p`, `repeat_penalty`) и специализированные coding-промпты.

Стек технологий: **Python 3.10+ / 3.12**, **faiss-cpu**, **flashrank**, **rich**, **numpy**, **requests**, **tabulate**, **pytest**.

---

## 2. Структура директории `RAG/`

```text
RAG/
├── agents.md                  # Текущее руководство для AI-агентов
├── README.md                  # Детальное описание дней Advent Challenge (Дни 21–29)
├── requirements.txt           # Зависимости Python
├── pytest.ini                 # Конфигурация pytest и маркеры тестов (live)
│
├── src/                       # Исходный код RAG-системы
│   ├── config.py              # Централизованная конфигурация путей, моделей и гиперпараметров
│   ├── cli.py                 # Единый Rich CLI с 12 подкомандами
│   │
│   ├── loader/                # Загрузка файлов
│   │   └── project_loader.py  # ProjectLoader: обход дерева, валидация расширений, статистика
│   │
│   ├── chunking/              # Модули нарезки текста
│   │   ├── base.py            # Классы BaseChunker и Chunk (с полями source, section, lines)
│   │   ├── fixed_chunker.py   # Стратегия чанкинга фиксированного размера
│   │   └── structural_chunker.py # Структурный синтаксический чанкинг
│   │
│   ├── embeddings/            # Векторизация
│   │   └── ollama_embedder.py # Клиент Ollama nomic-embed-text с L2-нормализацией
│   │
│   ├── storage/               # Хранение индекса
│   │   └── vector_store.py    # VectorStore: FAISS IndexFlatIP + SQLite chunks.db
│   │
│   ├── reranking/             # Повторное ранжирование
│   │   ├── cross_encoder_reranker.py # Кросс-энкодер FlashRank
│   │   ├── relevance_filter.py       # Отсечение по порогу скора
│   │   └── pipeline.py               # Связывание поиска, реранкинга и фильтрации
│   │
│   ├── grounding/             # Контроль галлюцинаций
│   │   ├── models.py          # GroundingResult, SourceCitation, HallucinationRisk
│   │   └── validator.py       # Валидатор цитат, кода и фактов
│   │
│   ├── chat/                  # Диалоговый движок с памятью задачи
│   │   ├── models.py          # TaskState, ChatSession, MemoryItem
│   │   ├── memory_chat_engine.py # Память задачи, удержание контекста, интеграция с RAG
│   │   └── session_store.py   # Персистентное хранение сессий в data/chat_sessions/
│   │
│   ├── agent/                 # Агенты и клиенты LLM
│   │   ├── base_llm.py        # Базовый интерфейс BaseLLMClient и датакласс LLMResponse
│   │   ├── ollama_client.py   # Клиент локального Ollama API (/api/chat, /api/generate)
│   │   ├── openrouter_client.py # Клиент OpenRouter API с замером токенов и fallback
│   │   ├── llm_factory.py     # Фабрика моделей с автоопределением провайдера
│   │   └── rag_agent.py       # RAGAgent: объединение поиска, промптов и генерации
│   │
│   └── evaluation/            # Сравнительные бенчмарки и генераторы отчетов
│       ├── benchmark_dataset.py     # Вопросы для бенчмарков
│       ├── comparator.py            # Сравнение fixed vs structural
│       ├── rag_evaluator.py         # Сравнение No-RAG vs With-RAG
│       ├── rerank_evaluator.py      # Оценка эффективности реранкинга
│       ├── grounded_evaluator.py    # Бенчмарк цитирования и антигаллюцинаций
│       ├── model_comparator.py      # Сравнение локальных и облачных моделей
│       └── optimizer_comparator.py  # Сравнение оптимизированных параметров LLM
│
├── data/                      # Индексы и артефакты
│   ├── indices/               # Сохраненные индексы (fixed/ и structural/)
│   ├── chat_sessions/         # Сохраненные сессии чата (JSON)
│   └── *.md                   # Сгенерированные Markdown-отчеты бенчмарков
│
└── tests/                     # 13 тестовых файлов (65 юнит-тестов)
```

---

## 3. Справочник команд CLI (`python -m src.cli`)

Запуск всех команд осуществляется из корня репозитория либо из папки `RAG/`:

```powershell
# 1. Индексация целевого проекта (по умолчанию CryptoTrack)
python -m src.cli index --strategy structural

# 2. Семантический поиск по индексу
python -m src.cli search "Как устроена Room база данных?" --top-k 5

# 3. Сравнение выдачи стратегий fixed vs structural side-by-side
python -m src.cli compare "AssetAmountValidator"

# 4. Разовый вопрос агенту (с RAG или без RAG)
python -m src.cli ask "В каком модуле находится навигация?" --provider ollama
python -m src.cli ask "Объясни назначение AssetAmountValidator" --provider openrouter --model openai/gpt-4o-mini

# 5. Интерактивный терминальный чат
python -m src.cli chat --provider ollama

# 6. Чат с памятью задачи (Task Memory, День 25)
python -m src.cli chat-memory --provider ollama
python -m src.cli chat-memory --list-sessions
python -m src.cli chat-memory --session <session_id>

# 7. Запуск сравнительного бенчмарка чанкинга
python -m src.cli benchmark

# 8. Запуск бенчмарка реранкинга (Day 23)
python -m src.cli compare-rerank

# 9. Бенчмарк антигаллюцинаций и цитирования (Day 24)
python -m src.cli benchmark-grounded

# 10. Бенчмарк Local LLM vs Cloud LLM (Day 28)
python -m src.cli compare-models

# 11. Бенчмарк оптимизации параметров локальной LLM (Day 29)
python -m src.cli optimize-local
```

### Slash-команды внутри интерактивного чата
| Команда | Описание |
|:---|:---|
| `/state` | Отобразить текущее состояние памяти задачи (цель, ограничения, находки) |
| `/sources` | Вывести источники и чанки последнего ответа |
| `/history` | Показать полную историю текущей сессии |
| `/provider <ollama\|openrouter>` | Переключить активного провайдера на лету |
| `/model <name>` | Сменить модель (например, `qwen3:8b`, `tinyllama:latest`) |
| `/rag on\|off` | Включить или выключить извлечение контекста RAG |
| `/rerank on\|off` | Включить или выключить реранкинг FlashRank |
| `/rewrite on\|off` | Включить или выключить Query Rewriter |
| `/save`, `/new` | Сохранить текущую сессию / создать новую |
| `/switch` | Список сохраненных сессий и переключение |
| `/exit` | Сохранить состояние сессии и завершить работу |

---

## 4. Архитектурные инварианты и правила для AI-агентов

1. **Кодировка консоли Windows**:
   - В Windows консоли PowerShell по умолчанию может использоваться кодировка `cp1251`.
   - В `src/cli.py` и любых новых скриптах всегда обеспечивайте явную настройку UTF-8:
     ```python
     if sys.platform.startswith("win"):
         os.environ["PYTHONIOENCODING"] = "utf-8"
         if hasattr(sys.stdout, "reconfigure"):
             sys.stdout.reconfigure(encoding="utf-8", errors="replace")
     ```
2. **Кроссплатформенные пути**:
   - Используйте строго `pathlib.Path` вместо строковой конкатенации путей.
   - Базовый путь к проекту берется из `src/config.py` (`default_config.project_path`).
3. **Строгая изоляция L2-нормализации векторов**:
   - Индекс FAISS построен на базе `IndexFlatIP` (Inner Product).
   - Для того чтобы Inner Product равнялся косинусному сходству (Cosine Similarity), **все** векторы документов и поисковых запросов должны быть нормализованы по норме L2 перед добавлением или поиском в `vector_store.py`.
4. **Безопасная деградация (Graceful Fallback)**:
   - Если Ollama недоступен или не запущен, клиент `OllamaClient` выбрасывает типизированную ошибку `OllamaError` либо переключается в `mock_mode` при запуске юнит-тестов.
   - Если внешний OpenRouter API возвращает ошибку квоты (429/402), система фиксирует флаг `is_mock = True` и уведомляет пользователя, избегая аварийного падения.
5. **Валидация Grounding**:
   - Ответы RAG-агента должны явно ссылаться на извлеченные файлы и строки кодовой базы CryptoTrack в формате `[ИмяФайла:Lxx-Lyy]`.
   - Запрещается придумывать несуществующие классы или методы.
6. **Тестирование**:
   - Быстрые юнит-тесты без внешних API запускаются командой:
     ```bash
     python -m pytest RAG/tests -k "not live"
     ```
   - Тесты с маркером `live` требуют реального API-ключа и подключения к сети.
