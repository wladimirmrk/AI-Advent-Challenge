# MCP Server: Git Branch (CryptoTrack)

Локальный сервер по протоколу Model Context Protocol (MCP) для определения активной Git-ветки в репозитории CryptoTrack (`C:\Users\W\Projects\CryptoTrack`). Разработан для локального взаимодействия с веб-клиентом `AI Advent Challenge`.

## 🛠️ Доступные инструменты (Tools)

- **`get_current_git_branch`**:
  - **Описание**: Возвращает название текущей git ветки проекта в каталоге `C:\Users\W\Projects\CryptoTrack` (или по кастомному пути `projectPath`).
  - **Параметры**:
    - `projectPath` *(string, optional)*: Пользовательский путь к каталогу репозитория. По умолчанию используется `C:\Users\W\Projects\CryptoTrack`.
  - **Возвращаемые данные**:
    ```json
    {
      "success": true,
      "branch": "main",
      "projectPath": "C:\\Users\\W\\Projects\\CryptoTrack",
      "isDetached": false,
      "message": "Текущая активная ветка в проекте CryptoTrack: \"main\""
    }
    ```

---

## 🚀 Запуск сервера

### Из корневой папки проекта:
```powershell
npm.cmd run mcp:git-branch
```

### Из папки `MCP/git-branch`:
```powershell
npx.cmd tsx server.ts
```

По умолчанию сервер запускается на порту `3005`. Переопределить порт можно через переменную окружения `PORT` или `MCP_PORT`:
```powershell
$env:MCP_PORT=3006; npm.cmd run mcp:git-branch
```

---

## 📡 Эндпоинты сервера

- **SSE Stream (для веб-клиента)**: `http://localhost:3005/sse`
- **POST Messages (SSE)**: `http://localhost:3005/message`
- **Streamable HTTP**: `http://localhost:3005/mcp`
- **Healthcheck & Status**: `http://localhost:3005/health`

---

## 🌐 Подключение в веб-клиенте

1. Откройте веб-клиент (`npm.cmd run dev` -> `http://localhost:5173`).
2. Нажмите кнопку **MCP** на верхней панели.
3. Сервер `CryptoTrack Git Branch` уже преднастроен в списке серверов по адресу `http://localhost:3005/sse`.
4. Нажмите **Тест** для проверки соединения.
5. Задайте вопрос агенту в чате:
   > *"Какая сейчас текущая git ветка в проекте CryptoTrack?"*
   Агент автоматически вызовет инструмент `get_current_git_branch` и ответит.
