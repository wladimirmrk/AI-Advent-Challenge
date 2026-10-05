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

## 📊 Результаты сравнения стратегий

Подробный отчёт с примерами кода и сопоставлением скоринга доступен в:
📄 [`RAG/data/comparison_report.md`](file:///c:/Users/W/Projects/AI%20Advent%20Challenge/RAG/data/comparison_report.md)

**Ключевой вывод**:
Для RAG-систем по Android-проектам **Structural Chunking** обеспечивает критическое преимущество: целостность функций и классов, точные хлебные крошки и отсутствие разрыва синтаксических конструкций, что исключает потерю контекста языковой моделью.
