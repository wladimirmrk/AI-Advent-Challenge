/**
 * Storage module: abstracts localStorage access for agent persistence.
 *
 * Separation of concerns: The Agent does not manipulate localStorage directly;
 * it delegates all persistence operations to this module.
 */

import { Message, AgentConfig, AgentMode } from './types';

const STORAGE_KEYS = {
  MESSAGES: 'agent_messages',
  API_KEY: 'openrouter_api_key',
  CONFIG: 'agent_config',
} as const;

export const DEFAULT_CONFIG: AgentConfig = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  contextWindow: 128000,
  mode: 'production',
  systemPrompt: 'You are a helpful, concise AI assistant.',
};

/**
 * Load saved messages from localStorage.
 * Returns an empty array if no messages are saved or on parse errors.
 */
export function loadMessages(): Message[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error('[Storage] Failed to load messages from localStorage:', err);
    return [];
  }
}

/**
 * Save messages array to localStorage.
 */
export function saveMessages(messages: Message[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
  } catch (err) {
    console.error('[Storage] Failed to save messages to localStorage:', err);
  }
}

/**
 * Remove saved messages from localStorage.
 */
export function clearMessages(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
  } catch (err) {
    console.error('[Storage] Failed to clear messages from localStorage:', err);
  }
}

/**
 * Load API key from localStorage.
 * Falls back to Vite environment variable VITE_OPENROUTER_API_KEY if present.
 */
export function loadApiKey(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEYS.API_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to read API key from localStorage:', err);
  }

  // Fallback to environment variable if configured
  const envKey = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_OPENROUTER_API_KEY;
  return envKey?.trim() || '';
}

/**
 * Save API key to localStorage.
 */
export function saveApiKey(apiKey: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (apiKey.trim()) {
      localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey.trim());
    } else {
      localStorage.removeItem(STORAGE_KEYS.API_KEY);
    }
  } catch (err) {
    console.error('[Storage] Failed to save API key to localStorage:', err);
  }
}

/**
 * Clear API key from localStorage.
 */
export function clearApiKey(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
  } catch (err) {
    console.error('[Storage] Failed to clear API key from localStorage:', err);
  }
}

/**
 * Load saved agent configuration (model, contextWindow, mode, systemPrompt).
 */
export function loadConfig(): AgentConfig {
  const apiKey = loadApiKey();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          apiKey,
          model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_CONFIG.model,
          contextWindow: typeof parsed.contextWindow === 'number' || parsed.contextWindow === null
            ? parsed.contextWindow
            : DEFAULT_CONFIG.contextWindow,
          mode: (parsed.mode === 'demo' || parsed.mode === 'production')
            ? (parsed.mode as AgentMode)
            : DEFAULT_CONFIG.mode,
          systemPrompt: typeof parsed.systemPrompt === 'string'
            ? parsed.systemPrompt
            : DEFAULT_CONFIG.systemPrompt,
        };
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to load config from localStorage:', err);
  }

  return {
    ...DEFAULT_CONFIG,
    apiKey,
  };
}

/**
 * Save configuration to localStorage.
 */
export function saveConfig(config: AgentConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // We save model, contextWindow, mode, systemPrompt in CONFIG,
    // and apiKey via its dedicated saveApiKey helper.
    const { apiKey, ...settingsWithoutKey } = config;
    saveApiKey(apiKey);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(settingsWithoutKey));
  } catch (err) {
    console.error('[Storage] Failed to save config to localStorage:', err);
  }
}
