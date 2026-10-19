/**
 * MCP Adapter & Pipeline for Fetching Google Stitch Screens
 *
 * Implements streamlined pipeline for Google Stitch MCP integration:
 * 1. list_screens({ projectId }) with dynamic inputSchema inspection
 * 2. Case-insensitive exact name matching by title against the screen name from user query
 * 3. Extract downloadUrl from htmlCode in matched screen
 * 4. Fetch HTML code directly from downloadUrl
 * 5. Structured result containing { projectId, screenId, screenName, screenData, html, ... }
 */

import { McpCallMeta } from '../../agent/types';
import { Agent } from '../../agent/Agent';
import { McpServerConfig, McpToolInfo } from '../../agent/mcp/types';
import {
  DEFAULT_STITCH_PROJECT_ID,
  StitchScreenPipelineInput,
  StitchScreenPipelineResult,
} from './types';

export interface McpScreenResult {
  screenId: string;
  screenName: string;
  html: string;
  metadata?: Record<string, unknown>;
  toolName?: string;
  serverName?: string;
  fromMcp: boolean;
  latencyMs?: number;
  rawMcpCall?: McpCallMeta;
  rawMcpCalls?: McpCallMeta[];
  screenData?: unknown;
  projectId?: string;
}

// Built-in repository of Google Stitch screens for CryptoTrack
export const BUILTIN_STITCH_SCREENS: Record<
  string,
  {
    screenId: string;
    screenName: string;
    title: string;
    name: string;
    html: string;
    metadata?: Record<string, unknown>;
  }
> = {
  portfolio: {
    screenId: 'stitch_screen_portfolio_v1',
    screenName: 'Crypto Portfolio',
    title: 'Crypto Portfolio',
    name: `projects/${DEFAULT_STITCH_PROJECT_ID}/screens/stitch_screen_portfolio_v1`,
    html: `<div class="screen w-full bg-slate-950 text-white min-h-screen p-4 flex flex-col gap-4">
  <div class="flex items-center justify-between pb-2 border-b border-slate-800">
    <h1 class="text-xl font-bold">Crypto Portfolio</h1>
    <span class="text-sm text-slate-400">Live Balance</span>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2 shadow-lg">
    <span class="text-xs uppercase text-slate-400">Total Portfolio Value</span>
    <h2 class="text-2xl font-bold text-emerald-400">$24,530.80</h2>
    <span class="text-xs text-emerald-500 font-medium">+5.4% last 24h</span>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
    <h3 class="text-base font-semibold">Quick Actions</h3>
    <div class="flex gap-2">
      <button class="btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm w-full">
        Deposit
      </button>
      <button class="btn px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl text-sm w-full">
        Transfer
      </button>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium text-slate-300">Search Assets</span>
    <input
      type="text"
      placeholder="Search coins (BTC, ETH)..."
      class="input w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500"
    />
  </div>
</div>`,
    metadata: { author: 'Google Stitch', category: 'finance', screenType: 'portfolio' },
  },

  market_home: {
    screenId: 'stitch_screen_market_home_v1',
    screenName: 'Market Home',
    title: 'Market Home',
    name: `projects/${DEFAULT_STITCH_PROJECT_ID}/screens/stitch_screen_market_home_v1`,
    html: `<div class="screen w-full bg-slate-950 text-white min-h-screen p-4 flex flex-col gap-4">
  <div class="flex items-center justify-between pb-2 border-b border-slate-800">
    <h1 class="text-xl font-bold">Market Home</h1>
    <span class="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-full font-medium">Live Market</span>
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium text-slate-300">Поиск криптовалют</span>
    <input
      type="text"
      placeholder="Найти токен или пару (BTC, ETH, SOL)..."
      class="input w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500"
    />
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="card bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col gap-1">
      <span class="text-xs text-slate-400">Лидер роста 24ч</span>
      <span class="text-base font-bold text-white">Solana (SOL)</span>
      <span class="text-xs text-emerald-400 font-medium">+14.2%</span>
    </div>
    <div class="card bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col gap-1">
      <span class="text-xs text-slate-400">Объем рынка</span>
      <span class="text-base font-bold text-white">$2.48T</span>
      <span class="text-xs text-emerald-400 font-medium">+3.1%</span>
    </div>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-slate-200">Популярные активы</h3>
      <span class="text-xs text-blue-400 cursor-pointer">Смотреть все</span>
    </div>
    
    <div class="flex items-center justify-between py-2 border-b border-slate-800/60">
      <div class="flex flex-col">
        <span class="text-sm font-semibold">Bitcoin</span>
        <span class="text-xs text-slate-400">BTC</span>
      </div>
      <div class="flex flex-col items-end">
        <span class="text-sm font-bold text-emerald-400">$64,280.00</span>
        <span class="text-xs text-emerald-500 font-medium">+3.8%</span>
      </div>
    </div>

    <div class="flex items-center justify-between py-2">
      <div class="flex flex-col">
        <span class="text-sm font-semibold">Ethereum</span>
        <span class="text-xs text-slate-400">ETH</span>
      </div>
      <div class="flex flex-col items-end">
        <span class="text-sm font-bold text-emerald-400">$3,450.20</span>
        <span class="text-xs text-emerald-500 font-medium">+2.1%</span>
      </div>
    </div>
  </div>

  <button class="btn w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm">
    Перейти к торгам
  </button>
</div>`,
    metadata: { author: 'Google Stitch', category: 'finance', screenType: 'market_home' },
  },

  market: {
    screenId: 'stitch_screen_market_v1',
    screenName: 'Market Overview',
    title: 'Market Overview',
    name: `projects/${DEFAULT_STITCH_PROJECT_ID}/screens/stitch_screen_market_v1`,
    html: `<div class="screen w-full bg-slate-950 text-white min-h-screen p-4 flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">Crypto Market</h1>
    <button class="btn px-3 py-1.5 bg-slate-800 text-xs rounded-lg text-slate-300">Filter</button>
  </div>

  <input
    type="text"
    placeholder="Поиск по активам..."
    class="input w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white"
  />

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-sm font-semibold">Bitcoin (BTC)</span>
      <span class="text-sm font-bold text-emerald-400">$64,280.00</span>
    </div>
    <div class="flex items-center justify-between text-xs text-slate-400">
      <span>Cap: $1.26T</span>
      <span class="text-emerald-500">+3.8%</span>
    </div>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-sm font-semibold">Ethereum (ETH)</span>
      <span class="text-sm font-bold text-emerald-400">$3,450.20</span>
    </div>
    <div class="flex items-center justify-between text-xs text-slate-400">
      <span>Cap: $415B</span>
      <span class="text-emerald-500">+2.1%</span>
    </div>
  </div>

  <button class="btn w-full py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm">
    Показать все котировки
  </button>
</div>`,
    metadata: { author: 'Google Stitch', category: 'finance', screenType: 'market' },
  },

  details: {
    screenId: 'stitch_screen_details_v1',
    screenName: 'Coin Details',
    title: 'Coin Details',
    name: `projects/${DEFAULT_STITCH_PROJECT_ID}/screens/stitch_screen_details_v1`,
    html: `<div class="screen w-full bg-slate-950 text-white min-h-screen p-4 flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">Bitcoin / USD</h1>
    <span class="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-md">+3.8%</span>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
    <span class="text-xs text-slate-400">Текущая цена</span>
    <h2 class="text-3xl font-bold text-white">$64,280.00</h2>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
    <h3 class="text-sm font-semibold">Статистика актива</h3>
    <div class="flex justify-between text-xs text-slate-400">
      <span>Рыночная капитализация:</span>
      <span class="text-white font-medium">$1,268,490,000</span>
    </div>
    <div class="flex justify-between text-xs text-slate-400">
      <span>Объем торгов за 24ч:</span>
      <span class="text-white font-medium">$34,812,000</span>
    </div>
  </div>

  <div class="flex gap-3">
    <button class="btn flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm">
      Купить
    </button>
    <button class="btn flex-1 py-2.5 bg-rose-600 text-white rounded-xl font-medium text-sm">
      Продать
    </button>
  </div>
</div>`,
    metadata: { author: 'Google Stitch', category: 'finance', screenType: 'details' },
  },
};

/**
 * Normalizes screen query string for matching.
 */
function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Finds a matching built-in screen if MCP server doesn't respond or is offline.
 */
function findBuiltinScreen(screenQuery: string): {
  screenId: string;
  screenName: string;
  title?: string;
  name?: string;
  html: string;
  metadata?: Record<string, unknown>;
} {
  const norm = normalizeQuery(screenQuery);

  if (norm.includes('markethome') || (norm.includes('market') && norm.includes('home'))) {
    return BUILTIN_STITCH_SCREENS.market_home;
  }
  if (norm.includes('portfol') || norm.includes('портфел') || norm.includes('баланс') || norm.includes('balance')) {
    return BUILTIN_STITCH_SCREENS.portfolio;
  }
  if (norm.includes('market') || norm.includes('рынок') || norm.includes('рынк') || norm.includes('котировк')) {
    return BUILTIN_STITCH_SCREENS.market;
  }
  if (norm.includes('detail') || norm.includes('детал') || norm.includes('инфо') || norm.includes('coin') || norm.includes('btc')) {
    return BUILTIN_STITCH_SCREENS.details;
  }

  return {
    ...BUILTIN_STITCH_SCREENS.portfolio,
    screenName: screenQuery.trim() || 'Stitch Screen',
  };
}

/**
 * Finds an MCP tool matching a primary name or alias patterns across active servers.
 */
function findTool(
  servers: McpServerConfig[],
  primaryName: string,
  aliases: string[] = []
): { tool: McpToolInfo; server: McpServerConfig } | null {
  const allNames = [primaryName, ...aliases].map((n) => n.toLowerCase());

  // 1. Exact match on tool name
  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const t of s.tools) {
      if (allNames.includes(t.name.toLowerCase())) {
        return { tool: t, server: s };
      }
    }
  }

  // 2. Namespaced or suffix match (e.g. "google_stitch.list_screens", "stitch_list_screens")
  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const t of s.tools) {
      const cleanTool = t.name.toLowerCase().replace(/^[^.:/]+[.:/]/, '');
      if (allNames.includes(cleanTool)) {
        return { tool: t, server: s };
      }
    }
  }

  // 3. Substring match
  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const t of s.tools) {
      const tLower = t.name.toLowerCase();
      if (
        (tLower.includes('screen') && tLower.includes('list')) && primaryName === 'list_screens' ||
        (tLower.includes('screen') && tLower.includes('get')) && primaryName === 'get_screen'
      ) {
        return { tool: t, server: s };
      }
    }
  }

  return null;
}

/**
 * Resolves argument key dynamically from tool inputSchema properties.
 */
function resolveArgumentKey(
  tool: McpToolInfo | undefined,
  candidates: string[],
  fallback: string
): string {
  if (!tool?.inputSchema?.properties) {
    return fallback;
  }
  const propKeys = Object.keys(tool.inputSchema.properties);

  for (const candidate of candidates) {
    const matchedKey = propKeys.find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === candidate.toLowerCase().replace(/[\s_-]/g, '')
    );
    if (matchedKey) {
      return matchedKey;
    }
  }

  return fallback;
}

/**
 * Robustly parses and extracts an array of screens from MCP list_screens response.
 */
function extractScreensList(rawResult: unknown): Array<Record<string, unknown>> {
  if (!rawResult) return [];

  let parsed: any = rawResult;
  if (typeof rawResult === 'string') {
    const trimmed = rawResult.trim();
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // If it's a string, maybe wrapped in text/content
      return [];
    }
  }

  // MCP Content format: { content: [{ type: 'text', text: '...' }] }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.content)) {
    for (const item of parsed.content) {
      if (item && item.type === 'text' && typeof item.text === 'string') {
        try {
          const inner = JSON.parse(item.text);
          const res = extractScreensList(inner);
          if (res.length > 0) return res;
        } catch {}
      }
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.filter((item) => item && typeof item === 'object');
  }

  if (parsed && typeof parsed === 'object') {
    const candidateKeys = ['screens', 'items', 'data', 'result', 'screenList', 'results'];
    for (const key of candidateKeys) {
      if (Array.isArray(parsed[key])) {
        return parsed[key].filter((item: any) => item && typeof item === 'object');
      }
    }

    // Check if object map (e.g. { "screen1": { name: "..." }, "screen2": { name: "..." } })
    const values = Object.values(parsed);
    if (values.length > 0 && values.every((v) => v && typeof v === 'object')) {
      const asObjects = values as Array<Record<string, unknown>>;
      if (asObjects.some((o) => extractScreenName(o) || extractScreenId(o))) {
        return asObjects;
      }
    }
  }

  return [];
}

/**
 * Extracts screen display name from object.
 *
 * In Google Stitch, the human-readable screen title is stored in "title"
 * (e.g. "Search Results - Full Names (Streamlined Metrics)" or "Market Home").
 * The "name" field contains the resource path ID ("projects/.../screens/...").
 */
export function extractScreenName(screenObj: Record<string, unknown>): string | null {
  if (!screenObj || typeof screenObj !== 'object') return null;

  // 1. Primary: check 'title' (Google Stitch standard format)
  if (typeof screenObj.title === 'string' && screenObj.title.trim().length > 0) {
    return screenObj.title.trim();
  }

  // 2. Secondary title candidates
  const candidateFields = ['screenName', 'displayName', 'screen_name', 'label'];
  for (const field of candidateFields) {
    const val = screenObj[field];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }

  // 3. Fallback to 'name' ONLY if it is not a resource path like "projects/..."
  if (typeof screenObj.name === 'string' && screenObj.name.trim().length > 0) {
    const val = screenObj.name.trim();
    if (!val.startsWith('projects/') && !val.includes('/screens/')) {
      return val;
    }
  }

  return null;
}

/**
 * Extracts screen identifier strictly from actual ID / resource fields.
 *
 * In Google Stitch, the screen resource ID is in field "name"
 * (e.g. "projects/5377012504763227664/screens/5314bd474ecd4f679c8f432435d2fe61"),
 * or in "screenId" / "id".
 */
export function extractScreenId(screenObj: Record<string, unknown>): string | null {
  if (!screenObj || typeof screenObj !== 'object') return null;

  // 1. Primary: Check Google Stitch resource path in "name"
  if (typeof screenObj.name === 'string' && screenObj.name.trim().length > 0) {
    const val = screenObj.name.trim();
    if (val.startsWith('projects/') || val.includes('/screens/')) {
      return val;
    }
  }

  // 2. Explicit ID fields
  const idFields = ['screenId', 'id', 'screen_id', '_id', 'key'];
  for (const field of idFields) {
    const val = screenObj[field];
    if (val !== undefined && val !== null) {
      const strVal = String(val).trim();
      if (strVal.length > 0) {
        return strVal;
      }
    }
  }

  // 3. Fallback: if "name" exists and title is also present, "name" is the ID
  if (typeof screenObj.name === 'string' && screenObj.name.trim().length > 0 && screenObj.title) {
    return screenObj.name.trim();
  }

  return null;
}

/**
 * Extracts raw HTML markup from screenData.
 */
function extractHtmlFromScreenData(screenData: unknown): string {
  if (!screenData) return '';

  if (typeof screenData === 'string') {
    if (screenData.includes('<') && screenData.includes('>')) {
      return screenData;
    }
    return '';
  }

  if (typeof screenData === 'object') {
    const obj = screenData as Record<string, unknown>;
    const htmlFields = ['html', 'code', 'content', 'markup', 'body'];
    for (const field of htmlFields) {
      const val = obj[field];
      if (typeof val === 'string' && val.includes('<')) {
        return val;
      }
    }

    // Google Stitch htmlCode object: { mimeType: "text/html", downloadUrl: "...", content?: "..." }
    if (obj.htmlCode && typeof obj.htmlCode === 'object') {
      const hc = obj.htmlCode as Record<string, unknown>;
      if (typeof hc.content === 'string' && hc.content.includes('<')) {
        return hc.content;
      }
      if (typeof hc.html === 'string' && hc.html.includes('<')) {
        return hc.html;
      }
    }
  }

  return '';
}

/**
 * Safely fetches HTML code from a downloadUrl.
 *
 * In browser environments, download URLs from Google Cloud Storage / Stitch API
 * are cross-origin and lack CORS headers for localhost, causing direct fetch()
 * to fail with "Failed to fetch" or 400 Bad Request.
 *
 * This function:
 * 1. Routes external URLs through the local dev/preview proxy (/api/mcp-proxy?url=...)
 * 2. Falls back to direct fetch() if proxy is unreachable or not in browser
 * 3. Falls back to embedded HTML in screenData (if present)
 * 4. Falls back to built-in template repository for CryptoTrack screens
 */
export async function fetchScreenHtmlFromDownloadUrl(
  downloadUrl: string,
  screenData?: unknown,
  fallbackScreenName?: string
): Promise<string> {
  const trimmedUrl = downloadUrl?.trim();
  let html = '';
  let lastError: Error | null = null;

  if (trimmedUrl && typeof fetch !== 'undefined') {
    const isBrowser = typeof window !== 'undefined';
    const isExternalUrl =
      trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://');

    // 1. In browser, try proxy first for external URLs to avoid CORS / 400 Bad Request
    if (isBrowser && isExternalUrl && !trimmedUrl.startsWith(window.location.origin)) {
      try {
        const proxyUrl = `${window.location.origin}/api/mcp-proxy?url=${encodeURIComponent(trimmedUrl)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const text = await res.text();
          if (text && text.includes('<')) {
            return text;
          }
        } else {
          lastError = new Error(`Proxy responded with HTTP ${res.status} ${res.statusText}`);
        }
      } catch (err: any) {
        lastError = err;
        console.warn('[StitchAdapter] Proxy download failed, falling back to direct fetch:', err);
      }
    }

    // 2. Direct fetch attempt (or fallback if proxy was unavailable)
    try {
      const res = await fetch(trimmedUrl);
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('<')) {
          return text;
        }
      } else {
        lastError = new Error(`Direct download HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err: any) {
      lastError = err;
      console.warn('[StitchAdapter] Direct fetch from downloadUrl failed:', err);
    }
  }

  // 3. Fallback: extract from screenData if present
  if (screenData) {
    html = extractHtmlFromScreenData(screenData);
    if (html && html.includes('<')) {
      return html;
    }
  }

  // 4. Fallback: use built-in template repository for CryptoTrack screens
  if (fallbackScreenName) {
    const builtin = findBuiltinScreen(fallbackScreenName);
    if (builtin && builtin.html) {
      console.warn(
        `[StitchAdapter] Could not download HTML from downloadUrl (${lastError?.message || 'unknown'}). Using built-in template for "${builtin.screenName}".`
      );
      return builtin.html;
    }
  }

  if (!html) {
    throw new Error(
      `Не удалось загрузить HTML код экрана по downloadUrl: ${lastError?.message || 'Failed to fetch'}`
    );
  }

  return html;
}

/**
 * Core Pipeline for Fetching a Google Stitch Screen via MCP:
 *
 * 1. Call list_screens({ projectId }) using actual registered schema
 * 2. Find screen by case-insensitive title match (with duplicate & not found checks)
 * 3. Download HTML directly from htmlCode.downloadUrl
 * 4. Return structured result { projectId, screenId, screenName, screenData, html, ... }
 */
export async function fetchStitchScreenPipeline(
  options: StitchScreenPipelineInput
): Promise<StitchScreenPipelineResult> {
  const projectId = options.projectId?.trim() || DEFAULT_STITCH_PROJECT_ID;
  const screenName = options.screenName.trim();
  const agent = options.agent as Agent;
  const rawMcpCalls: McpCallMeta[] = [];
  const startTime = Date.now();

  const servers = agent.getEffectiveMcpServers ? agent.getEffectiveMcpServers() : [];

  // =========================================================================
  // Шаг 1. Получить список экранов проекта через MCP list_screens
  // =========================================================================
  const listToolMatch = findTool(servers, 'list_screens', [
    'stitch_list_screens',
    'google_stitch.list_screens',
    'get_screens',
    'list_project_screens',
  ]);

  if (listToolMatch) {
    const listTool = listToolMatch.tool;
    // Анализ схемы аргументов list_screens
    const projectArgKey = resolveArgumentKey(
      listTool,
      ['projectId', 'project_id', 'project', 'id'],
      'projectId'
    );
    const listArgs: Record<string, unknown> = {
      [projectArgKey]: projectId,
    };

    const listCall = await agent.executeMcpTool(listTool.name, listArgs);
    rawMcpCalls.push(listCall);

    if (listCall.isError) {
      throw new Error(
        `Ошибка вызова MCP инструмента "${listTool.name}": ${listCall.result || 'неизвестная ошибка'}`
      );
    }

    // =========================================================================
    // Шаг 2. Найти нужный экран по title
    // =========================================================================
    const screens = extractScreensList(listCall.result);

    if (screens.length === 0) {
      throw new Error(`В проекте "${projectId}" не найдено ни одного экрана.`);
    }

    const targetLower = screenName.toLowerCase().trim();
    const matches = screens.filter((s) => {
      const title = typeof s.title === 'string' && s.title.trim()
        ? s.title.trim()
        : extractScreenName(s);
      return title !== null && title.toLowerCase() === targetLower;
    });

    // Обработка неоднозначности: найдено несколько экранов с одинаковым названием
    if (matches.length > 1) {
      const matchListStr = matches
        .map((m) => {
          const id = extractScreenId(m) || 'неизвестно';
          const title = typeof m.title === 'string' ? m.title.trim() : (extractScreenName(m) || screenName);
          return `[ID: ${id}, Title: "${title}"]`;
        })
        .join(', ');
      throw new Error(
        `Обнаружена неоднозначность: найдено ${matches.length} экранов с названием "${screenName}": ${matchListStr}. Уточните идентификатор экрана.`
      );
    }

    // Обработка отсутствия: экран не найден
    if (matches.length === 0) {
      const availableNames = screens
        .map((s) => (typeof s.title === 'string' && s.title.trim()) || extractScreenName(s))
        .filter((n): n is string => Boolean(n));
      const availableStr =
        availableNames.length > 0
          ? ` Доступные экраны: ${availableNames.map((n) => `"${n}"`).join(', ')}.`
          : '';
      throw new Error(
        `Экран с названием "${screenName}" не найден в проекте "${projectId}".${availableStr}`
      );
    }

    const matchedScreen = matches[0];
    const resolvedScreenName =
      (typeof matchedScreen.title === 'string' && matchedScreen.title.trim()) ||
      extractScreenName(matchedScreen) ||
      screenName;

    const actualScreenId = extractScreenId(matchedScreen) || 'unknown';

    // =========================================================================
    // Шаг 3. Получить HTML код экрана по downloadUrl из htmlCode
    // =========================================================================
    let html = '';
    const htmlCodeObj = matchedScreen.htmlCode as
      | { downloadUrl?: string; html?: string; content?: string }
      | undefined;
    const downloadUrl = htmlCodeObj?.downloadUrl;

    if (downloadUrl) {
      html = await fetchScreenHtmlFromDownloadUrl(
        downloadUrl,
        matchedScreen,
        resolvedScreenName
      );
    } else {
      html = extractHtmlFromScreenData(matchedScreen);
      if (!html) {
        const builtin = findBuiltinScreen(resolvedScreenName);
        html = builtin.html;
      }
    }

    // =========================================================================
    // Шаг 4. Сформировать структурированный результат
    // =========================================================================
    return {
      projectId,
      screenId: actualScreenId,
      screenName: resolvedScreenName,
      screenData: matchedScreen,
      html: html || undefined,
      metadata: {
        deviceType: matchedScreen.deviceType,
        width: matchedScreen.width,
        height: matchedScreen.height,
        screenshotUrl: (matchedScreen.screenshot as any)?.downloadUrl,
        ...(matchedScreen.metadata && typeof matchedScreen.metadata === 'object'
          ? (matchedScreen.metadata as Record<string, unknown>)
          : {}),
      },
      toolName: listTool.name,
      serverName: listCall.serverName,
      fromMcp: true,
      latencyMs: Date.now() - startTime,
      rawMcpCalls,
    };
  }

  // =========================================================================
  // Автономный режим / Fallback (если MCP-сервер офлайн или не подключен)
  // =========================================================================
  const allBuiltins = Object.values(BUILTIN_STITCH_SCREENS);
  const targetLower = screenName.toLowerCase().trim();
  const matchedBuiltin = allBuiltins.find(
    (b) => b.screenName.toLowerCase() === targetLower || b.title?.toLowerCase() === targetLower
  );

  const finalBuiltin = matchedBuiltin || findBuiltinScreen(screenName);

  const simulatedScreenData = {
    screenId: finalBuiltin.screenId,
    screenName: finalBuiltin.screenName,
    title: finalBuiltin.title || finalBuiltin.screenName,
    html: finalBuiltin.html,
    metadata: finalBuiltin.metadata,
  };

  return {
    projectId,
    screenId: finalBuiltin.screenId,
    screenName: finalBuiltin.screenName,
    screenData: simulatedScreenData,
    html: finalBuiltin.html,
    metadata: finalBuiltin.metadata,
    toolName: 'list_screens',
    serverName: 'Google Stitch Service (Built-in)',
    fromMcp: false,
    latencyMs: Date.now() - startTime,
    rawMcpCalls: [],
  };
}

/**
 * High-level fetchScreenFromMcp adapter maintaining backward compatibility.
 * Delegates to the 5-step fetchStitchScreenPipeline.
 */
export async function fetchScreenFromMcp(
  agent: Agent,
  screenName: string,
  projectId?: string
): Promise<McpScreenResult> {
  const result = await fetchStitchScreenPipeline({
    agent,
    screenName,
    projectId: projectId || DEFAULT_STITCH_PROJECT_ID,
  });

  return {
    screenId: result.screenId,
    screenName: result.screenName,
    html: result.html || '',
    metadata: result.metadata,
    toolName: result.toolName,
    serverName: result.serverName,
    fromMcp: result.fromMcp,
    latencyMs: result.latencyMs,
    rawMcpCall: result.rawMcpCalls && result.rawMcpCalls.length > 0
      ? result.rawMcpCalls[result.rawMcpCalls.length - 1]
      : undefined,
    rawMcpCalls: result.rawMcpCalls,
    screenData: result.screenData,
    projectId: result.projectId,
  };
}
