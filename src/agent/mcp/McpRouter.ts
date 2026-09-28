import { McpServerConfig, McpToolInfo } from './types';
import { loadMcpServers } from './storage';
import { testMcpConnection, callMcpTool } from './McpClient';
import { McpCallMeta } from '../types';

export class McpRouter {
  private static instance: McpRouter | null = null;

  // Cached routing table: toolName -> McpServerConfig
  private toolRoutes: Map<string, McpServerConfig> = new Map();
  // Server id -> tools list
  private serverToolsMap: Map<string, McpToolInfo[]> = new Map();
  // Last discovery timestamp
  private lastDiscoveryTime = 0;
  // Cache TTL in ms (30 seconds)
  private cacheTtl = 30000;

  public static getInstance(): McpRouter {
    if (!McpRouter.instance) {
      McpRouter.instance = new McpRouter();
    }
    return McpRouter.instance;
  }

  /**
   * Resets router cache (useful for tests and server config updates)
   */
  public reset(): void {
    this.toolRoutes.clear();
    this.serverToolsMap.clear();
    this.lastDiscoveryTime = 0;
  }

  /**
   * Manually register or override a route mapping
   */
  public registerRoute(toolName: string, server: McpServerConfig, toolInfo?: McpToolInfo): void {
    this.toolRoutes.set(toolName, server);
    if (toolInfo) {
      const existing = this.serverToolsMap.get(server.id) || [];
      if (!existing.some((t) => t.name === toolName)) {
        this.serverToolsMap.set(server.id, [...existing, toolInfo]);
      }
    }
  }

  /**
   * Discovers tools on all enabled MCP servers and builds routing index.
   */
  public async discoverAllTools(
    servers?: McpServerConfig[],
    forceRefresh = false
  ): Promise<Map<string, McpToolInfo[]>> {
    const activeServers = (servers || loadMcpServers()).filter((s) => s.enabled);
    const now = Date.now();

    if (!forceRefresh && this.lastDiscoveryTime > 0 && now - this.lastDiscoveryTime < this.cacheTtl) {
      return this.serverToolsMap;
    }

    this.toolRoutes.clear();
    this.serverToolsMap.clear();

    await Promise.all(
      activeServers.map(async (server) => {
        try {
          const res = await testMcpConnection(server);
          if (res.success && res.tools) {
            this.serverToolsMap.set(server.id, res.tools);
            for (const tool of res.tools) {
              this.toolRoutes.set(tool.name, server);
            }
          } else {
            console.warn(`[McpRouter] Server ${server.name} (${server.url}) discovery failed:`, res.error);
          }
        } catch (err) {
          console.warn(`[McpRouter] Error discovering tools on ${server.name}:`, err);
        }
      })
    );

    this.lastDiscoveryTime = Date.now();
    return this.serverToolsMap;
  }

  /**
   * Resolves target server for a given tool name.
   */
  public resolveTargetServer(toolName: string, servers?: McpServerConfig[]): McpServerConfig | null {
    // 1. Direct hit from dynamic routing index
    if (this.toolRoutes.has(toolName)) {
      const server = this.toolRoutes.get(toolName)!;
      const activeServers = servers || loadMcpServers();
      const current = activeServers.find((s) => s.id === server.id && s.enabled);
      if (current) return current;
    }

    // 2. Known domain routing fallback heuristics
    const activeServers = (servers || loadMcpServers()).filter((s) => s.enabled);
    for (const server of activeServers) {
      const url = server.url.toLowerCase();
      const name = server.name.toLowerCase();

      // Logistics & Orders server tools
      if (['order_get_status', 'delivery_calculate_cost', 'schedule_monitor'].includes(toolName)) {
        if (url.includes(':3002') || name.includes('логист') || name.includes('заказ')) {
          this.toolRoutes.set(toolName, server);
          return server;
        }
      }

      // Analytics & Pipeline server tools
      if (['search', 'summarize', 'saveToFile', 'get_aggregated_summary'].includes(toolName)) {
        if (url.includes(':3003') || name.includes('аналитик') || name.includes('отчет')) {
          this.toolRoutes.set(toolName, server);
          return server;
        }
      }

      // Catalog & Inventory server tools
      if (['store_search_products', 'store_get_product', 'calculate', 'get_system_time', 'echo'].includes(toolName)) {
        if (url.includes(':3001') || name.includes('каталог') || name.includes('склад')) {
          this.toolRoutes.set(toolName, server);
          return server;
        }
      }
    }

    // 3. Fallback to first available enabled server
    return activeServers[0] || null;
  }

  /**
   * Executes tool with targeted routing and returns enriched McpCallMeta.
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    servers?: McpServerConfig[]
  ): Promise<McpCallMeta> {
    const activeServers = (servers || loadMcpServers()).filter((s) => s.enabled);

    if (activeServers.length === 0) {
      return {
        toolName,
        args,
        result: 'Ошибка: Нет активных (enabled) MCP-серверов в настройках приложения.',
        isError: true,
        latencyMs: 0,
      };
    }

    const targetServer = this.resolveTargetServer(toolName, activeServers);

    if (!targetServer) {
      return {
        toolName,
        args,
        result: `Ошибка маршрутизации: Ни один активный MCP-сервер не предоставляет инструмент "${toolName}".`,
        isError: true,
        latencyMs: 0,
      };
    }

    const res = await callMcpTool(targetServer, toolName, args);

    return {
      toolName,
      args,
      result: res.result,
      isError: res.isError,
      serverName: targetServer.name,
      serverUrl: targetServer.url,
      latencyMs: res.latencyMs,
    };
  }

  /**
   * Formats structured system prompt instructions grouping tools by their server domain.
   */
  public formatSystemPromptInstructions(servers?: McpServerConfig[]): string {
    const activeServers = (servers || loadMcpServers()).filter((s) => s.enabled);
    if (activeServers.length === 0) return '';

    const lines: string[] = [
      `[MODEL CONTEXT PROTOCOL (MCP) MULTI-SERVER ORCHESTRATION]`,
      `You have access to specialized external MCP servers with distinct domains and tools:`,
    ];

    for (const server of activeServers) {
      const tools = this.serverToolsMap.get(server.id) || [];
      lines.push(`\n### MCP Server: "${server.name}" (${server.url})`);

      if (tools.length > 0) {
        for (const t of tools) {
          const reqStr =
            t.inputSchema?.required && t.inputSchema.required.length > 0
              ? ` [required: ${t.inputSchema.required.join(', ')}]`
              : '';
          lines.push(`- \`${t.name}\`${reqStr}: ${t.description || 'Нет описания'}`);
        }
      } else {
        const url = server.url.toLowerCase();
        const name = server.name.toLowerCase();

        if (url.includes(':3002') || name.includes('логист') || name.includes('logistics')) {
          lines.push(`- \`order_get_status\` [required: order_id]: Проверить статус и трекинг заказа`);
          lines.push(`- \`delivery_calculate_cost\` [required: city]: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`- \`schedule_monitor\` [required: interval_seconds]: Запланировать фоновый мониторинг`);
        } else if (url.includes(':3003') || name.includes('аналитик') || name.includes('analytics') || name.includes('pipeline')) {
          lines.push(`- \`search\` [required: query]: Поиск информации в каталоге для аналитического пайплайна`);
          lines.push(`- \`summarize\`: Аналитическая выжимка, расчет метрик и рекомендаций (markdown/json)`);
          lines.push(`- \`saveToFile\` [required: content]: Сохранение отчета на диск в каталог data/reports`);
          lines.push(`- \`get_aggregated_summary\`: Агрегированная сводка фонового мониторинга`);
        } else {
          // General Store & Catalog Server fallback (covers Day 17-19 and default port 3001)
          lines.push(`- \`store_search_products\`: Поиск товаров в каталоге интернет-магазина (query, category, max_price)`);
          lines.push(`- \`store_get_product\` [required: sku]: Данные о товаре по SKU (цена, характеристики, склад, остаток)`);
          lines.push(`- \`order_get_status\` [required: order_id]: Проверить статус и трекинг заказа`);
          lines.push(`- \`delivery_calculate_cost\` [required: city]: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`- \`schedule_monitor\` [required: interval_seconds]: Запланировать фоновый мониторинг`);
          lines.push(`- \`get_aggregated_summary\`: Получить агрегированную аналитическую сводку фонового мониторинга`);
          lines.push(`- \`calculate\` [required: expression]: Вычислить математическое выражение`);
          lines.push(`- \`get_system_time\`: Текущее время сервера`);
        }
      }
    }

    lines.push(`\n[MULTI-SERVER WORKFLOW & CALL FORMAT]:`);
    lines.push(`To call any tool, output the following tag:`);
    lines.push(`<mcp_call name="tool_name">`);
    lines.push(`{"param1": "value1"}`);
    lines.push(`</mcp_call>`);
    lines.push(
      `\nFor complex multi-step user requests (e.g. product selection, delivery estimation, report generation):`
    );
    lines.push(`1. Choose the right tool from the corresponding server.`);
    lines.push(`2. Execute calls sequentially in causal order across different servers.`);
    lines.push(`3. When you receive <mcp_result>, continue with the next logical step until the goal is achieved.`);
    lines.push(`4. When all information is collected and saved, formulate a clear, comprehensive final answer for the user.`);

    return lines.join('\n');
  }

  /**
   * Helper to inspect current routing table (for tests and debugging)
   */
  public getRoutingTable(): Map<string, string> {
    const table = new Map<string, string>();
    for (const [tool, server] of this.toolRoutes.entries()) {
      table.set(tool, `${server.name} (${server.url})`);
    }
    return table;
  }
}
