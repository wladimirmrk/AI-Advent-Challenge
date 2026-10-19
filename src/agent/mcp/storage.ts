import { McpServerConfig } from './types';

const MCP_SERVERS_STORAGE_KEY = 'agent_mcp_servers';
const MCP_GLOBAL_ENABLED_KEY = 'agent_mcp_enabled_global';

export function getChatMcpEnabledKey(chatId: string): string {
  return `agent_${chatId}_mcp_enabled`;
}

export function getChatMcpServersKey(chatId: string): string {
  return `agent_${chatId}_mcp_servers`;
}

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp-catalog-server',
    name: 'Каталог и Склад',
    url: 'http://localhost:3001/sse',
    transport: 'sse',
    headers: {},
    headersRaw: '{\n  "Authorization": ""\n}',
    enabled: true,
    createdAt: 1700000000001,
    scope: 'global',
    tools: [
      { name: 'store_search_products', description: 'Поиск товаров в каталоге интернет-магазина (query, category, max_price)' },
      { name: 'store_get_product', description: 'Данные о товаре по SKU (цена, характеристики, склад, остаток)' },
      { name: 'calculate', description: 'Вычислить математическое выражение' },
      { name: 'get_system_time', description: 'Текущее время сервера' },
      { name: 'echo', description: 'Эхо-ответ' },
    ],
  },
  {
    id: 'mcp-logistics-server',
    name: 'Логистика и Заказы',
    url: 'http://localhost:3002/sse',
    transport: 'sse',
    headers: {},
    headersRaw: '{\n  "Authorization": ""\n}',
    enabled: true,
    createdAt: 1700000000002,
    scope: 'global',
    tools: [
      { name: 'order_get_status', description: 'Проверить статус и трекинг заказа' },
      { name: 'delivery_calculate_cost', description: 'Рассчитать стоимость и срок доставки курьером' },
      { name: 'schedule_monitor', description: 'Запланировать фоновый мониторинг' },
    ],
  },
  {
    id: 'mcp-analytics-server',
    name: 'Аналитика и Отчеты',
    url: 'http://localhost:3003/sse',
    transport: 'sse',
    headers: {},
    headersRaw: '{\n  "Authorization": ""\n}',
    enabled: true,
    createdAt: 1700000000003,
    scope: 'global',
    tools: [
      { name: 'search', description: 'Поиск информации в каталоге для аналитического пайплайна' },
      { name: 'summarize', description: 'Аналитическая выжимка, расчет метрик и рекомендаций (markdown/json)' },
      { name: 'saveToFile', description: 'Сохранение отчета на диск в каталог data/reports' },
      { name: 'get_aggregated_summary', description: 'Агрегированная сводка фонового мониторинга' },
    ],
  },
  {
    id: 'mcp-git-branch-server',
    name: 'CryptoTrack Git Branch',
    url: 'http://localhost:3005/sse',
    transport: 'sse',
    headers: {},
    headersRaw: '{\n  "Authorization": ""\n}',
    enabled: true,
    createdAt: 1700000000004,
    scope: 'global',
    tools: [
      {
        name: 'get_current_git_branch',
        description: 'Получить название текущей git ветки проекта CryptoTrack',
      },
    ],
  },
  {
    id: 'mcp-rag-server',
    name: 'CryptoTrack RAG (Structural)',
    url: 'http://localhost:3006/sse',
    transport: 'sse',
    headers: {},
    headersRaw: '{\n  "Authorization": ""\n}',
    enabled: true,
    createdAt: 1700000000005,
    scope: 'global',
    tools: [
      {
        name: 'rag_search_structural',
        description: 'Поиск по кодовой базе и документации CryptoTrack через структурный RAG индекс (AST, классы, функции, Markdown)',
      },
    ],
  },
];

export function loadGlobalMcpEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return true;
    }
    const raw = localStorage.getItem(MCP_GLOBAL_ENABLED_KEY);
    if (raw === null) {
      return true;
    }
    return raw !== 'false';
  } catch (e) {
    console.warn('Failed to load global MCP enabled state:', e);
    return true;
  }
}

export function saveGlobalMcpEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MCP_GLOBAL_ENABLED_KEY, String(enabled));
    }
  } catch (e) {
    console.warn('Failed to save global MCP enabled state:', e);
  }
}

export function loadChatMcpEnabled(chatId: string): boolean | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(getChatMcpEnabledKey(chatId));
    if (raw === null || raw === 'inherit') {
      return null;
    }
    return raw === 'true';
  } catch (e) {
    console.warn(`Failed to load chat ${chatId} MCP enabled state:`, e);
    return null;
  }
}

export function saveChatMcpEnabled(chatId: string, enabled: boolean | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const key = getChatMcpEnabledKey(chatId);
      if (enabled === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, String(enabled));
      }
    }
  } catch (e) {
    console.warn(`Failed to save chat ${chatId} MCP enabled state:`, e);
  }
}

export function loadChatMcpServers(chatId: string): McpServerConfig[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    const raw = localStorage.getItem(getChatMcpServersKey(chatId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => ({
        ...s,
        scope: 'chat' as const,
        chatId,
      }));
    }
    return [];
  } catch (e) {
    console.warn(`Failed to load chat ${chatId} MCP servers:`, e);
    return [];
  }
}

export function saveChatMcpServers(chatId: string, servers: McpServerConfig[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const formatted = servers.map((s) => ({
        ...s,
        scope: 'chat' as const,
        chatId,
      }));
      localStorage.setItem(getChatMcpServersKey(chatId), JSON.stringify(formatted));
    }
  } catch (e) {
    console.warn(`Failed to save chat ${chatId} MCP servers:`, e);
  }
}

export function deleteChatMcpStorage(chatId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(getChatMcpEnabledKey(chatId));
      localStorage.removeItem(getChatMcpServersKey(chatId));
    }
  } catch (e) {
    console.warn(`Failed to delete chat ${chatId} MCP storage:`, e);
  }
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    const raw = localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!raw) {
      const proc = (globalThis as any).process;
      const isNode = typeof proc !== 'undefined' && proc.versions && proc.versions.node;
      if (!isNode) {
        saveMcpServers(DEFAULT_MCP_SERVERS);
        return [...DEFAULT_MCP_SERVERS];
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s) => ({
        ...s,
        scope: 'global' as const,
      }));
    }
    return [];
  } catch (e) {
    console.warn('Failed to load MCP servers from localStorage:', e);
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const formatted = servers.map((s) => ({
        ...s,
        scope: 'global' as const,
      }));
      localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(formatted));
    }
  } catch (e) {
    console.warn('Failed to save MCP servers to localStorage:', e);
  }
}
