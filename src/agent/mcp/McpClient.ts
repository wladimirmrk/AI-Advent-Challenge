import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServerConfig, McpToolInfo, McpConnectionResult } from './types';

/**
 * Creates an MCP client and transport configured for the given server.
 */
export function createMcpClientAndTransport(config: McpServerConfig) {
  const client = new Client(
    {
      name: 'ai-agent-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  const url = new URL(config.url);
  const cleanHeaders: Record<string, string> = {};

  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (k.trim() && v !== undefined && v !== null && String(v).trim()) {
        cleanHeaders[k.trim()] = String(v).trim();
      }
    }
  }

  let transport;
  if (config.transport === 'http') {
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: cleanHeaders,
      },
    });
  } else {
    // SSE transport
    transport = new SSEClientTransport(url, {
      eventSourceInit: {
        headers: cleanHeaders,
      } as any,
      requestInit: {
        headers: cleanHeaders,
      },
    });
  }

  return { client, transport };
}

/**
 * Connects to an MCP server, queries available tools, and cleanly disconnects.
 * Returns the list of tools and connection diagnostic information.
 */
export async function testMcpConnection(config: McpServerConfig): Promise<McpConnectionResult> {
  const startTime = Date.now();
  let clientInstance: Client | null = null;

  try {
    const { client, transport } = createMcpClientAndTransport(config);
    clientInstance = client;

    // Establish connection with timeout protection
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out after 10 seconds')), 10000)
    );

    await Promise.race([connectPromise, timeoutPromise]);

    // Query tools list
    const toolsResponse = await client.listTools();
    const latencyMs = Date.now() - startTime;

    const tools: McpToolInfo[] = (toolsResponse.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return {
      success: true,
      serverName: config.name,
      tools,
      latencyMs,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const rawError = error?.message || String(error) || 'Failed to connect to MCP server';
    let errorMessage = rawError;

    const isLocal = config.url.includes('localhost') || config.url.includes('127.0.0.1');

    if (rawError.includes('Failed to fetch') || rawError.includes('NetworkError') || rawError.includes('Load failed')) {
      if (isLocal) {
        errorMessage = `Локальный MCP-сервер недоступен (${config.url}). Убедитесь, что в терминале запущен 'npm run mcp:server'.`;
      } else {
        errorMessage = `Браузер заблокировал прямой запрос к ${config.url} из-за политики CORS (Cross-Origin). Внешний сервер не разрешает браузерные запросы с http://localhost:5173. Для таких серверов используйте консольную проверку: 'npm run test:mcp'.`;
      }
    } else if (rawError.includes('405')) {
      errorMessage = `Сервер вернул ошибку 405 (Method Not Allowed). Попробуйте сменить способ подключения на ${config.transport === 'sse' ? 'Streamable HTTP' : 'SSE'}.`;
    }

    return {
      success: false,
      serverName: config.name,
      tools: [],
      error: errorMessage,
      latencyMs,
    };
  } finally {
    if (clientInstance) {
      try {
        await clientInstance.close();
      } catch {
        // Ignore teardown errors
      }
    }
  }
}
