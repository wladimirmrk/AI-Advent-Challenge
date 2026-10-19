# CryptoTrack AI Code Review CLI (`code-review`)

Автоматизированный инструмент для проведения архитектурного и качественного код-ревью пулл-реквестов в проекте **CryptoTrack** (`C:\Users\W\Projects\CryptoTrack`).

Инструмент получает `diff` изменений через GitHub CLI (`gh`), извлекает релевантный контекст архитектуры и инвариантов проекта через **RAG** (Retrieval-Augmented Generation), передает его агенту с моделью **OpenRouter** (`nvidia/nemotron-3-ultra-550b-a55b:free`), выполняет анализ и формирует подробный отчет в формате Markdown.

---

## 🚀 Быстрый запуск

### 1. Из папки `code-review`
```powershell
# Запуск анализа PR #2 через Python
python main.py 2

# Или через bat-файл
.\code-review.bat 2

# Или через PowerShell скрипт
.\code-review.ps1 2
```

### 2. Из корня проекта
```powershell
python code-review/main.py 2
```

---

## 🛠️ Параметры командной строки

```text
usage: code-review [-h] [-o OUTPUT] [-d DIFF_FILE] [--repo REPO] [--model MODEL] [--no-rag] [--dry-run] pr_number

Automated AI Code Review CLI using RAG and OpenRouter LLM.

positional arguments:
  pr_number             Pull Request number to review (e.g. 2)

options:
  -h, --help            show this help message and exit
  -o OUTPUT, --output OUTPUT
                        Output path for the review Markdown file (default: review_pr_<number>.md)
  -d DIFF_FILE, --diff-file DIFF_FILE
                        Path where the git diff should be saved (default: diff_pr_<number>.diff)
  --repo REPO           Path to the target repository (default: C:\Users\W\Projects\CryptoTrack)
  --model MODEL         OpenRouter model to use (default: nvidia/nemotron-3-ultra-550b-a55b:free)
  --no-rag              Disable RAG knowledge base retrieval (baseline LLM review)
  --dry-run             Fetch diff and retrieve RAG context without generating review via LLM
```

---

## 📋 Структура генерируемого отчета

Каждое ревью сохраняется в Markdown-файл и включает 5 ключевых разделов:
1. **📋 Краткое резюме (Executive Summary)**: Цель изменений, затронутые файлы и границы модулей.
2. **🐛 Потенциальные баги и граничные случаи (Potential Bugs & Edge Cases)**: Анализ логики, null-safety, гонок, проблем кроссплатформенности и раннеров.
3. **🏛️ Архитектурный анализ и инварианты (Architecture & Invariants)**: Проверка соответствия Clean Architecture CryptoTrack, правилам зависимостей `:feature -> :core` и ADRs.
4. **💡 Рекомендации и примеры улучшений (Recommendations & Best Practices)**: Конкретные сниппеты и рекомендации по чистоте кода.
5. **⚖️ Вердикт и статус (Verdict)**: Итоговая оценка `[APPROVE]`, `[REQUEST_CHANGES]` или `[COMMENT]`.

---

## 📂 Создаваемые файлы

- `code-review/diff_pr_<number>.diff` — исходный git diff пулл-реквеста.
- `code-review/review_pr_<number>.md` — итоговый отчет код-ревью с метаданными генерации (токены, латентность, модель).
