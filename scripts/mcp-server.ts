import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.MCP_PORT) || 3001;

// Define tools available on this server
const AVAILABLE_TOOLS = [
  {
    name: 'calculate',
    description: 'Вычислить простое математическое выражение (например: 2 + 2, 10 * 5, 100 / 4)',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Математическое выражение для вычисления',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_system_time',
    description: 'Получить текущее время сервера и часовой пояс',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['iso', 'locale', 'timestamp'],
          description: 'Формат вывода времени',
        },
      },
    },
  },
  {
    name: 'echo',
    description: 'Вернуть переданное сообщение обратно (эхо-тест)',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Текст для эхо-ответа',
        },
      },
      required: ['message'],
    },
  },
];

export function createLocalMcpServer() {
  const server = new Server(
    {
      name: 'advent-local-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: AVAILABLE_TOOLS,
    };
  });

  // Handle call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'calculate') {
      const expr = String(args?.expression || '');
      // Only allow basic math characters for safety
      if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
        return {
          content: [{ type: 'text', text: 'Ошибка: недопустимые символы в выражении' }],
          isError: true,
        };
      }
      try {
        // Safe evaluation of simple arithmetic
        const result = Function(`"use strict"; return (${expr})`)();
        return {
          content: [{ type: 'text', text: String(result) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка вычисления: ${err.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'get_system_time') {
      const format = args?.format || 'iso';
      const now = new Date();
      let text = now.toISOString();
      if (format === 'locale') text = now.toLocaleString();
      if (format === 'timestamp') text = String(now.getTime());

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              time: text,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          },
        ],
      };
    }

    if (name === 'echo') {
      return {
        content: [
          {
            type: 'text',
            text: `Echo: ${args?.message ?? ''}`,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  return server;
}

export function startMcpHttpServer(port = PORT): Promise<http.Server> {
  return new Promise((resolve) => {
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      // Dynamic CORS headers allowing all browser origins, methods, and requested headers
      const reqHeaders = req.headers['access-control-request-headers'];
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
      res.setHeader(
        'Access-Control-Allow-Headers',
        reqHeaders || 'Content-Type, Authorization, mcp-protocol-version, x-session-id, *'
      );
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, mcp-protocol-version, *');
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // SSE connection establishment (GET /sse)
      if (req.method === 'GET' && url.pathname === '/sse') {
        const server = createLocalMcpServer();
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };

        await server.connect(transport);
        return;
      }

      // Client POST messages for SSE (/message)
      if (req.method === 'POST' && url.pathname === '/message') {
        const sessionId = url.searchParams.get('sessionId');
        const transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found or expired' }));
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      // Streamable HTTP endpoint (/mcp or /)
      if (url.pathname === '/mcp' || (req.method === 'POST' && url.pathname === '/')) {
        const server = createLocalMcpServer();
        const transport = new StreamableHTTPServerTransport();
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            server: 'advent-local-mcp-server',
            sseEndpoint: `http://${req.headers.host || `localhost:${port}`}/sse`,
            httpEndpoint: `http://${req.headers.host || `localhost:${port}`}/mcp`,
            toolsCount: AVAILABLE_TOOLS.length,
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    httpServer.listen(port, () => {
      console.log(`\n🚀 Local MCP Server started on http://localhost:${port}`);
      console.log(`📡 Endpoints:`);
      console.log(`   - SSE Stream:       http://localhost:${port}/sse`);
      console.log(`   - Streamable HTTP:  http://localhost:${port}/mcp`);
      console.log(`   - Healthcheck:      http://localhost:${port}/health`);
      console.log(`🛠️ Tools provided: ${AVAILABLE_TOOLS.map((t) => t.name).join(', ')}\n`);
      resolve(httpServer);
    });
  });
}

// Standalone execution
if (process.argv[1]?.endsWith('mcp-server.ts') || process.argv[1]?.endsWith('mcp-server.js')) {
  startMcpHttpServer(PORT);
}
