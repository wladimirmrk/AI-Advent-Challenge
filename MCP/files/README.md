# MCP File Assistant Server (CryptoTrack)

Локальный MCP-сервер для автономных файловых операций в репозитории CryptoTrack (`C:\Users\W\Projects\CryptoTrack`).

## Возможности и инструменты

1. **`list_project_files`**: рекурсивный листинг файлов с фильтрацией сборочных артефактов (`.git`, `.gradle`, `build`, кэши).
2. **`read_project_file`**: безопасное чтение файлов целиком или по диапазону строк с нумерацией строк.
3. **`search_project_files`**: мультифайловый поиск классов, интерфейсов, функций, символов и текста по файлам Kotlin, Gradle, Markdown, XML.
4. **`write_project_file`**: создание новых файлов (например, ADR, отчёты, документация) с автоматическим созданием директорий.
5. **`patch_project_file`**: точечное обновление существующих файлов без риска повреждения остального содержимого.
6. **`get_file_diff`**: получение unified git diff для наглядного отображения сделанных изменений.

## Запуск

```bash
# Запуск MCP сервера файлов на порту 3007
npm.cmd run mcp:files
```

## Эндпоинты

- SSE: `http://localhost:3007/sse`
- HTTP: `http://localhost:3007/mcp`
- Health: `http://localhost:3007/health`
