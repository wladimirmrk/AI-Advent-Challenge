/**
 * MCP Adapter for Fetching Google Stitch Screens
 *
 * Dynamically queries existing MCP servers via McpRouter to locate screens by name
 * and extract their raw HTML markup and metadata.
 */

import { McpCallMeta } from '../../agent/types';
import { Agent } from '../../agent/Agent';

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
}

// Built-in repository of Google Stitch screens for CryptoTrack
const BUILTIN_STITCH_SCREENS: Record<
  string,
  { screenId: string; screenName: string; html: string; metadata?: Record<string, unknown> }
> = {
  portfolio: {
    screenId: 'stitch_screen_portfolio_v1',
    screenName: 'Crypto Portfolio',
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

  market: {
    screenId: 'stitch_screen_market_v1',
    screenName: 'Market Overview',
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
  html: string;
  metadata?: Record<string, unknown>;
} {
  const norm = normalizeQuery(screenQuery);

  if (norm.includes('portfol') || norm.includes('портфел') || norm.includes('баланс') || norm.includes('balance')) {
    return BUILTIN_STITCH_SCREENS.portfolio;
  }
  if (norm.includes('market') || norm.includes('рынок') || norm.includes('рынк') || norm.includes('котировк')) {
    return BUILTIN_STITCH_SCREENS.market;
  }
  if (norm.includes('detail') || norm.includes('детал') || norm.includes('инфо') || norm.includes('coin') || norm.includes('btc')) {
    return BUILTIN_STITCH_SCREENS.details;
  }

  // Fallback to Portfolio as most feature-rich screen
  return {
    ...BUILTIN_STITCH_SCREENS.portfolio,
    screenName: screenQuery.trim() || 'Stitch Screen',
  };
}

/**
 * Fetches screen HTML and metadata by querying active MCP server tools.
 */
export async function fetchScreenFromMcp(
  agent: Agent,
  screenName: string
): Promise<McpScreenResult> {
  const trimmedName = screenName.trim();
  const servers = agent.getEffectiveMcpServers();
  const startTime = Date.now();

  // Look for any tool that matches screen extraction in active MCP servers
  const candidateTools = [
    'stitch_get_screen',
    'get_screen',
    'get_screen_by_name',
    'find_screen',
    'stitch_find_screen',
    'get_stitch_screen',
    'stitch_export_component',
    'get_screen_html',
  ];

  let resolvedToolName: string | undefined;

  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const t of s.tools) {
      const tLower = t.name.toLowerCase();
      if (
        candidateTools.includes(t.name) ||
        tLower.includes('stitch') ||
        (tLower.includes('screen') && (tLower.includes('get') || tLower.includes('find')))
      ) {
        resolvedToolName = t.name;
        break;
      }
    }
    if (resolvedToolName) break;
  }

  // 1. If an MCP tool is discovered on an active server, call it
  if (resolvedToolName) {
    try {
      const callMeta = await agent.executeMcpTool(resolvedToolName, {
        screen_name: trimmedName,
        name: trimmedName,
        query: trimmedName,
      });

      if (!callMeta.isError && callMeta.result) {
        let html = '';
        let metadata: Record<string, unknown> | undefined;
        let screenId = `stitch_${Date.now()}`;
        let actualName = trimmedName;

        try {
          const parsed = JSON.parse(callMeta.result);
          html = parsed.html || parsed.content || parsed.code || (typeof parsed === 'string' ? parsed : '');
          metadata = parsed.metadata || parsed;
          screenId = parsed.screenId || parsed.id || screenId;
          actualName = parsed.screenName || parsed.name || actualName;
        } catch {
          // Plain HTML or text in result
          html = callMeta.result;
        }

        if (html && html.includes('<')) {
          return {
            screenId,
            screenName: actualName,
            html,
            metadata,
            toolName: resolvedToolName,
            serverName: callMeta.serverName,
            fromMcp: true,
            latencyMs: Date.now() - startTime,
            rawMcpCall: callMeta,
          };
        }
      }
    } catch (err) {
      console.warn(`[McpAdapter] Error executing ${resolvedToolName}:`, err);
    }
  }

  // 2. Fallback: match from Google Stitch template repository
  const builtin = findBuiltinScreen(trimmedName);
  return {
    screenId: builtin.screenId,
    screenName: builtin.screenName,
    html: builtin.html,
    metadata: builtin.metadata,
    toolName: resolvedToolName || 'stitch_get_screen',
    serverName: 'Google Stitch Service',
    fromMcp: false,
    latencyMs: Date.now() - startTime,
  };
}
