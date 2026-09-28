import { McpServerConfig } from './types';

const MCP_SERVERS_STORAGE_KEY = 'agent_mcp_servers';

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
  },
];

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
      return parsed;
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
      localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(servers));
    }
  } catch (e) {
    console.warn('Failed to save MCP servers to localStorage:', e);
  }
}
