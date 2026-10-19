# MCP Server: Structural RAG (CryptoTrack)

Локальный сервер по протоколу Model Context Protocol (MCP) для семантического и структурного поиска по кодовой базе и документации Android-приложения CryptoTrack (`C:\Users\W\Projects\CryptoTrack`). Использует синтаксический структурный индекс (AST классов/функций Kotlin и секций Markdown) из подпроекта `RAG/`.

---

## 🛠️ Доступные инструменты (Tools)

- **`rag_search_structural`**:
  - **Описание**: Поиск по кодовой базе и документации CryptoTrack через структурный RAG индекс.
  - **Параметры**:
    - `query` *(string, required)*: Текст поискового запроса или вопрос (например, *"Room Database"*, *"кэширование котировок"*, *"FavoriteDao"*).
    - `top_k` *(number, optional)*: Количество возвращаемых чанков (по умолчанию `5`).
    - `filter_source` *(string, optional)*: Фильтр по пути к файлу или расширению (например, `"kt"`, `"md"`, `"docs"`).
  - **Возвращаемые данные**:
    ```json
    {
      "success": true,
      "strategy": "structural",
      "method": "faiss_vector",
      "query": "Room Database",
      "count": 2,
      "results": [
        {
          "rank": 1,
          "score": 0.631,
          "source": "docs/data-layer.md",
          "title": "data-layer.md",
          "section": "2. Схема базы данных Room",
          "start_line": 32,
          "end_line": 35,
          "content": "## 2. Схема базы данных Room..."
        }
      ]
    }
    ```

---

## 🚀 Запуск сервера

### Из корневой папки проекта:
```powershell
npm.cmd run mcp:rag
```

### Из папки `MCP/rag`:
```powershell
npx.cmd tsx server.ts
```

По умолчанию сервер запускается на порту `3006`. Переопределить порт можно через переменную окружения `PORT` или `MCP_PORT`:
```powershell
$env:MCP_PORT=3007; npm.cmd run mcp:rag
```

---

## 📡 Эндпоинты сервера

- **SSE Stream (для веб-клиента)**: `http://localhost:3006/sse`
- **POST Messages (SSE)**: `http://localhost:3006/message`
- **Streamable HTTP**: `http://localhost:3006/mcp`
- **Healthcheck & Status**: `http://localhost:3006/health`
