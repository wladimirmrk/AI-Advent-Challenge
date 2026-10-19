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

export const DEFAULT_PROJECT_PATH =
  process.env.CRYPTOTRACK_PATH ||
  process.env.PROJECT_PATH ||
  'C:\\Users\\W\\Projects\\CryptoTrack';

export const DEFAULT_PORT =
  Number(process.env.MCP_FILES_PORT || process.env.MCP_PORT) || 3007;

const IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.kotlin',
  '.zcode',
  '.idea',
  'build',
  'node_modules',
  'dist',
  'out',
  'target',
]);

const DEFAULT_SEARCH_EXTENSIONS = [
  '.kt',
  '.kts',
  '.md',
  '.xml',
  '.properties',
  '.json',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
];

/**
 * Resolves and strictly validates that userPath stays inside projectRoot.
 * Prevents directory traversal attacks (e.g. "../../../Windows").
 */
export function resolveSafePath(projectRoot: string, userPath: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, userPath || '.');
  const rel = path.relative(root, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Access denied: requested path "${userPath}" is outside allowed project root "${root}"`
    );
  }

  return resolved;
}

/**
 * Recursively scans files in directory, skipping build & VCS artifacts.
 */
export function scanDirectoryFiles(
  dir: string,
  projectRoot: string,
  maxFiles = 500
): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    if (results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        results.push(relPath);
      }
    }
  }

  walk(dir);
  return results;
}

export const AVAILABLE_TOOLS = [
  {
    name: 'list_project_files',
    description:
      'Получить список файлов проекта в каталоге CryptoTrack (или заданной поддиректории), исключая служебные файлы (.git, build, .gradle).',
    inputSchema: {
      type: 'object',
      properties: {
        subpath: {
          type: 'string',
          description:
            'Относительный путь к подпапке проекта (например: "docs", "core", "feature"). По умолчанию корень проекта.',
        },
        pattern: {
          type: 'string',
          description:
            'Опциональная подстрока или расширение для фильтрации (например: ".md", ".kt", "ADR-")',
        },
        limit: {
          type: 'number',
          description: 'Максимальное количество файлов в ответе (по умолчанию 100).',
        },
      },
    },
  },
  {
    name: 'read_project_file',
    description:
      'Прочитать содержимое текстового файла проекта CryptoTrack с возможностью указания диапазона строк.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Относительный или абсолютный путь к файлу проекта (например: "docs/architecture.md", "core/network/build.gradle.kts").',
        },
        startLine: {
          type: 'number',
          description: 'Начальная строка для чтения (1-indexed).',
        },
        endLine: {
          type: 'number',
          description: 'Конечная строка для чтения включительно (1-indexed).',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'search_project_files',
    description:
      'Выполнить поиск ключевого слова, имени функции, класса или шаблона по файлам проекта CryptoTrack. Возвращает пути к файлам, номера строк и найденные фрагменты.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Строка поиска (например: "SafeApiCall", "CoinGeckoRemoteDataSource", "RoomDatabase", "ADR-001").',
        },
        fileExtensions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Список расширений для фильтрации (например: [".kt", ".kts", ".md"]). По умолчанию все поддерживаемые текстовые файлы.',
        },
        subpath: {
          type: 'string',
          description: 'Ограничить поиск подпапкой (например: "core", "feature", "docs").',
        },
        maxResults: {
          type: 'number',
          description: 'Максимальное количество совпадений (по умолчанию 40).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_project_file',
    description:
      'Создать новый файл или перезаписать существующий файл в проекте CryptoTrack (например, новый ADR в docs/decisions, обновленный README или CHANGELOG).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Относительный путь к файлу для создания/записи (например: "docs/decisions/ADR-019-background-sync.md").',
        },
        content: {
          type: 'string',
          description: 'Полное текстовое содержимое файла.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Разрешить перезапись файла, если он уже существует (по умолчанию true).',
        },
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'patch_project_file',
    description:
      'Точечно заменить существующий фрагмент текста в файле проекта CryptoTrack (удобно для добавления секций в документацию или изменения фрагментов кода без полной перезаписи).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Относительный путь к файлу проекта.',
        },
        targetContent: {
          type: 'string',
          description: 'Точный фрагмент существующего текста, который нужно заменить.',
        },
        replacementContent: {
          type: 'string',
          description: 'Новый фрагмент текста для вставки.',
        },
      },
      required: ['filePath', 'targetContent', 'replacementContent'],
    },
  },
  {
    name: 'get_file_diff',
    description:
      'Получить unified diff сделанных изменений в проекте CryptoTrack через Git (показывает добавленные "+" и удаленные "-" строки для одного файла или всего репозитория).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Опциональный путь к конкретному файлу. Если не указан, возвращается diff по всем измененным файлам проекта.',
        },
        staged: {
          type: 'boolean',
          description: 'Показать индексированные (staged / cached) изменения (по умолчанию false).',
        },
      },
    },
  },
];

export function createFilesMcpServer(projectRoot: string = DEFAULT_PROJECT_PATH) {
  const server = new Server(
    {
      name: 'crypto-track-files-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AVAILABLE_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. list_project_files
    if (name === 'list_project_files') {
      try {
        const subpath = args?.subpath ? String(args.subpath).trim() : '';
        const pattern = args?.pattern ? String(args.pattern).trim().toLowerCase() : '';
        const limit = typeof args?.limit === 'number' && args.limit > 0 ? args.limit : 100;

        const targetDir = resolveSafePath(projectRoot, subpath);
        if (!fs.existsSync(targetDir)) {
          return {
            content: [{ type: 'text', text: `Каталог не найден: "${subpath || '.'}"` }],
            isError: true,
          };
        }

        let files = scanDirectoryFiles(targetDir, projectRoot, 500);

        if (pattern) {
          files = files.filter((f) => f.toLowerCase().includes(pattern));
        }

        const totalFound = files.length;
        const sliced = files.slice(0, limit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  subpath: subpath || '.',
                  totalFiles: totalFound,
                  returnedFiles: sliced.length,
                  files: sliced,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка листинга файлов: ${err.message}` }],
          isError: true,
        };
      }
    }

    // 2. read_project_file
    if (name === 'read_project_file') {
      try {
        const rawFilePath = String(args?.filePath || args?.path || args?.file || '').trim();
        if (!rawFilePath) {
          return {
            content: [{ type: 'text', text: 'Ошибка: параметр "filePath" обязателен.' }],
            isError: true,
          };
        }

        const fullPath = resolveSafePath(projectRoot, rawFilePath);
        if (!fs.existsSync(fullPath)) {
          return {
            content: [{ type: 'text', text: `Файл не найден: "${rawFilePath}"` }],
            isError: true,
          };
        }

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return {
            content: [{ type: 'text', text: `Указанный путь является каталогом, а не файлом: "${rawFilePath}"` }],
            isError: true,
          };
        }

        const rawContent = fs.readFileSync(fullPath, 'utf8');
        const lines = rawContent.split(/\r?\n/);
        const totalLines = lines.length;

        const startLine =
          typeof args?.startLine === 'number' && args.startLine > 0
            ? Math.min(args.startLine, totalLines)
            : 1;
        const endLine =
          typeof args?.endLine === 'number' && args.endLine >= startLine
            ? Math.min(args.endLine, totalLines)
            : totalLines;

        const selectedLines = lines.slice(startLine - 1, endLine);
        const numberedContent = selectedLines
          .map((line, idx) => `${startLine + idx}: ${line}`)
          .join('\n');

        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  filePath: relPath,
                  totalLines,
                  startLine,
                  endLine,
                  content: numberedContent,
                  rawText: selectedLines.join('\n'),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка чтения файла: ${err.message}` }],
          isError: true,
        };
      }
    }

    // 3. search_project_files
    if (name === 'search_project_files') {
      try {
        const query = String(args?.query || '').trim();
        if (!query) {
          return {
            content: [{ type: 'text', text: 'Ошибка: параметр "query" обязателен для поиска.' }],
            isError: true,
          };
        }

        const subpath = args?.subpath ? String(args.subpath).trim() : '';
        const maxResults =
          typeof args?.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : 40;

        let extensions = Array.isArray(args?.fileExtensions)
          ? args.fileExtensions.map((e) => String(e).toLowerCase())
          : DEFAULT_SEARCH_EXTENSIONS;

        const targetDir = resolveSafePath(projectRoot, subpath);
        const candidateFiles = scanDirectoryFiles(targetDir, projectRoot, 800).filter((rel) => {
          const ext = path.extname(rel).toLowerCase();
          return extensions.includes(ext);
        });

        const matches: Array<{ file: string; line: number; text: string }> = [];
        const queryLower = query.toLowerCase();

        for (const rel of candidateFiles) {
          if (matches.length >= maxResults) break;

          const abs = path.join(projectRoot, rel);
          try {
            const content = fs.readFileSync(abs, 'utf8');
            const lines = content.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) break;
              const line = lines[i];
              if (line.toLowerCase().includes(queryLower)) {
                matches.push({
                  file: rel,
                  line: i + 1,
                  text: line.trim(),
                });
              }
            }
          } catch {
            // skip binary / inaccessible files
          }
        }

        const uniqueFiles = new Set(matches.map((m) => m.file));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  totalMatches: matches.length,
                  filesCount: uniqueFiles.size,
                  matches,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка поиска: ${err.message}` }],
          isError: true,
        };
      }
    }

    // 4. write_project_file
    if (name === 'write_project_file') {
      try {
        const rawFilePath = String(args?.filePath || args?.path || args?.file || '').trim();
        const content =
          typeof args?.content === 'string'
            ? args.content
            : typeof args?.text === 'string'
            ? args.text
            : typeof args?.body === 'string'
            ? args.body
            : args?.content !== undefined
            ? String(args.content)
            : '';
        const overwrite = args?.overwrite !== false;

        if (!rawFilePath) {
          return {
            content: [{ type: 'text', text: 'Ошибка: параметр "filePath" обязателен.' }],
            isError: true,
          };
        }

        const fullPath = resolveSafePath(projectRoot, rawFilePath);
        const exists = fs.existsSync(fullPath);

        if (exists && !overwrite) {
          return {
            content: [
              {
                type: 'text',
                text: `Файл "${rawFilePath}" уже существует, а флаг overwrite установлен в false.`,
              },
            ],
            isError: true,
          };
        }

        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf8');
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  filePath: relPath,
                  created: !exists,
                  bytesWritten: Buffer.byteLength(content, 'utf8'),
                  message: exists
                    ? `Файл "${relPath}" успешно обновлен.`
                    : `Файл "${relPath}" успешно создан.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка записи файла: ${err.message}` }],
          isError: true,
        };
      }
    }

    // 5. patch_project_file
    if (name === 'patch_project_file') {
      try {
        const rawFilePath = String(args?.filePath || args?.path || args?.file || '').trim();
        const targetContent = typeof args?.targetContent === 'string' ? args.targetContent : '';
        const replacementContent =
          typeof args?.replacementContent === 'string' ? args.replacementContent : '';

        if (!rawFilePath) {
          return {
            content: [{ type: 'text', text: 'Ошибка: параметр "filePath" обязателен.' }],
            isError: true,
          };
        }
        if (!targetContent) {
          return {
            content: [{ type: 'text', text: 'Ошибка: параметр "targetContent" обязателен.' }],
            isError: true,
          };
        }

        const fullPath = resolveSafePath(projectRoot, rawFilePath);
        if (!fs.existsSync(fullPath)) {
          return {
            content: [{ type: 'text', text: `Файл для патча не найден: "${rawFilePath}"` }],
            isError: true,
          };
        }

        const original = fs.readFileSync(fullPath, 'utf8');
        if (!original.includes(targetContent)) {
          return {
            content: [
              {
                type: 'text',
                text: `Фрагмент "targetContent" не найден в файле "${rawFilePath}". Проверьте точность совпадения строк и пробелов.`,
              },
            ],
            isError: true,
          };
        }

        const updated = original.replace(targetContent, replacementContent);
        fs.writeFileSync(fullPath, updated, 'utf8');
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  filePath: relPath,
                  replaced: true,
                  message: `Файл "${relPath}" успешно пропатчен.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка патча файла: ${err.message}` }],
          isError: true,
        };
      }
    }

    // 6. get_file_diff
    if (name === 'get_file_diff') {
      try {
        const rawFilePath = (args?.filePath || args?.path || args?.file)
          ? String(args.filePath || args.path || args.file).trim()
          : '';
        const staged = Boolean(args?.staged);

        const gitArgs = ['-C', projectRoot, 'diff'];
        if (staged) gitArgs.push('--cached');

        let resolvedPath = '';
        let relPath = '';
        if (rawFilePath) {
          resolvedPath = resolveSafePath(projectRoot, rawFilePath);
          relPath = path.relative(projectRoot, resolvedPath).replace(/\\/g, '/');
          gitArgs.push('--', relPath);
        }

        const { stdout: diffStdout } = await execFileAsync('git', gitArgs, {
          encoding: 'utf8',
          windowsHide: true,
        });

        // Also check status for untracked / newly created files
        const { stdout: statusStdout } = await execFileAsync(
          'git',
          ['-C', projectRoot, 'status', '--porcelain'],
          { encoding: 'utf8', windowsHide: true }
        );

        const statusLines = statusStdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        const changedFiles = statusLines.map((l) => l.substring(3).trim());
        let effectiveDiff = diffStdout.trim();

        // If standard git diff is empty for a specific file, but the file exists on disk (e.g. untracked new file)
        if (!effectiveDiff && rawFilePath && resolvedPath && fs.existsSync(resolvedPath)) {
          const fileContent = fs.readFileSync(resolvedPath, 'utf8');
          const fileLines = fileContent.split(/\r?\n/);
          effectiveDiff = [
            `diff --git a/${relPath} b/${relPath}`,
            `new file mode 100644`,
            `--- /dev/null`,
            `+++ b/${relPath}`,
            `@@ -0,0 +1,${fileLines.length} @@`,
            ...fileLines.map((l) => `+${l}`),
          ].join('\n');
        }

        const hasChanges = effectiveDiff.length > 0 || statusLines.length > 0;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  hasChanges,
                  filePath: relPath || rawFilePath || undefined,
                  changedFiles,
                  staged,
                  diff:
                    effectiveDiff ||
                    (statusLines.length > 0
                      ? `Untracked / staged files:\n${statusStdout.trim()}`
                      : 'No changes detected (working tree clean).'),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Ошибка получения git diff: ${err.message}` }],
          isError: true,
        };
      }
    }

    throw new Error(`Неизвестный инструмент: ${name}`);
  });

  return server;
}

export function startFilesHttpServer(
  port: number = DEFAULT_PORT,
  projectRoot: string = DEFAULT_PROJECT_PATH
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      // Dynamic CORS headers for browser client
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
        const server = createFilesMcpServer(projectRoot);
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
        const server = createFilesMcpServer(projectRoot);
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
              server: 'crypto-track-files-server',
              projectRoot,
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
      console.log(`\n📁 CryptoTrack Project Files MCP Server started on http://localhost:${port}`);
      console.log(`📡 Endpoints:`);
      console.log(`   - SSE Stream:       http://localhost:${port}/sse`);
      console.log(`   - Streamable HTTP:  http://localhost:${port}/mcp`);
      console.log(`   - Healthcheck:      http://localhost:${port}/health`);
      console.log(`🛠️ Tools provided: ${AVAILABLE_TOOLS.map((t) => t.name).join(', ')}`);
      console.log(`📂 Project directory: ${projectRoot}\n`);
      resolve(httpServer);
    });
  });
}

// Standalone execution if launched directly via CLI
const scriptPath = process.argv[1]?.replace(/\\/g, '/');
const isDirectExecution =
  scriptPath?.endsWith('/files/server.ts') || scriptPath?.endsWith('/files/server.js');

if (isDirectExecution) {
  startFilesHttpServer();
}
