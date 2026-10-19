import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_RAG_SCRIPT = path.join(ROOT_DIR, 'RAG', 'src', 'mcp_query.py');
const DEFAULT_INDEX_DIR = path.join(ROOT_DIR, 'RAG', 'data', 'indices', 'structural');

export const DEFAULT_PORT = 3006;

export interface RagSearchResultItem {
  rank: number;
  score: number;
  chunk_id: string;
  source: string;
  title: string;
  section: string;
  start_line?: number;
  end_line?: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RagSearchResult {
  success: boolean;
  strategy: string;
  method?: string;
  query: string;
  count: number;
  results: RagSearchResultItem[];
  error?: string;
}

/**
 * Executes python structural RAG query script and parses JSON output.
 */
export async function searchStructuralRag(
  query: string,
  topK: number = 5,
  filterSource?: string,
  customIndexDir?: string
): Promise<RagSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('Параметр query не может быть пустым.');
  }

  const scriptPath = DEFAULT_RAG_SCRIPT;
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Скрипт RAG query не найден: "${scriptPath}"`);
  }

  const indexDir = customIndexDir ? path.resolve(customIndexDir) : DEFAULT_INDEX_DIR;
  if (!fs.existsSync(indexDir)) {
    throw new Error(`Каталог структурного индекса RAG не найден: "${indexDir}"`);
  }

  const args: string[] = [
    scriptPath,
    '--query',
    trimmedQuery,
    '--top-k',
    String(topK || 5),
    '--index-dir',
    indexDir,
  ];

  if (filterSource && filterSource.trim()) {
    args.push('--filter', filterSource.trim());
  }

  try {
    const { stdout, stderr } = await execFileAsync('python', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) {
      if (stderr.trim()) {
        throw new Error(stderr.trim());
      }
      throw new Error('Пустой ответ от RAG query скрипта.');
    }

    const parsed: RagSearchResult = JSON.parse(stdout.trim());
    return parsed;
  } catch (err: any) {
    throw new Error(`Ошибка при вызове RAG поиска: ${err.message || String(err)}`);
  }
}

export const AVAILABLE_TOOLS = [
  {
    name: 'rag_search_structural',
    description:
      'Поиск по кодовой базе и документации CryptoTrack через структурный RAG индекс (AST, классы, функции, Markdown). Возвращает релевантные чанки с файлами, секциями и строками кода.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Поисковый запрос о классах, функциях, базе данных или архитектуре CryptoTrack (например: "Room Database", "FavoriteDao", "кэширование котировок")',
        },
        top_k: {
          type: 'number',
          description: 'Количество извлекаемых структурных чанков (по умолчанию 5)',
        },
        filter_source: {
          type: 'string',
          description:
            'Фильтр по пути к файлу или расширению (например: "kt", "md", "docs", "data")',
        },
      },
      required: ['query'],
    },
  },
];

export function createRagMcpServer() {
  const server = new Server(
    {
      name: 'crypto-track-rag-server',
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

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'rag_search_structural') {
      try {
        const query = typeof args?.query === 'string' ? args.query : '';
        const topK = typeof args?.top_k === 'number' ? args.top_k : 5;
        const filterSource = typeof args?.filter_source === 'string' ? args.filter_source : undefined;

        const result = await searchStructuralRag(query, topK, filterSource);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Ошибка RAG поиска: ${err.message || String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    throw new Error(`Инструмент не найден: ${name}`);
  });

  return server;
}

export function startRagHttpServer(
  port: number = Number(process.env.MCP_PORT || process.env.PORT) || DEFAULT_PORT
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      // Dynamic CORS headers for browser web client compatibility
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

      // 1. SSE Connection establishment (GET /sse)
      if (req.method === 'GET' && url.pathname === '/sse') {
        const server = createRagMcpServer();
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };

        await server.connect(transport);
        return;
      }

      // 2. Client POST messages for SSE (/message)
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

      // 3. Streamable HTTP endpoint (/mcp or /)
      if (url.pathname === '/mcp' || (req.method === 'POST' && url.pathname === '/')) {
        const server = createRagMcpServer();
        const transport = new StreamableHTTPServerTransport();
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      // 4. Healthcheck & discovery info
      if (url.pathname === '/health' || url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify(
            {
              status: 'ok',
              server: 'crypto-track-rag-server',
              strategy: 'structural',
              indexDir: DEFAULT_INDEX_DIR,
              sseEndpoint: `http://${req.headers.host || `localhost:${port}`}/sse`,
              httpEndpoint: `http://${req.headers.host || `localhost:${port}`}/mcp`,
              tools: AVAILABLE_TOOLS.map((t) => t.name),
            },
            null,
            2
          )
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });

    httpServer.on('error', (err) => {
      reject(err);
    });

    httpServer.listen(port, () => {
      console.log(`\n📚 CryptoTrack RAG Structural MCP Server started on http://localhost:${port}`);
      console.log(`📡 Endpoints:`);
      console.log(`   - SSE Stream:       http://localhost:${port}/sse`);
      console.log(`   - Streamable HTTP:  http://localhost:${port}/mcp`);
      console.log(`   - Healthcheck:      http://localhost:${port}/health`);
      console.log(`🛠️ Tools provided: ${AVAILABLE_TOOLS.map((t) => t.name).join(', ')}`);
      console.log(`📂 Index directory: ${DEFAULT_INDEX_DIR}\n`);
      resolve(httpServer);
    });
  });
}

// Standalone execution if launched directly via CLI
const scriptPath = process.argv[1]?.replace(/\\/g, '/');
const isDirectExecution =
  scriptPath?.endsWith('/rag/server.ts') ||
  scriptPath?.endsWith('/rag/server.js');

if (isDirectExecution) {
  startRagHttpServer();
}
