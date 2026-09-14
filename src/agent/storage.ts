/**
 * Storage module: abstracts localStorage access for agent persistence.
 *
 * Separation of concerns: The Agent does not manipulate localStorage directly;
 * it delegates all persistence operations to this module.
 */

import { Message, AgentConfig, AgentMode, CustomModel, ModelProvider } from './types';
import { resolveContextLimit } from './tokenizer';

const STORAGE_KEYS = {
  MESSAGES: 'agent_messages',
  API_KEY: 'openrouter_api_key',
  OLLAMA_URL: 'agent_ollama_url',
  CONFIG: 'agent_config',
  CUSTOM_MODELS: 'agent_custom_models',
  OLLAMA_MODELS: 'agent_ollama_models',
} as const;

export const DEFAULT_CONFIG: AgentConfig = {
  provider: 'openrouter',
  apiKey: '',
  ollamaUrl: 'http://localhost:11434',
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
 * Load Ollama URL from localStorage or environment variable.
 */
export function loadOllamaUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEYS.OLLAMA_URL);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to read Ollama URL from localStorage:', err);
  }

  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_OLLAMA_URL;
  return envUrl?.trim() || 'http://localhost:11434';
}

/**
 * Save Ollama URL to localStorage.
 */
export function saveOllamaUrl(url: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (url.trim()) {
      localStorage.setItem(STORAGE_KEYS.OLLAMA_URL, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEYS.OLLAMA_URL);
    }
  } catch (err) {
    console.error('[Storage] Failed to save Ollama URL to localStorage:', err);
  }
}

/**
 * Load saved agent configuration (model, contextWindow, mode, systemPrompt, provider, ollamaUrl).
 */
export function loadConfig(): AgentConfig {
  const apiKey = loadApiKey();
  const ollamaUrl = loadOllamaUrl();

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          provider: (parsed.provider === 'ollama' ? 'ollama' : 'openrouter') as ModelProvider,
          apiKey,
          ollamaUrl: typeof parsed.ollamaUrl === 'string' && parsed.ollamaUrl.trim()
            ? parsed.ollamaUrl.trim()
            : ollamaUrl,
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
    ollamaUrl,
  };
}

/**
 * Save configuration to localStorage.
 */
export function saveConfig(config: AgentConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const { apiKey, ollamaUrl, ...settingsWithoutSensitive } = config;
    saveApiKey(apiKey);
    saveOllamaUrl(ollamaUrl);
    localStorage.setItem(
      STORAGE_KEYS.CONFIG,
      JSON.stringify({
        ...settingsWithoutSensitive,
        ollamaUrl,
      })
    );
  } catch (err) {
    console.error('[Storage] Failed to save config to localStorage:', err);
  }
}

/**
 * Load user-added custom models from localStorage.
 * Supports backwards compatibility with older string[] format.
 */
export function loadCustomModels(): CustomModel[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_MODELS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const models: CustomModel[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        const id = item.trim();
        models.push({
          id,
          contextLength: resolveContextLimit(id),
          provider: 'openrouter',
        });
      } else if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) {
        models.push({
          id: item.id.trim(),
          name: typeof item.name === 'string' ? item.name : undefined,
          contextLength: typeof item.contextLength === 'number' ? item.contextLength : null,
          provider: (item.provider === 'ollama' ? 'ollama' : 'openrouter') as ModelProvider,
        });
      }
    }
    return models;
  } catch (err) {
    console.error('[Storage] Failed to load custom models from localStorage:', err);
    return [];
  }
}

/**
 * Save user-added custom models array to localStorage.
 */
export function saveCustomModels(models: CustomModel[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(models));
  } catch (err) {
    console.error('[Storage] Failed to save custom models to localStorage:', err);
  }
}

/**
 * Load cached Ollama models from localStorage.
 */
export function loadOllamaModels(): CustomModel[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.OLLAMA_MODELS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const models: CustomModel[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) {
        models.push({
          id: item.id.trim(),
          name: typeof item.name === 'string' ? item.name : item.id.trim(),
          contextLength: typeof item.contextLength === 'number' ? item.contextLength : null,
          provider: 'ollama',
        });
      }
    }
    return models;
  } catch (err) {
    console.error('[Storage] Failed to load Ollama models from localStorage:', err);
    return [];
  }
}

/**
 * Save cached Ollama models to localStorage.
 */
export function saveOllamaModels(models: CustomModel[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.OLLAMA_MODELS, JSON.stringify(models));
  } catch (err) {
    console.error('[Storage] Failed to save Ollama models to localStorage:', err);
  }
}

