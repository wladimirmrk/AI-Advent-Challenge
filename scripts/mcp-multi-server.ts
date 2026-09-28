import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MockEcommerceService } from './mock-store.js';
import { SchedulerService, MonitorTarget } from './scheduler-service.js';
import { PipelineService } from './pipeline-service.js';

export interface MultiServerPorts {
  catalog: number;
  logistics: number;
  analytics: number;
}

export const DEFAULT_MULTI_PORTS: MultiServerPorts = {
  catalog: Number(process.env.MCP_CATALOG_PORT) || 3001,
  logistics: Number(process.env.MCP_LOGISTICS_PORT) || 3002,
  analytics: Number(process.env.MCP_ANALYTICS_PORT) || 3003,
};

// ============================================================================
// 1. Catalog & Inventory Server (Port 3001)
// ============================================================================
export const CATALOG_TOOLS = [
  {
    name: 'store_search_products',
    description: 'Поиск товаров в каталоге интернет-магазина по ключевым словам, категории или максимальной цене',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (название товара или описание)',
        },
        category: {
          type: 'string',
          enum: ['smartphones', 'laptops', 'audio', 'wearables', 'accessories'],
          description: 'Категория электроники',
        },
        max_price: {
          type: 'number',
          description: 'Максимальная стоимость в рублях',
        },
      },
    },
  },
  {
    name: 'store_get_product',
    description: 'Получить подробные данные о товаре по артикулу (SKU): цена, характеристики, склад и остаток',
    inputSchema: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Артикул товара (например: PHONE-15-PRO, LAPTOP-AIR-M3, HEADPHONES-MAX, WATCH-ULTRA-2, CASE-MAGSAFE)',
        },
      },
      required: ['sku'],
    },
  },
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

export function createCatalogServer(): Server {
  const server = new Server(
    {
      name: 'advent-catalog-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CATALOG_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'store_search_products') {
      try {
        const query = args?.query ? String(args.query) : undefined;
        const category = args?.category as any;
        const maxPrice = args?.max_price !== undefined ? Number(args.max_price) : undefined;
        const results = MockEcommerceService.searchProducts(query, category, maxPrice);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка поиска: ${err.message}` }], isError: true };
      }
    }

    if (name === 'store_get_product') {
      try {
        const sku = String(args?.sku || '').trim();
        const res = MockEcommerceService.getProductBySku(sku);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
          isError: !res.found,
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка получения товара: ${err.message}` }], isError: true };
      }
    }

    if (name === 'calculate') {
      try {
        const expr = String(args?.expression || '');
        if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
          return {
            content: [{ type: 'text', text: 'Ошибка безопасности: выражение содержит недопустимые символы.' }],
            isError: true,
          };
        }
        const sanitizedExpr = expr.replace(/\^/g, '**');
        const calcFunc = new Function(`return (${sanitizedExpr});`);
        const result = calcFunc();
        return {
          content: [{ type: 'text', text: `Результат: ${result}` }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка вычисления: ${err.message}` }], isError: true };
      }
    }

    if (name === 'get_system_time') {
      const format = (args?.format as string) || 'iso';
      const now = new Date();
      let timeStr: string;
      if (format === 'locale') timeStr = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      else if (format === 'timestamp') timeStr = String(now.getTime());
      else timeStr = now.toISOString();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              time: timeStr,
              format,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          },
        ],
      };
    }

    if (name === 'echo') {
      const message = String(args?.message || '');
      return { content: [{ type: 'text', text: `Echo: ${message}` }] };
    }

    throw new Error(`Tool not found on Catalog Server: ${name}`);
  });

  return server;
}

// ============================================================================
// 2. Logistics & Orders Server (Port 3002)
// ============================================================================
export const LOGISTICS_TOOLS = [
  {
    name: 'order_get_status',
    description: 'Проверить статус, состав и трекинг заказа клиента по номеру заказа (order_id)',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'Номер заказа (например: ORD-7741, ORD-8820, ORD-9905)',
        },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'delivery_calculate_cost',
    description: 'Рассчитать стоимость и ориентировочный срок курьерской доставки в указанный город',
    inputSchema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'Город назначения (например: Москва, Санкт-Петербург, Казань, Екатеринбург, Новосибирск)',
        },
        weight_kg: {
          type: 'number',
          description: 'Вес посылки в килограммах (по умолчанию 1.0)',
        },
        express: {
          type: 'boolean',
          description: 'Срочная доставка (быстрее, но с доплатой)',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'schedule_monitor',
    description: 'Запланировать фоновый периодический или отложенный мониторинг цен, остатков товаров или статусов заказов',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['products', 'orders', 'all'],
          description: 'Объект мониторинга: товары, заказы или всё вместе',
        },
        interval_seconds: {
          type: 'number',
          description: 'Интервал периодического опроса в секундах',
        },
        delay_seconds: {
          type: 'number',
          description: 'Отсрочка первого запуска в секундах',
        },
        notes: {
          type: 'string',
          description: 'Примечание к мониторингу',
        },
      },
      required: ['interval_seconds'],
    },
  },
];

export function createLogisticsServer(): Server {
  const server = new Server(
    {
      name: 'advent-logistics-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: LOGISTICS_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'order_get_status') {
      try {
        const orderId = String(args?.order_id || '').trim();
        const res = MockEcommerceService.getOrderStatus(orderId);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
          isError: !res.found,
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка проверки статуса заказа: ${err.message}` }], isError: true };
      }
    }

    if (name === 'delivery_calculate_cost') {
      try {
        const city = String(args?.city || '').trim();
        const weightKg = Number(args?.weight_kg || 1.0);
        const express = Boolean(args?.express);
        const res = MockEcommerceService.calculateDelivery(city, weightKg, express);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка расчета доставки: ${err.message}` }], isError: true };
      }
    }

    if (name === 'schedule_monitor') {
      try {
        const scheduler = SchedulerService.getInstance();
        const target = (args?.target as MonitorTarget) || 'all';
        const intervalSeconds = Number(args?.interval_seconds) || 60;
        const delaySeconds = args?.delay_seconds !== undefined ? Number(args.delay_seconds) : 0;
        const notes = args?.notes ? String(args.notes) : undefined;

        const task = scheduler.scheduleTask({
          target,
          intervalSeconds,
          delaySeconds,
          notes,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Задача мониторинга успешно запланирована.`,
                  task: {
                    id: task.id,
                    target: task.target,
                    intervalSeconds: task.intervalSeconds,
                    nextRun: new Date(task.nextRunAt).toISOString(),
                    status: task.status,
                    notes: task.notes,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка планировщика: ${err.message}` }], isError: true };
      }
    }

    throw new Error(`Tool not found on Logistics Server: ${name}`);
  });

  return server;
}

// ============================================================================
// 3. Analytics & Reporting Server (Port 3003)
// ============================================================================
export const ANALYTICS_TOOLS = [
  {
    name: 'search',
    description: 'Поиск товаров и информации в каталоге магазина по ключевым словам или категории (Шаг 1 аналитического пайплайна)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (например: "iPhone", "ноутбук", "наушники")',
        },
        category: {
          type: 'string',
          enum: ['smartphones', 'laptops', 'audio', 'wearables', 'accessories'],
          description: 'Категория товаров',
        },
        max_results: {
          type: 'number',
          description: 'Максимальное количество возвращаемых товаров',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'summarize',
    description: 'Аналитическая структурированная выжимка найденных товаров или текста с расчетом метрик, цен и рекомендаций (Шаг 2 аналитического пайплайна)',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Текстовый контент или JSON для суммаризации',
        },
        items: {
          type: 'array',
          description: 'Массив найденных объектов товаров',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Формат отчета: markdown или json',
        },
        title: {
          type: 'string',
          description: 'Пользовательский заголовок аналитического отчета',
        },
      },
    },
  },
  {
    name: 'saveToFile',
    description: 'Безопасное сохранение форматированного отчета на диск в каталог data/reports с защитой от path traversal (Шаг 3 аналитического пайплайна)',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Текстовое содержимое (Markdown или JSON) для записи в файл',
        },
        filename: {
          type: 'string',
          description: 'Имя файла (например: laptops-report.md). Если не указано, генерируется автоматически.',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Формат файла',
        },
        directory: {
          type: 'string',
          description: 'Опциональный целевой каталог',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_aggregated_summary',
    description: 'Получить агрегированную аналитическую сводку по результатам фонового мониторинга (дельты цен, складские алерты, статусы)',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['products', 'orders', 'all'],
          description: 'Объект сводки',
        },
      },
    },
  },
];

export function createAnalyticsServer(): Server {
  const server = new Server(
    {
      name: 'advent-analytics-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ANALYTICS_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const pipeline = PipelineService.getInstance();

    if (name === 'search') {
      try {
        const query = String(args?.query || '');
        const category = args?.category as any;
        const maxResults = args?.max_results !== undefined ? Number(args.max_results) : 20;
        const res = pipeline.searchData({ query, category, maxResults });
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка поиска: ${err.message}` }], isError: true };
      }
    }

    if (name === 'summarize') {
      try {
        const content = args?.content !== undefined ? String(args.content) : undefined;
        const items = Array.isArray(args?.items) ? args.items : undefined;
        const format = (args?.format as 'markdown' | 'json') || 'markdown';
        const title = args?.title ? String(args.title) : undefined;
        const res = pipeline.summarizeData({ content, items, format, title });
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка суммаризации: ${err.message}` }], isError: true };
      }
    }

    if (name === 'saveToFile') {
      try {
        const content = args?.content;
        const filename = args?.filename ? String(args.filename) : undefined;
        const format = (args?.format as 'markdown' | 'json') || 'markdown';
        const directory = args?.directory ? String(args.directory) : undefined;
        const res = pipeline.saveToFile({ content, filename, format, directory });
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка сохранения файла: ${err.message}` }], isError: true };
      }
    }

    if (name === 'get_aggregated_summary') {
      try {
        const scheduler = SchedulerService.getInstance();
        const target = (args?.target as MonitorTarget) || 'all';
        const summary = scheduler.getAggregatedSummary(target);
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Ошибка получения сводки: ${err.message}` }], isError: true };
      }
    }

    throw new Error(`Tool not found on Analytics Server: ${name}`);
  });

  return server;
}

// ============================================================================
// Multi-Server Runner & HTTP Listener
// ============================================================================

export function startMcpServerInstance(
  serverFactory: () => Server,
  port: number,
  serverDisplayName: string,
  toolsList: Array<{ name: string }>
): Promise<http.Server> {
  return new Promise((resolve) => {
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      // Dynamic CORS headers
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
        const server = serverFactory();
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
        const server = serverFactory();
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
            server: serverDisplayName,
            port,
            sseEndpoint: `http://${req.headers.host || `localhost:${port}`}/sse`,
            httpEndpoint: `http://${req.headers.host || `localhost:${port}`}/mcp`,
            toolsCount: toolsList.length,
            tools: toolsList.map((t) => t.name),
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    httpServer.listen(port, () => {
      console.log(`[MCP Server: ${serverDisplayName}] listening on http://localhost:${port}`);
      console.log(`  -> SSE:    http://localhost:${port}/sse`);
      console.log(`  -> Tools:  ${toolsList.map((t) => t.name).join(', ')}`);
      resolve(httpServer);
    });
  });
}

export interface RunningServers {
  catalog: http.Server;
  logistics: http.Server;
  analytics: http.Server;
  closeAll: () => Promise<void>;
}

export async function startAllMcpServers(
  ports: MultiServerPorts = DEFAULT_MULTI_PORTS
): Promise<RunningServers> {
  console.log('\n======================================================');
  console.log('🚀 Starting Multi-Server MCP Architecture (Day 20)');
  console.log('======================================================');

  // Start background scheduler if not already running
  SchedulerService.getInstance().start();

  const catalog = await startMcpServerInstance(
    createCatalogServer,
    ports.catalog,
    'Каталог и Склад (Catalog & Inventory)',
    CATALOG_TOOLS
  );

  const logistics = await startMcpServerInstance(
    createLogisticsServer,
    ports.logistics,
    'Логистика и Заказы (Logistics & Orders)',
    LOGISTICS_TOOLS
  );

  const analytics = await startMcpServerInstance(
    createAnalyticsServer,
    ports.analytics,
    'Аналитика и Отчеты (Analytics & Reports)',
    ANALYTICS_TOOLS
  );

  console.log('======================================================');
  console.log('✅ All 3 MCP Servers are online and ready for orchestration!\n');

  const closeAll = async () => {
    await Promise.all([
      new Promise((res) => catalog.close(res)),
      new Promise((res) => logistics.close(res)),
      new Promise((res) => analytics.close(res)),
    ]);
  };

  return { catalog, logistics, analytics, closeAll };
}

// Standalone execution
if (
  process.argv[1]?.endsWith('mcp-multi-server.ts') ||
  process.argv[1]?.endsWith('mcp-multi-server.js')
) {
  startAllMcpServers();
}
