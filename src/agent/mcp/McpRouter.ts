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
   * Returns discovered tools for a specific server ID
   */
  public getServerTools(serverId: string): McpToolInfo[] | undefined {
    return this.serverToolsMap.get(serverId);
  }

  /**
   * Seeds routing table and tool map from cached tools in server configurations
   */
  public seedFromServers(servers?: McpServerConfig[]): void {
    const list = (servers || loadMcpServers()).filter((s) => s.enabled);
    for (const server of list) {
      if (server.tools && server.tools.length > 0) {
        this.serverToolsMap.set(server.id, server.tools);
        for (const tool of server.tools) {
          this.toolRoutes.set(tool.name, server);
        }
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
          if (res.success && res.tools && res.tools.length > 0) {
            this.serverToolsMap.set(server.id, res.tools);
            server.tools = res.tools;
            server.lastDiscoveredAt = Date.now();
            for (const tool of res.tools) {
              this.toolRoutes.set(tool.name, server);
            }
          } else {
            console.warn(`[McpRouter] Server ${server.name} (${server.url}) discovery failed:`, res.error);
            if (server.tools && server.tools.length > 0) {
              this.serverToolsMap.set(server.id, server.tools);
              for (const tool of server.tools) {
                this.toolRoutes.set(tool.name, server);
              }
            }
          }
        } catch (err) {
          console.warn(`[McpRouter] Error discovering tools on ${server.name}:`, err);
          if (server.tools && server.tools.length > 0) {
            this.serverToolsMap.set(server.id, server.tools);
            for (const tool of server.tools) {
              this.toolRoutes.set(tool.name, server);
            }
          }
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
    const activeServers = (servers || loadMcpServers()).filter((s) => s.enabled);
    if (activeServers.length === 0) return null;

    // 0. Namespaced tool call check (e.g. "google_stitch.list_projects", "Google Stitch:list_projects", "stitch/list_projects")
    const sepMatch = toolName.match(/^([^.:/]+)[.:/](.+)$/);
    if (sepMatch) {
      const serverPrefix = sepMatch[1].trim().toLowerCase().replace(/[\s_-]+/g, '');
      const actualTool = sepMatch[2].trim();
      for (const server of activeServers) {
        const sName = server.name.toLowerCase().replace(/[\s_-]+/g, '');
        const sId = server.id.toLowerCase().replace(/[\s_-]+/g, '');
        if (sName.includes(serverPrefix) || sId.includes(serverPrefix) || serverPrefix.includes(sName) || serverPrefix.includes(sId)) {
          const tools = this.serverToolsMap.get(server.id) || server.tools || [];
          if (tools.some((t) => t.name === actualTool)) {
            this.toolRoutes.set(actualTool, server);
            return server;
          }
        }
      }
    }

    // 0.5 If toolName matches a server name or id directly (e.g. "google_stitch" or "Google Stitch")
    // Note: Do NOT match if toolName is a generic wrapper like "mcp_call" or "call"
    const GENERIC_WRAPPERS = new Set([
      'mcp_call',
      'call_tool',
      'calltool',
      'tool_call',
      'toolcall',
      'call',
      'tool',
      'mcp',
      'tools/call',
      'execute_tool',
      'run_tool',
    ]);
    if (!GENERIC_WRAPPERS.has(toolName.toLowerCase())) {
      for (const server of activeServers) {
        const sName = server.name.toLowerCase().replace(/[\s_-]+/g, '');
        const sId = server.id.toLowerCase().replace(/[\s_-]+/g, '');
        const cleanTool = toolName.toLowerCase().replace(/[\s_-]+/g, '');
        if (sName === cleanTool || sId === cleanTool || sName.includes(cleanTool) || cleanTool.includes(sName)) {
          return server;
        }
      }
    }

    // 1. Direct hit from dynamic routing index
    if (this.toolRoutes.has(toolName)) {
      const server = this.toolRoutes.get(toolName)!;
      const current = activeServers.find((s) => s.id === server.id && s.enabled);
      if (current) return current;
    }

    // 2. Direct hit from server.tools or serverToolsMap
    for (const server of activeServers) {
      const tools = this.serverToolsMap.get(server.id) || server.tools || [];
      if (tools.some((t) => t.name === toolName)) {
        this.toolRoutes.set(toolName, server);
        return server;
      }
    }

    // 3. Known domain routing fallback heuristics (ONLY for default mock demo servers)
    for (const server of activeServers) {
      const isMockLogistics =
        server.id === 'mcp-logistics-server' ||
        (server.url.includes(':3002') && server.name.toLowerCase().includes('логист'));
      if (
        isMockLogistics &&
        ['order_get_status', 'delivery_calculate_cost', 'schedule_monitor'].includes(toolName)
      ) {
        this.toolRoutes.set(toolName, server);
        return server;
      }

      const isMockAnalytics =
        server.id === 'mcp-analytics-server' ||
        (server.url.includes(':3003') && server.name.toLowerCase().includes('аналитик'));
      if (
        isMockAnalytics &&
        ['search', 'summarize', 'saveToFile', 'get_aggregated_summary'].includes(toolName)
      ) {
        this.toolRoutes.set(toolName, server);
        return server;
      }

      const isMockCatalog =
        server.id === 'mcp-catalog-server' ||
        (server.url.includes(':3001') &&
          (server.name.toLowerCase().includes('каталог') ||
            server.name.toLowerCase().includes('склад')));
      if (
        isMockCatalog &&
        ['store_search_products', 'store_get_product', 'calculate', 'get_system_time', 'echo'].includes(
          toolName
        )
      ) {
        this.toolRoutes.set(toolName, server);
        return server;
      }
    }

    // 4. Fallback: if only 1 server is active, route tool to it
    if (activeServers.length === 1) {
      return activeServers[0];
    }

    return null;
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

    let actualToolName = toolName;
    const cleanArgs: Record<string, unknown> = { ...args };

    const GENERIC_ROUTER_WRAPPERS = new Set([
      'mcp_call',
      'call_tool',
      'calltool',
      'tool_call',
      'toolcall',
      'call',
      'tool',
      'mcp',
      'tools/call',
      'execute_tool',
      'run_tool',
    ]);

    // If actualToolName is a generic wrapper (e.g. mcp_call), unwrap the real tool name from cleanArgs
    if (GENERIC_ROUTER_WRAPPERS.has(actualToolName.toLowerCase())) {
      const candidate =
        cleanArgs.name ||
        cleanArgs.tool ||
        cleanArgs.tool_name ||
        cleanArgs.action ||
        cleanArgs.method;
      if (typeof candidate === 'string' && candidate.trim()) {
        actualToolName = candidate.trim();
        delete cleanArgs.name;
        delete cleanArgs.tool;
        delete cleanArgs.tool_name;
        delete cleanArgs.action;
        delete cleanArgs.method;

        const nested =
          cleanArgs.arguments ||
          cleanArgs.parameters ||
          cleanArgs.params ||
          cleanArgs.args;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          Object.assign(cleanArgs, nested);
          delete cleanArgs.arguments;
          delete cleanArgs.parameters;
          delete cleanArgs.params;
          delete cleanArgs.args;
        }
      }
    }

    // Unwrap single arguments object if passed: e.g. { arguments: { ... } }
    if (
      cleanArgs.arguments &&
      typeof cleanArgs.arguments === 'object' &&
      !Array.isArray(cleanArgs.arguments) &&
      Object.keys(cleanArgs).length === 1
    ) {
      const nested = cleanArgs.arguments as Record<string, unknown>;
      delete cleanArgs.arguments;
      Object.assign(cleanArgs, nested);
    }

    // Handle namespaced tool name (e.g. google_stitch.list_projects -> list_projects)
    const sepMatch = actualToolName.match(/^([^.:/]+)[.:/](.+)$/);
    if (sepMatch) {
      actualToolName = sepMatch[2].trim();
    }

    const targetServer =
      this.resolveTargetServer(toolName, activeServers) ||
      this.resolveTargetServer(actualToolName, activeServers);

    if (!targetServer) {
      return {
        toolName,
        args,
        result: `Ошибка маршрутизации: Ни один активный MCP-сервер не предоставляет инструмент "${toolName}".`,
        isError: true,
        latencyMs: 0,
      };
    }

    const serverTools = this.serverToolsMap.get(targetServer.id) || targetServer.tools || [];

    // Guard: Check if actualToolName is accidentally the server name or id rather than a tool name
    const sName = targetServer.name.toLowerCase().replace(/[\s_-]+/g, '');
    const sId = targetServer.id.toLowerCase().replace(/[\s_-]+/g, '');
    const cleanTool = actualToolName.toLowerCase().replace(/[\s_-]+/g, '');
    const isServerName = (sName === cleanTool || sId === cleanTool || sName.includes(cleanTool) || cleanTool.includes(sName)) &&
      !serverTools.some((t) => t.name === actualToolName);

    if (isServerName) {
      // 1. Check if the tool name was passed inside arguments: e.g. { "name": "list_projects" } or { "tool": "list_projects" }
      const argTool =
        cleanArgs.name ||
        cleanArgs.tool ||
        cleanArgs.tool_name ||
        cleanArgs.action ||
        cleanArgs.method;
      if (typeof argTool === 'string' && serverTools.some((t) => t.name === argTool.trim())) {
        actualToolName = argTool.trim();
        delete cleanArgs.name;
        delete cleanArgs.tool;
        delete cleanArgs.tool_name;
        delete cleanArgs.action;
        delete cleanArgs.method;

        const nested =
          cleanArgs.arguments ||
          cleanArgs.parameters ||
          cleanArgs.params ||
          cleanArgs.args;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          Object.assign(cleanArgs, nested);
          delete cleanArgs.arguments;
          delete cleanArgs.parameters;
          delete cleanArgs.params;
          delete cleanArgs.args;
        }
      } else if (serverTools.length > 0) {
        // 2. Intelligent inference: if target server has list_projects and caller passed no tool name
        const listProjTool = serverTools.find((t) => t.name === 'list_projects');
        if (listProjTool && (Object.keys(cleanArgs).length === 0 || cleanArgs.name === undefined)) {
          actualToolName = 'list_projects';
        } else {
          return {
            toolName,
            args,
            serverName: targetServer.name,
            serverUrl: targetServer.url,
            isError: true,
            latencyMs: 0,
            result: `Ошибка вызова MCP: "${toolName}" — это имя сервера, а не инструмента.\nДоступные инструменты сервера "${targetServer.name}":\n` +
              serverTools.map((t) => `- ${t.name}: ${t.description || 'нет описания'}`).join('\n') +
              `\n\nДля вызова используйте точное имя инструмента, например: <mcp_call name="${serverTools[0]?.name || 'tool_name'}">{}</mcp_call>`,
          };
        }
      }
    }

    const res = await callMcpTool(targetServer, actualToolName, cleanArgs);

    return {
      toolName: actualToolName,
      args: cleanArgs,
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
      const tools = this.serverToolsMap.get(server.id) || server.tools || [];
      lines.push(`\n### MCP Server: "${server.name}" (${server.url})`);

      if (tools.length > 0) {
        for (const t of tools) {
          if (!t || typeof t !== 'object') continue;
          const requiredList = Array.isArray(t.inputSchema?.required)
            ? t.inputSchema.required
            : typeof t.inputSchema?.required === 'string'
            ? [t.inputSchema.required]
            : [];
          const reqStr =
            requiredList.length > 0
              ? ` [required: ${requiredList.join(', ')}]`
              : '';
          const descStr =
            typeof t.description === 'string'
              ? t.description
              : t.description
              ? JSON.stringify(t.description)
              : 'Нет описания';
          lines.push(`- \`${t.name || 'unknown'}\`${reqStr}: ${descStr}`);
        }
      } else {
        const isMockLogistics =
          server.id === 'mcp-logistics-server' ||
          server.id.includes('day18') ||
          server.name.toLowerCase().includes('scheduler') ||
          (server.url.includes(':3002') && server.name.toLowerCase().includes('логист'));
        const isMockAnalytics =
          server.id === 'mcp-analytics-server' ||
          server.id.includes('day19') ||
          server.name.toLowerCase().includes('pipeline') ||
          (server.url.includes(':3003') && server.name.toLowerCase().includes('аналитик'));
        const isMockCatalog =
          server.id === 'mcp-catalog-server' ||
          server.id.includes('day17') ||
          server.name.toLowerCase().includes('mock store') ||
          (server.url.includes(':3001') &&
            (server.name.toLowerCase().includes('каталог') ||
              server.name.toLowerCase().includes('склад')));

        if (isMockLogistics) {
          lines.push(`- \`order_get_status\` [required: order_id]: Проверить статус и трекинг заказа`);
          lines.push(`- \`delivery_calculate_cost\` [required: city]: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`- \`schedule_monitor\` [required: interval_seconds]: Запланировать фоновый мониторинг`);
          lines.push(`- \`get_aggregated_summary\`: Получить агрегированную аналитическую сводку фонового мониторинга`);
        } else if (isMockAnalytics) {
          lines.push(`- \`search\` [required: query]: Поиск информации в каталоге для аналитического пайплайна`);
          lines.push(`- \`summarize\`: Аналитическая выжимка, расчет метрик и рекомендаций (markdown/json)`);
          lines.push(`- \`saveToFile\` [required: content]: Сохранение отчета на диск в каталог data/reports`);
          lines.push(`- \`get_aggregated_summary\`: Агрегированная сводка фонового мониторинга`);
        } else if (isMockCatalog) {
          lines.push(`- \`store_search_products\`: Поиск товаров в каталоге интернет-магазина (query, category, max_price)`);
          lines.push(`- \`store_get_product\` [required: sku]: Данные о товаре по SKU (цена, характеристики, склад, остаток)`);
          lines.push(`- \`order_get_status\` [required: order_id]: Проверить статус и трекинг заказа`);
          lines.push(`- \`delivery_calculate_cost\` [required: city]: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`- \`schedule_monitor\` [required: interval_seconds]: Запланировать фоновый мониторинг`);
          lines.push(`- \`get_aggregated_summary\`: Получить агрегированную аналитическую сводку фонового мониторинга`);
          lines.push(`- \`calculate\` [required: expression]: Вычислить математическое выражение`);
          lines.push(`- \`get_system_time\`: Текущее время сервера`);
        } else {
          lines.push(`- *(Инструменты еще не загружены или сервер недоступен)*`);
        }
      }
    }

    lines.push(`\n[MULTI-SERVER WORKFLOW & CALL FORMAT]:`);
    lines.push(`To call any tool, output the following XML tag:`);
    lines.push(`<mcp_call name="exact_tool_name">`);
    lines.push(`{"param1": "value1"}`);
    lines.push(`</mcp_call>`);
    lines.push(``);
    lines.push(`CRITICAL RULES FOR CALLING TOOLS:`);
    lines.push(`1. The 'name' attribute in <mcp_call name="..."> MUST be the EXACT tool name from the list above (for example: name="list_projects" or name="store_search_products").`);
    lines.push(`2. NEVER write name="mcp_call", name="tool_call" or the server name. The 'name' attribute MUST be the specific tool name: e.g. <mcp_call name="list_projects">{}</mcp_call>.`);
    lines.push(`3. NEVER wrap the tool name inside JSON arguments as {"name": "..."}. Arguments must only contain parameters needed by the tool.`);
    lines.push(`4. If a tool takes no arguments, pass an empty JSON object: {}`);
    lines.push(`5. For complex requests, execute calls sequentially across servers until the goal is achieved, then formulate the final user response.`);

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
