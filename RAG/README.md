# RAG Document Indexing Pipeline (Android Project CryptoTrack)
### AI Advent Challenge — День 21. Индексация документов

Полноценное Python-приложение для загрузки, структурного и фиксированного чанкинга, генерации векторных эмбеддингов через локальную модель Ollama (`nomic-embed-text`), сохранения индекса в FAISS + SQLite/JSON и сравнительного анализа стратегий чанкинга на базе реального Android-проекта **CryptoTrack**.

---

## 📌 Возможности и соответствие заданию

- **Набор документов**: Android-проект **CryptoTrack** (`C:\Users\W\Projects\CryptoTrack`).
  - 200 документов (Kotlin `.kt`, скрипты `.kts`, документация `.md`, конфигурации `.xml`, `.toml`, `.properties`).
  - ~495 000 символов, ~12 700 строк кода и документации (эквивалент **~275 стандартных страниц текста** при требовании 20–30 страниц).
- **Пайплайн индексации**:
  - **Chunking (2 стратегии)**:
    1. `fixed`: Скользящее окно фиксированного размера (по умолчанию 500 символов, 50 символов overlap) с мягким выравниванием по границам слов/строк.
    2. `structural`: Иерархическое разбиение с учётом синтаксиса и семантики (заголовки `#`, `##` для Markdown, декларации `class`, `interface`, `fun`, `package` для Kotlin, теги для XML/конфигов).
  - **Эмбеддинги**: Локальная модель Ollama **`nomic-embed-text`** (размерность 768, контекстное окно 8192 токена) с нормализацией векторов L2.
  - **Хранение индекса**:
    - **FAISS (`index.faiss`)**: Быстрый векторный индекс `IndexFlatIP` для расчёта косинусного сходства.
    - **SQLite (`chunks.db`)**: Реляционная база данных для персистентного хранения текста чанков и структурированных метаданных.
    - **JSON (`chunks_metadata.json`)**: Человекочитаемый экспорт всех метаданных и параметров чанков.
- **Метаданные чанка**:
  - `chunk_id`: Уникальный идентификатор чанка.
  - `source`: Относительный путь к файлу в репозитории.
  - `title`: Имя исходного файла/модуля.
  - `section`: Название секции (breadcrumb заголовков или сигнатура класса/функции).
  - `chunk_index`: Порядковый номер чанка в документе.
  - `strategy`: Стратегия чанкинга (`fixed` или `structural`).
  - `metadata`: `start_line`, `end_line`, `start_char`, `end_char`, `language`, `file_type`, `token_estimate`.
- **Сравнение и бенчмарк**:
  - Автоматический расчёт количественных метрик (распределение длин, медианы, дисперсия, процент мелких/крупных блоков).
  - Семантический поиск по 5 типовым архитектурным запросам проекта CryptoTrack.
  - Генерация подробного Markdown-отчёта (`data/comparison_report.md`).
  - Интерактивный терминальный CLI-режим для сопоставления результатов side-by-side в реальном времени.

---

## 🗂 Структура проекта

```text
RAG/
├── requirements.txt                   # Зависимости проекта
├── README.md                          # Руководство пользователя
├── data/                              # Директория индексов и отчётов
│   ├── indices/
│   │   ├── fixed/                     # FAISS + SQLite + JSON для fixed strategy
│   │   └── structural/                # FAISS + SQLite + JSON для structural strategy
│   └── comparison_report.md           # Сгенерированный отчёт бенчмарка
├── src/
│   ├── __init__.py
│   ├── config.py                      # Конфигурация путей, моделей и гиперпараметров
│   ├── loader/
│   │   ├── __init__.py
│   │   └── project_loader.py          # Загрузчик и анализатор документов проекта
│   ├── chunking/
│   │   ├── __init__.py
│   │   ├── base.py                    # Базовые классы BaseChunker и Chunk
│   │   ├── fixed_chunker.py           # Стратегия чанкинга фиксированного размера
│   │   └── structural_chunker.py      # Структурный чанкинг (Markdown / Kotlin / XML)
│   ├── embeddings/
│   │   ├── __init__.py
│   │   └── ollama_embedder.py         # Клиент локальных эмбеддингов Ollama
│   ├── storage/
│   │   ├── __init__.py
│   │   └── vector_store.py            # FAISS + SQLite + JSON хранилище
│   ├── evaluation/
│   │   ├── __init__.py
│   │   └── comparator.py              # Бенчмарк, метрики и генератор отчёта
│   └── cli.py                         # Единый CLI интерфейс
└── tests/
    ├── __init__.py
    ├── test_loader.py
    ├── test_chunkers.py
    ├── test_vector_store.py
    └── test_comparator.py
```

---

## 🚀 Установка и запуск

### 1. Требования
- Python 3.10+
- Установленный и запущенный [Ollama](https://ollama.com/)
- Скачанная модель:
  ```bash
  ollama pull nomic-embed-text
  ```

### 2. Установка зависимостей
```bash
pip install -r RAG/requirements.txt
```

### 3. Запуск тестов
```bash
python -m pytest RAG/tests -v
```

---

## 💻 Использование CLI

Все команды запускаются через модуль `src.cli` из папки `RAG/` (или с указанием `python -m src.cli`):

### 1. Индексация проекта
Индексация проекта CryptoTrack обеими стратегиями (`fixed` и `structural`):
```bash
python -m src.cli index --strategy both --project-path ../CryptoTrack
```
Параметры:
- `--strategy`: `fixed`, `structural` или `both` (по умолчанию `both`).
- `--project-path`: Путь к проекту (по умолчанию определяется автоматически как `../CryptoTrack`).
- `--max-docs`: Ограничение числа документов (по умолчанию все; приоритет отдается документации и конфигурациям).
- `--exclude`: Glob-паттерны для исключения (по умолчанию исключаются `docs/decisions/**`, `**/.git/**`, `**/build/**` и др.).
- `--chunk-size`: Размер фиксированного чанка (по умолчанию 500 символов).
- `--overlap`: Размер перекрытия (по умолчанию 50 символов).

### 2. Сравнительный бенчмарк и генерация отчёта
```bash
python -m src.cli benchmark
```
Команда выведет в консоль сводные таблицы статистики и результаты поиска по типовым запросам, а также сформирует файл `RAG/data/comparison_report.md`.

### 3. Поиск по индексу
```bash
python -m src.cli search --query "CoinGecko API client service" --strategy structural --top-k 3
```

### 4. Сравнение стратегий side-by-side
Сравнение на одном запросе:
```bash
python -m src.cli compare --query "Room database crypto currency entity"
```
Интерактивный режим (ввод запросов в цикле):
```bash
python -m src.cli compare
```

---

## 🤖 День 22. Первый RAG-запрос и Двухрежимный Агент (С RAG / Без RAG)

На Дне 22 реализован полноценный RAG-пайплайн и интеллектуальный агент:
👉 **вопрос → поиск релевантных чанков (RRF + Asymmetric Embedding) → объединение с вопросом и системным промптом → запрос к LLM**.

### 🌟 Возможности агента
1. **Два режима работы**:
   - **`--no-rag` (Baseline Pretrained)**: Чистая генерация LLM без контекста кодовой базы (демонстрирует абстрактные предположения и галлюцинации относительно приватного кода).
   - **`--rag` (Grounded)**: Извлечение Top-K структурных чанков из FAISS, формирование контекстного промпта с обязательным цитированием исходных файлов и строк `[Source: path/to/file:Lstart-Lend]`.
2. **LLM Провайдер**:
   - [OpenRouter API](https://openrouter.ai/) с бесплатной моделью по умолчанию: `nvidia/nemotron-3-ultra-550b-a55b:free` (поддерживается переопределение на любую модель через `--model` или `OPENROUTER_MODEL`).
   - Автономный `--mock` режим для детерминированного тестирования и оффлайн-бенчмарка без расхода квот.
3. **10 Контрольных вопросов (Ground Truth Dataset)**:
   - Составлен мини-набор из 10 проверочных вопросов по кодовой базе Android-проекта CryptoTrack с зафиксированными ожиданиями и целевыми источниками.
4. **Автоматический расчет метрик качества**:
   - **Entity Coverage**: полнота совпадения ключевых классов, функций и архитектурных сущностей проекта.
   - **Source Recall**: точность нахождения целевых файлов в выдаче векторатора.
   - **Citation Compliance**: строгое следование требованию цитировать `[Source: ...]`.
   - **Latency & Tokens**: задержка генерации и профиль потребления токенов.

---

## 💻 Использование CLI

Все команды запускаются через модуль `src.cli` из папки `RAG/` (или с указанием `python -m src.cli`):

### 1. Одиночный запрос к агенту (`ask`)
Запрос с RAG (по умолчанию):
```bash
python -m src.cli ask "Как в объекте AssetAmountValidator устроена валидация ввода монет?" --rag
```
Запрос БЕЗ RAG (базовый ответ модели):
```bash
python -m src.cli ask "Как в объекте AssetAmountValidator устроена валидация ввода монет?" --no-rag
```
Опции:
- `--rag` / `--no-rag`: включение / выключение контекста кодовой базы;
- `--top-k`: количество извлекаемых чанков (по умолчанию 4);
- `--model`: идентификатор модели OpenRouter (например, `google/gemini-2.0-flash-exp:free`);
- `--api-key`: API ключ OpenRouter (или через переменную `OPENROUTER_API_KEY` в `.env`);
- `--mock`: оффлайн-режим с имитацией ответов.

### 2. Интерактивный диалог (`chat`)
```bash
python -m src.cli chat
```
Команды в чате:
- `/rag on` — включить обогащение контекстом;
- `/rag off` — выключить RAG (чистая модель);
- `/sources` — показать источники последнего ответа;
- `/model <name>` — сменить модель на лету;
- `/topk <k>` — изменить количество чанков в контексте;
- `/exit` или `q` — выход из чата.

### 3. Запуск бенчмарка по 10 контрольным вопросам (`eval`)
```bash
python -m src.cli eval
```
Команда прогоняет все 10 вопросов в обоих режимах (No-RAG vs With-RAG), выводит красивую таблицу в терминал и генерирует подробный Markdown-отчёт:
📄 [`RAG/data/rag_benchmark_report.md`](file:///c:/Users/W/Projects/AI%20Advent%20Challenge/RAG/data/rag_benchmark_report.md)

---

## 📈 Результаты бенчмарка (No-RAG vs With-RAG)

| Метрика | Без RAG (Pretrained) | С RAG (Grounded) | Разница / Эффект |
|---|:---:|:---:|:---:|
| **Entity Coverage** (упоминание классов проекта) | **13.3%** | **79.7%** | **+66.4%** |
| **Source Recall** (точность извлечения файлов) | — | **95.0%** | База знаний найдена |
| **Citation Compliance** (ссылки на файлы и строки) | 0.0% | **100.0%** | Полная проверяемость |
| **Средняя задержка ответа** | 0.00 с | 0.19 с | +0.19 с (поиск + контекст) |
| **Средний расход токенов** | 190 токенов | 670 токенов | Контекст чанков в промпте |

### Ключевые выводы
1. **Преодоление галлюцинаций**: Без RAG языковая модель не имеет информации о закрытом коде CryptoTrack и генерирует абстрактные типовые фрагменты. С RAG модель безошибочно указывает точные имена классов (`AssetAmountValidator`, `CryptoTrackDatabase`, `PortfolioCalculator`, `ApexBottomBar`), методы (`sanitize()`, `validate()`) и ссылки на архитектурные решения (ADR-017).
2. **Прослеживаемость (Auditability)**: В RAG-режиме 100% ответов снабжаются прямыми ссылками на исходный код вида `[Source: feature/assetentry/.../AssetAmountValidator.kt:L15-L35]`.
3. **Эффективность поиска**: Асимметричный префикс `search_query:` в связке с Reciprocal Rank Fusion (RRF) обеспечил **95.0% Source Recall** целевых модулей проекта.

---

# 🚀 День 23. Реранкинг, фильтрация и Query Rewrite

На этапе Дня 23 реализован двухэтапный RAG-пайплайн с оптимизацией запросов и очисткой контекста:

1. **Query Rewrite (переписывание запроса)**:
   - Класс `QueryRewriter` (`src/agent/query_rewriter.py`).
   - Преобразует пользовательский вопрос на естественном языке (русском/разговорном) в оптимизированный технический поисковый запрос (Kotlin классы, аннотации Room/Hilt, слои Clean Architecture, ключевые сигнатуры).
   - Поддерживает работу через OpenRouter LLM с автоматическим fallback на детерминированный эвристический экстрактор кодовых терминов при оффлайн-режиме или rate limit.

2. **Relevance Filter (фильтрация по порогу сходства)**:
   - Класс `RelevanceFilter` (`src/reranking/relevance_filter.py`).
   - Настраиваемый порог косинусного отсечения (`--threshold`, по умолчанию `0.45`–`0.50`).
   - Элиминирует нерелевантные фрагменты и информационный шум до подачи в контекст модели.
   - Механизм **Fall-soft**: предотвращает пустой контекст при жестких порогах, гарантированно сохраняя лучший кандидат.

3. **Cross-Encoder Reranker (реранкинг)**:
   - Класс `CrossEncoderReranker` (`src/reranking/cross_encoder_reranker.py`).
   - Нейросетевая модель `FlashRank` (`ms-marco-TinyBERT-L-2-v2`) с fallback на кросс-энкодер сопоставления токенов и сигнатур.
   - Оценивает пары `(query, chunk)` через механизм глубокого внимания и поднимает точные сигнатуры и реализации на первые места в контексте.

4. **Двухэтапный пайплайн (`TwoStageRetrievalPipeline`)**:
   - `Initial Top-K` (15 кандидатов) -> `RelevanceFilter` (отсечение шума) -> `CrossEncoderReranker` -> `Final Top-K` (4-5 чанков).

5. **Сравнение 3 режимов**:
   - **Baseline RAG** (без rewrite и реранкинга)
   - **RAG + Query Rewrite** (только оптимизация запроса)
   - **Enhanced RAG** (Query Rewrite + Similarity Filter + Cross-Encoder Rerank)
   - Автоматическая генерация отчета в `RAG/data/rerank_benchmark_report.md`.

### Команды CLI для Дня 23:

```bash
# 1. Запрос с переписыванием и реранкингом:
python -m src.cli ask "Как в CryptoTrack устроен Room?" --rewrite --rerank

# 2. Настройка порогов и количества кандидатов:
python -m src.cli ask "Где объявлен CryptoPriceDao?" --rewrite --rerank --initial-top-k 15 --threshold 0.50 --top-k 4

# 3. Интерактивный чат с командами переключения:
python -m src.cli chat
# Внутри чата: /rewrite on, /rerank on, /thresh 0.50, /sources, /help

# 4. Сравнение одного вопроса во всех 3 режимах:
python -m src.cli compare-rerank --query "Как устроен AssetAmountValidator?"

# 5. Запуск сравнительного бенчмарка по всем 10 вопросам и генерация отчета:
python -m src.cli compare-rerank --benchmark
```

---

# 🔥 День 24. Цитаты, источники и анти-галлюцинации

На этапе Дня 24 RAG-пайплайн CryptoTrack оснащен строгой системой фактологической привязки (Grounding), обязательного цитирования и двухуровневой защитой от галлюцинаций (Anti-Hallucination Guard).

## 1. Архитектура решения

### Обязательные компоненты ответа
Модель возвращает структурированный результат (`GroundedAnswer`), содержащий:
1. **👉 Ответ (`answer`)**: структурированный технический ответ на русском языке с сохранением оригинальных идентификаторов кода.
2. **👉 Список источников (`sources`)**: список объектов с полями `source` (путь к файлу), `section` (класс/функция), `chunk_id` / диапазон строк `start_line`–`end_line`, и скор релевантности.
3. **👉 Цитаты (`quotes`)**: массив дословных фрагментов кода и комментариев из найденных чанков (`is_exact_match`, `match_similarity`, `matched_chunk_id`).

### Усиление: Режим «Не знаю» (Двухуровневый Hybrid Guard)
1. **Level 1 (Детерминированный пре-LLM контроль)**:
   - Если после поиска и фильтрации список чанков пуст или наивысшая косинусная/реранк релевантность ниже порога (`grounded_relevance_threshold = 0.58`), пайплайн мгновенно возвращает статус отказа:
     * `status = "refusal"`
     * `needs_clarification = True`
     * `clarification_prompt` с вежливой просьбой уточнить запрос
     * **LLM не вызывается** — 0 токенов расхода, 0% вероятность галлюцинаций.
2. **Level 2 (Промпт со строгим JSON-контрактом)**:
   - Если контекст преодолел порог, системный промпт обязывает модель вернуть JSON со статусом `grounded` или `refusal`.
   - Если переданный контекст не содержит ответа на вопрос или вопрос выходит за рамки проекта, модель обязана выставить `"status": "refusal"`, вернуть пустые массивы цитат/источников и сформулировать уточняющий вопрос пользователю.

### Валидатор фактологической привязки (`GroundingValidator`)
- **Проверка источников (`has_sources`)**: подтверждение наличия релевантных файлов кодовой базы.
- **Подлинность цитат (`grounding_score`)**: алгоритмическая сверка каждой цитаты по содержимому чанков (точный и нормализованный поиск подстрок).
- **Семантическое соответствие (`faithfulness_score`)**: анализ совпадения технических утверждений, Kotlin-сущностей и кодовых символов в backticks между текстом ответа и цитатами.

---

## 2. Команды CLI для Дня 24

```bash
# 1. Запрос с подтвержденными источниками и цитатами (режим --grounded по умолчанию):
python -m src.cli ask "Как в объекте AssetAmountValidator устроена очистка и валидация ввода?"

# 2. Запрос на тему вне кодовой базы (проверка срабатывания режима «не знаю»):
python -m src.cli ask "Как в CryptoTrack настроить оплату через Apple Pay банковской картой?"

# 3. Настройка порога отсечения анти-галлюцинаций:
python -m src.cli ask "Как устроен RoomConventionPlugin?" --grounded-threshold 0.60

# 4. Запуск бенчмарка по 10 вопросам (7 целевых + 3 ловушки) с формированием отчёта:
python -m src.cli benchmark-grounded

# 5. Оффлайн/тестовый прогон без OpenRouter API ключа:
python -m src.cli benchmark-grounded --mock
```

---

## 3. Результаты бенчмарка по 10 вопросам

📄 **Полный Markdown-отчёт:** [`RAG/data/grounded_benchmark_report.md`](file:///c:/Users/W/Projects/AI%20Advent%20Challenge/RAG/data/grounded_benchmark_report.md)

| Метрика | Значение | Требование задачи | Статус |
| :--- | :---: | :---: | :---: |
| **Наличие источников в ответах** (In-Domain) | **100.0%** (7/7) | 100% | ✅ ВЫПОЛНЕНО |
| **Наличие цитат в ответах** (In-Domain) | **100.0%** (7/7) | 100% | ✅ ВЫПОЛНЕНО |
| **Подлинность цитат (Grounding)** | **100.0%** | > 80% | ✅ ВЫПОЛНЕНО |
| **Совпадение смысла с цитатами (Faithfulness)** | **78.3%** | > 70% | ✅ ВЫПОЛНЕНО |
| **Срабатывание режима «Не знаю»** (Adversarial) | **100.0%** (3/3) | 100% | ✅ ВЫПОЛНЕНО |
| **Общий результат бенчмарка** | **10 из 10 (100.0%)** | 10 вопросов | ✅ PASS |

### Сводная таблица по 10 вопросам:
1. **AssetAmountValidator (Domain Validation)**: `PASS` — источники `AssetAmountValidator.kt`, цитаты `sanitize()`, `AssetAmountValidation`, Faithfulness 91%.
2. **CryptoTrackDatabase (Data Persistence)**: `PASS` — источники `CryptoTrackDatabase.kt`, цитаты зарегистрированных DAO, Faithfulness 77%.
3. **PortfolioCalculator (Financial Logic)**: `PASS` — источники `PortfolioCalculator.kt`, цитаты формул `totalBalanceUsd` и `change24hPercent`, Faithfulness 95%.
4. **RoomConventionPlugin (Build Logic)**: `PASS` — источники `RoomConventionPlugin.kt`, цитаты KSP и schemaDirectory, Faithfulness 64%.
5. **ApexBottomBar (Presentation UI)**: `PASS` — источники `ApexBottomBar.kt`, цитаты Material3 NavigationBar и TopDestination, Faithfulness 57%.
6. **ObserveCoinDetailsUseCase (Reactive Domain)**: `PASS` — источники `ObserveCoinDetailsUseCase.kt`, цитаты `MarketRepository`, `combine`, `CoinDetailsSnapshot`, Faithfulness 94%.
7. **CryptoTrackApplication (App & DI)**: `PASS` — источники `CryptoTrackApplication.kt`, цитаты `@HiltAndroidApp`, Faithfulness 70%.
8. **Apple Pay / Google Pay (Ловушка 1)**: `PASS` — режим отказа («не знаю»), запрос уточнения по модулям CryptoTrack.
9. **ML-прогнозирование цен (Ловушка 2)**: `PASS` — режим отказа («не знаю»), защита от галлюцинаций.
10. **Solidity смарт-контракты (Ловушка 3)**: `PASS` — режим отказа («не знаю»), отсечение по порогу релевантности.

