# Руководство для AI-агентов: AI Advent Challenge (Root Project)

Данный документ предназначен для AI-ассистентов и разработчиков, работающих с кодовой базой проекта **AI Advent Challenge**. Здесь зафиксированы архитектурные принципы, структура репозитория, инварианты состояния, правила разработки и команды запуска.

---

## 1. Обзор проекта

**Educational AI Agent Chat** — учебное веб-приложение (ChatGPT-подобный интерфейс) с архитектурой автономного **AI Agent**, демонстрирующее:
- Низкоуровневое управление контекстом языковой модели (Context Window Management: Sliding Window, Auto-trim, Demo Overflow).
- Локальную персистентность (LocalStorage) без внешнего бэкенда.
- Многослойную модель памяти (Short-Term, Working Memory, Long-Term Memory, Sticky Facts, Summarization).
- Конечный автомат жизненного цикла задачи (Task State Machine / FSM) с контролем инвариантов.
- Интеграцию с протоколом Model Context Protocol (MCP) для вызова внешних инструментов.
- Поддержку двух провайдеров моделей: облачного **OpenRouter** и локального **Ollama** со стримингом и динамическим определением контекстного окна.

Стек технологий: **React 18**, **TypeScript 5**, **Vite 6**, **TSX**, **@modelcontextprotocol/sdk**, **Lucide React**.

---

## 2. Структура репозитория

```text
AI Advent Challenge/
├── agents.md                  # Текущее руководство для AI-агентов корневого проекта
├── README.md                  # Основная документация и пошаговые руководства
├── package.json               # Зависимости и npm-скрипты
├── tsconfig.json              # Конфигурация TypeScript
├── vite.config.ts             # Конфигурация Vite dev-сервера и сборщика
├── index.html                 # Точка входа HTML
│
├── src/                       # Исходный код веб-приложения
│   ├── agent/                 # Ядро агента (Чистый TypeScript, НЕ зависит от React)
│   │   ├── Agent.ts           # Класс Agent: оркестрация контекста, вызов LLM, стриминг, память
│   │   ├── ChatManager.ts     # Менеджер сессий: изоляция чатов, переключение активного агента
│   │   ├── ollama.ts          # Интеграция с Ollama (discovery моделей, context_length, чат)
│   │   ├── storage.ts         # Доступ к localStorage: ключи, миграции, сериализация
│   │   ├── tokenizer.ts       # Оценка токенов (BPE-эвристика для латиницы/кириллицы) и расчет цены
│   │   ├── transitions.ts     # FSM задачи, правила валидации переходов и инварианты
│   │   ├── types.ts           # Интерфейсы сообщений, конфигурации, памяти и состояний
│   │   └── mcp/               # Подсистема Model Context Protocol
│   │       ├── McpClient.ts   # Клиент MCP (JSON-RPC 2.0 / SSE транспорт)
│   │       ├── McpRouter.ts   # Маршрутизация вызовов инструментов между серверами
│   │       ├── storage.ts     # Хранилище настроек MCP серверов
│   │       └── types.ts       # Интерфейсы MCP тулов и ответов
│   │
│   ├── components/            # React UI компоненты (Презентационный слой)
│   │   ├── App.tsx            # Корневой контейнер с боковой панелью
│   │   ├── Chat.tsx           # Основное окно активного диалога
│   │   ├── MessageList.tsx    # Список сообщений (User, Assistant, Tool Calls, Reasoning/Thinking)
│   │   ├── MessageInput.tsx   # Поле ввода (Enter — отправка, Shift+Enter — перенос строки)
│   │   ├── MemoryHub.tsx      # Модальное окно управления многоуровневой памятью и инвариантами
│   │   ├── TaskStatusBar.tsx  # Верхняя панель FSM: текущий этап задачи и переходы
│   │   ├── McpModal.tsx       # Панель подключения и статуса MCP серверов
│   │   ├── ModelParamsModal.tsx# Настройка температуры, top_p и лимитов токенов
│   │   ├── TokenStats.tsx     # Индикатор расхода токенов и шкала context window
│   │   ├── Settings.tsx       # Настройки API-ключей, провайдера, кастомных моделей
│   │   └── Sidebar.tsx        # Список чатов (создание, переименование, удаление)
│   ├── main.tsx               # Монтирование React DOM
│   ├── theme.ts               # Цветовые константы
│   └── styles.css             # Стили оформления (ChatGPT dark theme)
│
├── scripts/                   # Серверные скрипты и MCP-инструменты (Node.js / tsx)
│   ├── mcp-server.ts          # Одиночный MCP сервер с базовыми инструментами
│   ├── mcp-multi-server.ts    # Мульти-серверная экосистема инструментов
│   ├── scheduler-service.ts   # Фоновый планировщик задач 24/7
│   ├── pipeline-service.ts    # Сервис конвейерной обработки
│   └── mock-store.ts          # Моковые данные для тестирования инструментов
│
├── tests/                     # Автоматизированные тесты на TSX
│   ├── test-agent.ts          # Тесты ядра агента, токенизатора, стриминга, стратегий контекста
│   ├── test-memory.ts         # Тесты изоляции Working Memory и глобальности Long-Term Memory
│   ├── test-multichat.ts      # Тесты переключения и сохранения нескольких сессий
│   ├── test-fsm.ts            # Тесты конечного автомата задачи (FSM)
│   ├── test-invariants.ts     # Тесты архитектурных инвариантов
│   ├── test-day15-transitions.ts # Тесты контролируемых переходов состояний
│   ├── test-mcp.ts            # Базовые тесты MCP клиента
│   ├── test-day17-mcp-tool.ts # Тесты регистрации и вызова MCP-инструментов
│   ├── test-day18-scheduler.ts# Тесты планировщика задач
│   ├── test-day19-pipeline.ts # Тесты MCP пайплайнов
│   ├── test-day20-orchestration.ts # Тесты мульти-агентной оркестрации
│   ├── test-streaming.ts      # Тесты потоковой передачи ответов и блока thinking
│   ├── test-undo.ts           # Тесты отката сообщений и ветвления
│   ├── test-mcp-files.ts      # Тесты MCP сервера файлов CryptoTrack (День 34)
│   └── test-day34-file-assistant.ts # Сквозные тесты автономного ассистента файлов
│
├── MCP/                       # Локальные MCP-серверы для проекта CryptoTrack
│   ├── files/                 # MCP Files сервер: чтение, поиск, запись, diff (День 34)
│   ├── git-branch/            # MCP сервер детекции активной git-ветки
│   └── rag/                   # MCP сервер структурного RAG поиска
│
├── RAG/                       # Автономный Python-подпроект RAG для CryptoTrack (см. RAG/agents.md)
└── week1/                     # Прототипы первой недели (архив)
```

---

## 3. Архитектурные принципы и инварианты

### 3.1. Разделение ответственности (Separation of Concerns)
- **UI не обращается к API напрямую**: Компоненты React (`Chat.tsx`, `Settings.tsx` и др.) **никогда** не вызывают `fetch` к OpenRouter или Ollama. Все операции с моделями, управление историей и контекстом строго инкапсулированы в `Agent.ts`.
- **Подписка на состояние**: Поток данных однонаправленный:
  ```text
  User Input -> Agent.sendMessage() -> State Mutation -> notifyListeners() -> React State -> UI Render
  ```

### 3.2. Многоуровневая модель памяти (Memory Hierarchy)
1. **Short-Term Memory**:
   - Скользящее окно последних $N$ сообщений (`recentMessagesCount`, по умолчанию 10).
2. **Working Memory (Рабочая память)**:
   - Привязана к конкретному чату и **строго изолирована** между разными диалогами (`chatId`).
   - Содержит: `goal` (цель задачи), `plan` (список шагов `PlanItem[]` со статусом `done`), `scratchpad` (черновик), `taskState` (FSM состояние).
3. **Long-Term Memory (Долговременная память)**:
   - Глобальная память пользователя, разделяемая между всеми чатами.
   - Содержит: `profile` (`UserProfile`), `decisions` (`DecisionItem[]`), `knowledge` (`KnowledgeItem[]`).
4. **Architectural Invariants & Guardrails**:
   - Строгие правила (категории: `architecture`, `stack`, `technical_decision`, `business_rule`).
   - Всегда инжектируются в системный контекст LLM перед генерацией ответа.
5. **Summarization (Сжатие истории)**:
   - Сообщения старше окна $N$ инкрементально суммаризируются в `ConversationSummary` при превышении порога `summaryThreshold`.

### 3.3. Конечный автомат задачи (Task FSM)
- Этапы жизненного цикла задачи (`TaskStage`):
  ```text
  idle -> planning -> plan_approved -> execution -> validation -> done
  ```
- Любой переход валидируется функцией `validateTransition(current, next)` в `src/agent/transitions.ts`. Недопустимые скачки блокируются.
- Доступна пауза (`isPaused`) с сохранением промежуточного состояния.

### 3.4. Режимы управления контекстом
- **Demo Overflow Mode**: история не урезается. При превышении `contextWindow` модели выбрасывается наглядная ошибка для обучения пользователя (`Context limit exceeded...`).
- **Production Mode**: скользящее окно автоматически обрезает старые сообщения, сохраняя `systemPrompt` и инжектируя уведомление `Context was trimmed...`.

---

## 4. Команды разработки и окружение

> [!IMPORTANT]
> **Специфика Windows PowerShell**:
> Из-за политики `ExecutionPolicy` запуск скриптов `.ps1` может блокироваться. Для выполнения команд Node.js и TypeScript **всегда используйте `npm.cmd` или `npx.cmd`**.

### Основные команды
```powershell
# Установка зависимостей
npm.cmd install

# Запуск приложения в режиме разработки (порт 5173)
npm.cmd run dev

# Проверка типов и сборка production-бандла
npm.cmd run build

# Предпросмотр собранного бандла
npm.cmd run preview
```

### Запуск тестов
```powershell
# Запуск полного набора тестов
npm.cmd test

# Запуск отдельных тестовых файлов через npx.cmd tsx:
npx.cmd tsx tests/test-agent.ts
npx.cmd tsx tests/test-memory.ts
npx.cmd tsx tests/test-fsm.ts
npx.cmd tsx tests/test-mcp.ts
npx.cmd tsx tests/test-streaming.ts
```

### Фоновые сервисы и MCP
```powershell
# Запуск MCP сервера
npm.cmd run mcp:server

# Запуск мульти-сервера инструментов
npm.cmd run mcp:servers

# Запуск MCP сервера файлов CryptoTrack (День 34)
npm.cmd run mcp:files

# Запуск MCP сервера git-ветки и RAG
npm.cmd run mcp:git-branch
npm.cmd run mcp:rag
```

---

## 5. Правила внесения изменений для AI-агентов

1. **Строгая типизация**: Все новые сущности и параметры должны быть типизированы в `src/agent/types.ts`. Не используйте тип `any`.
2. **Неизменяемость состояния (Immutability)**:
   - В `Agent.ts` при изменении полей состояния всегда создавайте новый объект состояния перед вызовом `notifyListeners()`.
   - В React-компонентах обновляйте хуки через колбэк-функции: `setState(prev => ({ ...prev, ... }))`.
3. **Сохранение целостности документации**: Не удаляйте существующие комментарии, JSDoc и пояснения в коде.
4. **Безопасность API-ключей**: Ключи OpenRouter сохраняются только в `localStorage` браузера или читаются из переменной окружения `VITE_OPENROUTER_API_KEY`. Запрещается хардкодить секреты в коде.
5. **Изоляция подпроекта RAG**: Директория `RAG/` является независимым Python-проектом со своими правилами и окружением (см. [RAG/agents.md](file:///C:/Users/W/Projects/AI%20Advent%20Challenge/RAG/agents.md)). Не смешивайте зависимости npm и pip.
