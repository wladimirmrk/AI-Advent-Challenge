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

      const isFilesServer =
        server.id === 'mcp-files-server' ||
        (server.url.includes(':3007') && server.name.toLowerCase().includes('file'));
      if (
        isFilesServer &&
        [
          'list_project_files',
          'read_project_file',
          'search_project_files',
          'write_project_file',
          'patch_project_file',
          'get_file_diff',
        ].includes(toolName)
      ) {
        this.toolRoutes.set(toolName, server);
        return server;
      }

      const isGitBranchServer =
        server.id === 'mcp-git-branch-server' ||
        (server.url.includes(':3005') && server.name.toLowerCase().includes('branch'));
      if (isGitBranchServer && toolName === 'get_current_git_branch') {
        this.toolRoutes.set(toolName, server);
        return server;
      }

      const isRagServer =
        server.id === 'mcp-rag-server' ||
        (server.url.includes(':3006') && server.name.toLowerCase().includes('rag'));
      if (isRagServer && toolName === 'rag_search_structural') {
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
   * Adapts and normalizes raw tool arguments based on the target tool's inputSchema:
   * 1. Preserves existing parameters matching declared schema properties (with type coercion).
   * 2. Maps invented/alias parameters to existing schema properties (e.g. directory -> subpath, text -> content, orderId -> order_id).
   * 3. Contextually extracts and substitutes missing parameters from user request (userContext).
   * 4. Prunes unmapped hallucinated keys so the MCP server receives clean, valid schema parameters.
   */
  public adaptToolArguments(
    toolInfo: McpToolInfo | undefined,
    rawArgs: Record<string, unknown> = {},
    userContext?: string
  ): Record<string, unknown> {
    if (!toolInfo || !toolInfo.inputSchema?.properties) {
      return { ...rawArgs };
    }

    const properties = toolInfo.inputSchema.properties;
    const declaredKeys = Object.keys(properties);
    if (declaredKeys.length === 0) {
      return {};
    }

    const requiredList = Array.isArray(toolInfo.inputSchema.required)
      ? toolInfo.inputSchema.required
      : typeof toolInfo.inputSchema.required === 'string'
      ? [toolInfo.inputSchema.required]
      : [];

    const resultArgs: Record<string, unknown> = {};
    const unhandledRaw: Record<string, unknown> = {};

    // Helper: Coerce value to expected schema type
    const coerceType = (val: unknown, propSchema: any): unknown => {
      if (val === undefined || val === null) return val;
      const expectedType = propSchema?.type;
      if (expectedType === 'number') {
        if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
          return Number(val);
        }
      } else if (expectedType === 'boolean') {
        if (typeof val === 'string') {
          if (val.toLowerCase() === 'true') return true;
          if (val.toLowerCase() === 'false') return false;
        }
      } else if (expectedType === 'string') {
        if (typeof val !== 'string' && typeof val !== 'object') {
          return String(val);
        }
      }
      return val;
    };

    // Step 1: Direct matches
    for (const [k, v] of Object.entries(rawArgs)) {
      if (declaredKeys.includes(k)) {
        resultArgs[k] = coerceType(v, properties[k]);
      } else {
        unhandledRaw[k] = v;
      }
    }

    // Step 2: Semantic and synonym mappings for invented / alias keys
    // Maps canonical schema key to known invented/alias names
    const COMMON_ALIASES: Record<string, string[]> = {
      subpath: ['directory', 'dir', 'folder', 'path', 'location', 'subfolder', 'folder_path', 'dir_path', 'target_dir'],
      filePath: ['path', 'file', 'filename', 'file_path', 'filepath', 'target_file', 'doc', 'document', 'file_name'],
      content: ['text', 'body', 'data', 'code', 'file_content', 'fileContent', 'content_text', 'payload'],
      query: ['search', 'keyword', 'keywords', 'q', 'search_term', 'term', 'find', 'prompt', 'text'],
      sku: ['sku_code', 'skuId', 'productId', 'product_id', 'id', 'item_id', 'code', 'product_sku'],
      order_id: ['orderId', 'order', 'id', 'order_number', 'orderNo', 'order_num'],
      city: ['destination', 'town', 'address', 'location', 'cityName', 'city_name'],
      max_price: ['maxPrice', 'price', 'budget', 'limit_price', 'cost', 'max_cost'],
      category: ['cat', 'category_name', 'genre', 'type'],
      interval_seconds: ['interval', 'seconds', 'period', 'delay', 'intervalSeconds'],
      delay_seconds: ['delay', 'delaySeconds'],
      limit: ['maxResults', 'max_results', 'count', 'max', 'limit_count'],
      pattern: ['mask', 'filter', 'regex', 'extension', 'glob', 'wildcard'],
      startLine: ['start_line', 'start', 'from_line', 'line_start'],
      endLine: ['end_line', 'end', 'to_line', 'line_end'],
      searchString: ['search_string', 'search', 'target', 'old_text', 'oldText'],
      replaceString: ['replace_string', 'replace', 'replacement', 'new_text', 'newText'],
    };

    for (const [rawKey, rawVal] of Object.entries(unhandledRaw)) {
      let matchedProp: string | null = null;

      // 2a. Case-insensitive / snake_case / camelCase normalization
      const cleanRawKey = rawKey.toLowerCase().replace(/[\s_-]+/g, '');
      for (const prop of declaredKeys) {
        const cleanProp = prop.toLowerCase().replace(/[\s_-]+/g, '');
        if (cleanRawKey === cleanProp) {
          matchedProp = prop;
          break;
        }
      }

      // 2b. Known semantic aliases lookup
      if (!matchedProp) {
        for (const prop of declaredKeys) {
          const aliases = COMMON_ALIASES[prop];
          if (aliases && aliases.some((a) => a.toLowerCase() === rawKey.toLowerCase() || a.toLowerCase().replace(/[\s_-]+/g, '') === cleanRawKey)) {
            matchedProp = prop;
            break;
          }
        }
      }

      // 2c. Schema description match: check if parameter description contains this raw key
      if (!matchedProp) {
        for (const prop of declaredKeys) {
          const desc = String(properties[prop]?.description || '').toLowerCase();
          if (desc.includes(rawKey.toLowerCase())) {
            matchedProp = prop;
            break;
          }
        }
      }

      // If matched and destination is not already set
      if (matchedProp && (resultArgs[matchedProp] === undefined || resultArgs[matchedProp] === null || resultArgs[matchedProp] === '')) {
        resultArgs[matchedProp] = coerceType(rawVal, properties[matchedProp]);
      }
    }

    // Step 3: Contextual extraction and substitution from user request (userContext)
    if (userContext && typeof userContext === 'string' && userContext.trim()) {
      const uText = userContext.trim();

      for (const prop of declaredKeys) {
        // Only attempt extraction if parameter is not yet provided or empty
        if (resultArgs[prop] !== undefined && resultArgs[prop] !== null && resultArgs[prop] !== '') {
          continue;
        }

        // Subpath / directory extraction
        if (prop === 'subpath') {
          const subpathMatch =
            uText.match(/(?:в\s+папк[еуа]|в\s+каталог[еа]|в\s+директори[ию]|папк[аеу]|каталог[еа]?|директори[яию]|каталоге|подпапк[еа])[:\s]+["'`]?([a-zA-Z0-9_./-]+)["'`]?/i) ||
            uText.match(/["'`]((?:docs|core|feature|src|data)[a-zA-Z0-9_./-]*)["'`]/i) ||
            uText.match(/\b((?:docs|core|feature|src|data)\/[a-zA-Z0-9_./-]+)\b/i);
          if (subpathMatch && subpathMatch[1]) {
            resultArgs[prop] = subpathMatch[1].trim();
          }
        }

        // filePath extraction
        if (prop === 'filePath') {
          const fpMatch =
            uText.match(/(?:файл[еа]?|file)[:\s]+["'`]?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)["'`]?/i) ||
            uText.match(/\b([a-zA-Z0-9_./-]+\.(?:md|kt|kts|ts|tsx|json|txt|ya?ml))\b/i) ||
            uText.match(/["'`]?([a-zA-Z0-9_./-]*ADR-\d+-[a-zA-Z0-9_./-]*\.md)["'`]?/i);
          if (fpMatch && fpMatch[1]) {
            resultArgs[prop] = fpMatch[1].trim();
          }
        }

        // SKU extraction
        if (prop === 'sku') {
          const skuMatch = uText.match(/\b([A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/);
          if (skuMatch && skuMatch[1] && !skuMatch[1].startsWith('ORD-') && !skuMatch[1].startsWith('ADR-')) {
            resultArgs[prop] = skuMatch[1].trim();
          }
        }

        // order_id extraction
        if (prop === 'order_id') {
          const orderMatch = uText.match(/\b(ORD-\d+)\b/i) || uText.match(/(?:заказ[а-я]*|номер)\s*#?\s*([A-Za-z0-9_-]+)/i);
          if (orderMatch && orderMatch[1]) {
            resultArgs[prop] = orderMatch[1].trim();
          }
        }

        // city extraction
        if (prop === 'city') {
          const cityMatch =
            uText.match(/(?:в|до|город[еа]?)\s+([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)/) ||
            uText.match(/\b(Москва|Санкт-Петербург|Казань|Новосибирск|Екатеринбург|Нижний Новгород|Самара|Омск|Челябинск|Ростов-на-Дону|Уфа|Красноярск|Воронеж|Пермь|Волгоград)\b/i);
          if (cityMatch && cityMatch[1]) {
            resultArgs[prop] = cityMatch[1].trim();
          }
        }

        // max_price extraction
        if (prop === 'max_price') {
          const priceMatch = uText.match(/(?:до|не\s+дороже|не\s+выше|максимум|бюджет)\s*[:\s]*(\d+[\d\s]*)\s*(?:руб|р|\$|€)?/i);
          if (priceMatch && priceMatch[1]) {
            const num = Number(priceMatch[1].replace(/\s+/g, ''));
            if (!isNaN(num) && num > 0) {
              resultArgs[prop] = num;
            }
          }
        }

        // interval_seconds extraction
        if (prop === 'interval_seconds') {
          const secMatch = uText.match(/(?:каждые|интервал|период)\s*[:\s]*(\d+)\s*(?:сек|секунд)/i);
          if (secMatch && secMatch[1]) {
            const num = Number(secMatch[1]);
            if (!isNaN(num) && num > 0) {
              resultArgs[prop] = num;
            }
          }
        }

        // query extraction (if required and missing)
        if (prop === 'query' && requiredList.includes('query')) {
          const queryMatch =
            uText.match(/(?:найди|поиск|ищи|найти|search)\s+(?:информацию\s+о\s+|информацию\s+про\s+|товары?\s+|по\s+)?["'`]?([^"'`.,\n]+)["'`]?/i);
          if (queryMatch && queryMatch[1]) {
            resultArgs[prop] = queryMatch[1].trim();
          } else {
            resultArgs[prop] = uText.slice(0, 100).trim();
          }
        }
      }
    }

    return resultArgs;
  }

  /**
   * Executes tool with targeted routing and returns enriched McpCallMeta.
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    servers?: McpServerConfig[],
    userContext?: string
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

    // Resolve target tool info from discovered tools
    const targetTool = serverTools.find((t) => t.name === actualToolName);

    // Adapt raw arguments: map aliases, substitute from user request, and strip hallucinated keys
    const adaptedArgs = this.adaptToolArguments(targetTool, cleanArgs, userContext);

    const res = await callMcpTool(targetServer, actualToolName, adaptedArgs);

    return {
      toolName: actualToolName,
      args: adaptedArgs,
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
          const descStr =
            typeof t.description === 'string'
              ? t.description
              : t.description
              ? JSON.stringify(t.description)
              : 'Нет описания';
          lines.push(`- \`${t.name || 'unknown'}\`: ${descStr}`);

          const props = t.inputSchema?.properties;
          if (props && typeof props === 'object' && Object.keys(props).length > 0) {
            lines.push(`  Parameters:`);
            for (const [propName, propDef] of Object.entries(props)) {
              const isReq = requiredList.includes(propName);
              const pType =
                propDef && typeof propDef === 'object' && propDef.type
                  ? String(propDef.type)
                  : 'any';
              const pDesc =
                propDef && typeof propDef === 'object' && propDef.description
                  ? ` - ${propDef.description}`
                  : '';
              const pEnum =
                propDef && typeof propDef === 'object' && Array.isArray(propDef.enum)
                  ? ` [enum: ${propDef.enum.join(', ')}]`
                  : '';
              const pDefault =
                propDef && typeof propDef === 'object' && propDef.default !== undefined
                  ? ` (default: ${JSON.stringify(propDef.default)})`
                  : '';
              lines.push(
                `    * \`${propName}\` (${pType}, ${isReq ? 'REQUIRED' : 'optional'})${pDefault}${pEnum}${pDesc}`
              );
            }
          } else {
            lines.push(`  Parameters: none (use empty arguments {})`);
          }
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
          lines.push(`- \`order_get_status\`: Проверить статус и трекинг заказа клиента`);
          lines.push(`  Parameters:\n    * \`order_id\` (string, REQUIRED) - Номер заказа (например: ORD-7741)`);
          lines.push(`- \`delivery_calculate_cost\`: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`  Parameters:\n    * \`city\` (string, REQUIRED) - Город назначения\n    * \`isExpress\` (boolean, optional) - Экспресс доставка`);
          lines.push(`- \`schedule_monitor\`: Запланировать фоновый мониторинг`);
          lines.push(`  Parameters:\n    * \`interval_seconds\` (number, REQUIRED) - Интервал опроса в секундах\n    * \`target\` (string, optional) - products, orders или all`);
          lines.push(`- \`get_aggregated_summary\`: Получить агрегированную аналитическую сводку`);
          lines.push(`  Parameters:\n    * \`target\` (string, optional) - products, orders или all`);
        } else if (isMockAnalytics) {
          lines.push(`- \`search\`: Поиск информации в каталоге для аналитического пайплайна`);
          lines.push(`  Parameters:\n    * \`query\` (string, REQUIRED) - Поисковый запрос`);
          lines.push(`- \`summarize\`: Аналитическая выжимка, расчет метрик и рекомендаций (markdown/json)`);
          lines.push(`  Parameters: none (use empty arguments {})`);
          lines.push(`- \`saveToFile\`: Сохранение отчета на диск в каталог data/reports`);
          lines.push(`  Parameters:\n    * \`content\` (string, REQUIRED) - Содержимое файла отчета\n    * \`filename\` (string, optional) - Имя файла`);
          lines.push(`- \`get_aggregated_summary\`: Агрегированная сводка фонового мониторинга`);
          lines.push(`  Parameters:\n    * \`target\` (string, optional) - products, orders или all`);
        } else if (isMockCatalog) {
          lines.push(`- \`store_search_products\`: Поиск товаров в каталоге интернет-магазина`);
          lines.push(`  Parameters:\n    * \`query\` (string, optional) - Поисковый запрос\n    * \`category\` (string, optional) [enum: smartphones, laptops, audio, wearables, accessories]\n    * \`max_price\` (number, optional) - Максимальная цена в рублях`);
          lines.push(`- \`store_get_product\`: Данные о товаре по SKU (цена, характеристики, склад, остаток)`);
          lines.push(`  Parameters:\n    * \`sku\` (string, REQUIRED) - Артикул товара (например: PHONE-15-PRO)`);
          lines.push(`- \`order_get_status\`: Проверить статус и трекинг заказа`);
          lines.push(`  Parameters:\n    * \`order_id\` (string, REQUIRED) - Номер заказа (например: ORD-7741)`);
          lines.push(`- \`delivery_calculate_cost\`: Рассчитать стоимость и срок доставки курьером`);
          lines.push(`  Parameters:\n    * \`city\` (string, REQUIRED) - Город назначения`);
          lines.push(`- \`schedule_monitor\`: Запланировать фоновый мониторинг`);
          lines.push(`  Parameters:\n    * \`interval_seconds\` (number, REQUIRED) - Интервал опроса в секундах`);
          lines.push(`- \`get_aggregated_summary\`: Получить агрегированную аналитическую сводку`);
          lines.push(`  Parameters: none (use empty arguments {})`);
          lines.push(`- \`calculate\`: Вычислить математическое выражение`);
          lines.push(`  Parameters:\n    * \`expression\` (string, REQUIRED) - Математическое выражение`);
          lines.push(`- \`get_system_time\`: Текущее время сервера`);
          lines.push(`  Parameters: none (use empty arguments {})`);
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
    lines.push(`1. The 'name' attribute in <mcp_call name="..."> MUST be the EXACT tool name from the list above (for example: name="list_project_files" or name="search_project_files").`);
    lines.push(`2. NEVER write name="mcp_call", name="tool_call" or the server name. The 'name' attribute MUST be the specific tool name: e.g. <mcp_call name="search_project_files">{"query": "SafeApiCall"}</mcp_call>.`);
    lines.push(`3. NEVER invent, hallucinate, or rename parameter keys! You MUST ONLY use the EXACT parameter names defined under each tool's "Parameters" section above.`);
    lines.push(`   - For example: if the tool defines \`subpath\`, use \`subpath\` (DO NOT use \`directory\`, \`folder\`, \`dir\`, or \`path\`).`);
    lines.push(`   - If the tool defines \`query\`, use \`query\` (DO NOT use \`search\` or \`keyword\`).`);
    lines.push(`   - If the tool defines \`sku\`, use \`sku\` (DO NOT use \`id\` or \`product_id\`).`);
    lines.push(`   - If the tool defines \`filePath\`, use \`filePath\` (DO NOT use \`file\` or \`path\`).`);
    lines.push(`   - If the tool defines \`content\`, use \`content\` (DO NOT use \`text\` or \`body\`).`);
    lines.push(`4. Extract the relevant values from the user request and supply them directly into the corresponding existing parameters.`);
    lines.push(`5. NEVER pass fabricated or invented parameter names. If a parameter is optional and not needed, omit it.`);
    lines.push(`6. NEVER wrap the tool name inside JSON arguments as {"name": "..."}. Arguments must only contain parameters needed by the tool.`);
    lines.push(`7. If a tool takes no arguments, pass an empty JSON object: {}`);
    lines.push(`8. For complex requests, execute calls sequentially across tools/servers until the goal is achieved, then formulate the final user response.`);
    lines.push(``);
    lines.push(`PROJECT FILES & GOAL-DRIVEN AGENT RULES:`);
    lines.push(`- When the user gives a high-level goal regarding files, code or docs, autonomously initiate the workflow: search -> read relevant files (2-3+ files) -> analyze -> create/patch files -> verify with get_file_diff.`);
    lines.push(`- Do NOT ask the user for permission to open files or search. Immediately call the required tool via <mcp_call name="...">.`);
    lines.push(`- After modifying files, call get_file_diff to inspect your changes, then synthesize a concise and structured final response with file links and diffs.`);

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
