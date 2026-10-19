import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_PROJECT_PATH = 'C:\\Users\\W\\Projects\\CryptoTrack';
export const DEFAULT_PORT = 3005;

export interface GitBranchResult {
  success: boolean;
  branch: string;
  projectPath: string;
  isDetached: boolean;
  commitHash?: string;
  message?: string;
}

/**
 * Retrieves the current git branch name of the specified directory.
 */
export async function getCurrentGitBranch(
  customPath?: string
): Promise<GitBranchResult> {
  const targetPath = customPath ? path.resolve(customPath) : DEFAULT_PROJECT_PATH;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Указанный каталог не существует: "${targetPath}"`);
  }

  const gitDir = path.join(targetPath, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Каталог не является git-репозиторием (отсутствует .git): "${targetPath}"`);
  }

  try {
    // 1. Try to get active branch name
    const { stdout: branchStdout } = await execFileAsync(
      'git',
      ['-C', targetPath, 'branch', '--show-current'],
      { encoding: 'utf8', windowsHide: true }
    );

    const branchName = branchStdout.trim();

    if (branchName) {
      return {
        success: true,
        branch: branchName,
        projectPath: targetPath,
        isDetached: false,
        message: `Текущая активная ветка в проекте CryptoTrack: "${branchName}"`,
      };
    }

    // 2. Fallback for detached HEAD state: get short commit hash
    const { stdout: commitStdout } = await execFileAsync(
      'git',
      ['-C', targetPath, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', windowsHide: true }
    );
    const shortHash = commitStdout.trim();

    return {
      success: true,
      branch: `HEAD (detached at ${shortHash})`,
      projectPath: targetPath,
      isDetached: true,
      commitHash: shortHash,
      message: `Репозиторий находится в состоянии detached HEAD на коммите ${shortHash}`,
    };
  } catch (err: any) {
    throw new Error(`Ошибка при вызове git CLI в "${targetPath}": ${err.message || String(err)}`);
  }
}

export const AVAILABLE_TOOLS = [
  {
    name: 'get_current_git_branch',
    description:
      'Возвращает название текущей git ветки проекта в каталоге C:\\Users\\W\\Projects\\CryptoTrack (или переданном пути).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description:
            'Путь к каталогу проекта. По умолчанию: "C:\\Users\\W\\Projects\\CryptoTrack"',
        },
      },
    },
  },
];

export function createGitBranchMcpServer() {
  const server = new Server(
    {
      name: 'crypto-track-git-branch-server',
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

    if (name === 'get_current_git_branch') {
      try {
        const customPath =
          args?.projectPath && typeof args.projectPath === 'string'
            ? args.projectPath.trim()
            : undefined;

        const result = await getCurrentGitBranch(customPath);

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
              text: `Ошибка получения git-ветки: ${err.message || String(err)}`,
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

export function startGitBranchHttpServer(
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
        const server = createGitBranchMcpServer();
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
        const server = createGitBranchMcpServer();
        const transport = new StreamableHTTPServerTransport();
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      // 4. Healthcheck & discovery info
      if (url.pathname === '/health' || url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'ok',
            server: 'crypto-track-git-branch-server',
            defaultProjectPath: DEFAULT_PROJECT_PATH,
            sseEndpoint: `http://${req.headers.host || `localhost:${port}`}/sse`,
            httpEndpoint: `http://${req.headers.host || `localhost:${port}`}/mcp`,
            tools: AVAILABLE_TOOLS.map((t) => t.name),
          }, null, 2)
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
      console.log(`\n🌿 CryptoTrack Git Branch MCP Server started on http://localhost:${port}`);
      console.log(`📡 Endpoints:`);
      console.log(`   - SSE Stream:       http://localhost:${port}/sse`);
      console.log(`   - Streamable HTTP:  http://localhost:${port}/mcp`);
      console.log(`   - Healthcheck:      http://localhost:${port}/health`);
      console.log(`🛠️ Tools provided: ${AVAILABLE_TOOLS.map((t) => t.name).join(', ')}`);
      console.log(`📂 Target repository: ${DEFAULT_PROJECT_PATH}\n`);
      resolve(httpServer);
    });
  });
}

// Standalone execution if launched directly via CLI
const scriptPath = process.argv[1]?.replace(/\\/g, '/');
const isDirectExecution =
  scriptPath?.endsWith('/git-branch/server.ts') ||
  scriptPath?.endsWith('/git-branch/server.js');

if (isDirectExecution) {
  startGitBranchHttpServer();
}
