/**
 * Storage module: abstracts localStorage access for agent persistence.
 *
 * Separation of concerns: The Agent does not manipulate localStorage directly;
 * it delegates all persistence operations to this module.
 */

import {
  Message,
  AgentConfig,
  AgentMode,
  ContextStrategy,
  CustomModel,
  ModelProvider,
  ConversationSummary,
  FactItem,
  DialogueBranch,
  ChatMetadata,
  DefaultModelConfig,
  WorkingMemory,
  PlanItem,
  LongTermMemory,
  UserProfile,
  DecisionItem,
  KnowledgeItem,
} from './types';
import { resolveContextLimit } from './tokenizer';

const STORAGE_KEYS = {
  CHAT_LIST: 'agent_chat_list',
  ACTIVE_CHAT_ID: 'agent_active_chat_id',
  DEFAULT_MODEL: 'agent_default_model_config',
  MESSAGES: 'agent_messages',
  API_KEY: 'openrouter_api_key',
  OLLAMA_URL: 'agent_ollama_url',
  CONFIG: 'agent_config',
  CUSTOM_MODELS: 'agent_custom_models',
  OLLAMA_MODELS: 'agent_ollama_models',
  SUMMARY: 'agent_summary',
  FACTS: 'agent_sticky_facts',
  BRANCHES: 'agent_branches',
  ACTIVE_BRANCH: 'agent_active_branch_id',
  WORKING_MEMORY: 'agent_working_memory',
  LONG_TERM_MEMORY: 'agent_long_term_memory',
  USER_PROFILES: 'agent_user_profiles',
  ACTIVE_PROFILE_ID: 'agent_active_profile_id',
  STORAGE_VERSION: 'agent_storage_version',
} as const;

export const BUILTIN_PROFILES: UserProfile[] = [
  {
    id: 'junior_frontend',
    name: 'Денис',
    role: 'Junior Frontend Developer (React / JavaScript)',
    style: 'Дружелюбный, менторский, с подробными и простыми объяснениями концепций',
    format: 'Пошаговый (Step-by-step), с понятными примерами кода',
    constraints: [
      'Писать код только на React / JS',
      'Подробно комментировать ключевые строки кода',
      'Отвечать на русском языке',
      'Не использовать сложные абстракции и сторонние стейт-менеджеры без необходимости',
    ],
    customNotes: 'Только начинает путь в веб-разработке, ценит понятные аналогии из реальной жизни.',
    isBuiltin: true,
  },
  {
    id: 'senior_architect',
    name: 'Алексей',
    role: 'Senior Software Architect / Staff Engineer',
    style: 'Предельно лаконичный, строгий, академический, без воды и вводных фраз',
    format: 'Структурированные bullet-points, архитектурные схемы (ASCII/Markdown), таблицы сравнения',
    constraints: [
      'Строгая типизация TypeScript strict / Clean Architecture',
      'Код без банальных комментариев',
      'Фокус на масштабируемости, паттернах проектирования и edge-cases',
      'Никакой воды и лишних приветствий',
    ],
    customNotes: 'Проектирует высоконагруженные распределенные системы, ценит время и точность формулировок.',
    isBuiltin: true,
  },
  {
    id: 'tech_writer_pm',
    name: 'Елена',
    role: 'Technical Writer & Product Manager',
    style: 'Деловой, структурированный, ориентированный на бизнес-ценность и пользователей',
    format: 'Таблицы спецификаций, bullet-points, User Stories, Acceptance Criteria',
    constraints: [
      'Не писать программный код и технические листинги, если прямо не запрошено',
      'Писать понятным языком без глубокого жаргона разработки',
      'Фокус на бизнес-логике, требованиях и пользе для пользователя',
    ],
    customNotes: 'Отвечает за документацию, роадмапы и прозрачность процессов в продуктовой команде.',
    isBuiltin: true,
  },
];

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: '',
  name: '',
  role: '',
  style: '',
  format: '',
  constraints: [],
  customNotes: '',
};

export const DEFAULT_MODEL_CONFIG: DefaultModelConfig = {
  model: 'openai/gpt-4o-mini',
  provider: 'openrouter',
  contextWindow: 128000,
};

export const DEFAULT_CONFIG: AgentConfig = {
  provider: 'openrouter',
  apiKey: '',
  ollamaUrl: 'http://localhost:11434',
  model: 'openai/gpt-4o-mini',
  contextWindow: 128000,
  mode: 'production',
  strategy: 'summary',
  systemPrompt: 'You are a helpful, concise AI assistant.',
  recentMessagesCount: 10,
  summaryThreshold: 10,
};

export const DEFAULT_WORKING_MEMORY: WorkingMemory = {
  goal: '',
  plan: [],
  scratchpad: '',
  updatedAt: 0,
};

export const DEFAULT_LONG_TERM_MEMORY: LongTermMemory = {
  profile: { ...DEFAULT_USER_PROFILE },
  decisions: [],
  knowledge: [],
  updatedAt: 0,
};

export function loadDefaultModelConfig(): DefaultModelConfig {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_MODEL_CONFIG };
    const raw = localStorage.getItem(STORAGE_KEYS.DEFAULT_MODEL);
    if (!raw) return { ...DEFAULT_MODEL_CONFIG };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.model === 'string' && parsed.model.trim()) {
      const model = parsed.model.trim();
      const provider = parsed.provider === 'ollama' ? 'ollama' : 'openrouter';
      const contextWindow =
        typeof parsed.contextWindow === 'number' || parsed.contextWindow === null
          ? parsed.contextWindow
          : resolveContextLimit(model);
      return {
        model,
        provider,
        contextWindow,
      };
    }
  } catch (err) {
    console.error('[Storage] Failed to load default model config:', err);
  }
  return { ...DEFAULT_MODEL_CONFIG };
}

export function saveDefaultModelConfig(config: DefaultModelConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, JSON.stringify(config));
  } catch (err) {
    console.error('[Storage] Failed to save default model config:', err);
  }
}

export const DEFAULT_SUMMARY: ConversationSummary = {
  summary: '',
  lastSummarizedMessageId: null,
  lastSummarizedIndex: -1,
  updatedAt: 0,
  version: 1,
};

export const CURRENT_SCHEMA_VERSION = 6;

function getChatKey(baseKey: string, chatId: string = 'default'): string {
  return `${baseKey}_${chatId}`;
}

function getItemWithFallback(baseKey: string, chatId: string = 'default'): string | null {
  if (typeof localStorage === 'undefined') return null;
  const key = getChatKey(baseKey, chatId);
  const val = localStorage.getItem(key);
  if (val !== null) return val;
  if (chatId === 'default') {
    return localStorage.getItem(baseKey);
  }
  return null;
}

/**
 * Migration helper: safely migrates localStorage schema across versions.
 */
export function migrateStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const currentVersionStr = localStorage.getItem(STORAGE_KEYS.STORAGE_VERSION);
    const currentVersion = currentVersionStr ? parseInt(currentVersionStr, 10) : 1;

    if (currentVersion < 2) {
      // Version 1 -> 2 migration:
      // Ensure summary key exists separately without touching messages
      const existingSummary = localStorage.getItem(STORAGE_KEYS.SUMMARY);
      if (!existingSummary) {
        localStorage.setItem(STORAGE_KEYS.SUMMARY, JSON.stringify(DEFAULT_SUMMARY));
        localStorage.setItem(`${STORAGE_KEYS.SUMMARY}_default`, JSON.stringify(DEFAULT_SUMMARY));
      }
    }

    if (currentVersion < 3) {
      // Version 2 -> 3 migration:
      // Initialize facts and branches if needed
      const existingFacts = localStorage.getItem(STORAGE_KEYS.FACTS);
      if (!existingFacts) {
        localStorage.setItem(STORAGE_KEYS.FACTS, JSON.stringify([]));
        localStorage.setItem(`${STORAGE_KEYS.FACTS}_default`, JSON.stringify([]));
      }
      const existingBranches = localStorage.getItem(STORAGE_KEYS.BRANCHES);
      if (!existingBranches) {
        localStorage.setItem(STORAGE_KEYS.BRANCHES, JSON.stringify([]));
        localStorage.setItem(`${STORAGE_KEYS.BRANCHES}_default`, JSON.stringify([]));
      }
    }

    if (currentVersion < 4) {
      // Version 3 -> 4 migration:
      // Initialize chat list and migrate existing data to 'default' chat
      const existingChatList = localStorage.getItem(STORAGE_KEYS.CHAT_LIST);
      if (!existingChatList) {
        const rawMessages = localStorage.getItem(STORAGE_KEYS.MESSAGES);
        const rawSummary = localStorage.getItem(STORAGE_KEYS.SUMMARY);
        const rawFacts = localStorage.getItem(STORAGE_KEYS.FACTS);
        const rawBranches = localStorage.getItem(STORAGE_KEYS.BRANCHES);
        const rawActiveBranch = localStorage.getItem(STORAGE_KEYS.ACTIVE_BRANCH);
        const rawConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);

        if (rawMessages && !localStorage.getItem(`${STORAGE_KEYS.MESSAGES}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.MESSAGES}_default`, rawMessages);
        }
        if (rawSummary && !localStorage.getItem(`${STORAGE_KEYS.SUMMARY}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.SUMMARY}_default`, rawSummary);
        }
        if (rawFacts && !localStorage.getItem(`${STORAGE_KEYS.FACTS}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.FACTS}_default`, rawFacts);
        }
        if (rawBranches && !localStorage.getItem(`${STORAGE_KEYS.BRANCHES}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.BRANCHES}_default`, rawBranches);
        }
        if (rawActiveBranch && !localStorage.getItem(`${STORAGE_KEYS.ACTIVE_BRANCH}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.ACTIVE_BRANCH}_default`, rawActiveBranch);
        }
        if (rawConfig && !localStorage.getItem(`${STORAGE_KEYS.CONFIG}_default`)) {
          localStorage.setItem(`${STORAGE_KEYS.CONFIG}_default`, rawConfig);
        }

        const defaultChat: ChatMetadata = {
          id: 'default',
          title: 'Основной чат',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        saveChatList([defaultChat]);
        saveActiveChatId('default');
      }
    }

    if (currentVersion < 5) {
      // Version 4 -> 5 migration:
      // Initialize working memory and long-term memory if not present
      const existingLongTerm = localStorage.getItem(STORAGE_KEYS.LONG_TERM_MEMORY);
      if (!existingLongTerm) {
        localStorage.setItem(STORAGE_KEYS.LONG_TERM_MEMORY, JSON.stringify(DEFAULT_LONG_TERM_MEMORY));
      }
      const existingWorking = getItemWithFallback(STORAGE_KEYS.WORKING_MEMORY, 'default');
      if (!existingWorking) {
        localStorage.setItem(getChatKey(STORAGE_KEYS.WORKING_MEMORY, 'default'), JSON.stringify(DEFAULT_WORKING_MEMORY));
        localStorage.setItem(STORAGE_KEYS.WORKING_MEMORY, JSON.stringify(DEFAULT_WORKING_MEMORY));
      }
    }

    if (currentVersion < 6) {
      // Version 5 -> 6 migration:
      // Initialize user profiles library if not present
      const existingProfiles = localStorage.getItem(STORAGE_KEYS.USER_PROFILES);
      if (!existingProfiles) {
        localStorage.setItem(STORAGE_KEYS.USER_PROFILES, JSON.stringify(BUILTIN_PROFILES));
      }
    }

    localStorage.setItem(STORAGE_KEYS.STORAGE_VERSION, String(CURRENT_SCHEMA_VERSION));
  } catch (err) {
    console.error('[Storage] Migration failed:', err);
  }
}

/**
 * Load list of chats from localStorage.
 */
export function loadChatList(): ChatMetadata[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_LIST);
    if (!raw) {
      const defaultChat: ChatMetadata = {
        id: 'default',
        title: 'Основной чат',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveChatList([defaultChat]);
      return [defaultChat];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    const defaultChat: ChatMetadata = {
      id: 'default',
      title: 'Основной чат',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveChatList([defaultChat]);
    return [defaultChat];
  } catch (err) {
    console.error('[Storage] Failed to load chat list:', err);
    return [{
      id: 'default',
      title: 'Основной чат',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
  }
}

/**
 * Save list of chats to localStorage.
 */
export function saveChatList(chats: ChatMetadata[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.CHAT_LIST, JSON.stringify(chats));
  } catch (err) {
    console.error('[Storage] Failed to save chat list:', err);
  }
}

/**
 * Load active chat ID from localStorage.
 */
export function loadActiveChatId(): string {
  try {
    if (typeof localStorage === 'undefined') return 'default';
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAT_ID);
    return raw && raw.trim() ? raw.trim() : 'default';
  } catch (err) {
    console.error('[Storage] Failed to load active chat id:', err);
    return 'default';
  }
}

/**
 * Save active chat ID to localStorage.
 */
export function saveActiveChatId(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CHAT_ID, id.trim());
  } catch (err) {
    console.error('[Storage] Failed to save active chat id:', err);
  }
}

/**
 * Delete all persisted data associated with a specific chat.
 */
export function deleteChatStorage(chatId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getChatKey(STORAGE_KEYS.MESSAGES, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.SUMMARY, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.FACTS, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.BRANCHES, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.ACTIVE_BRANCH, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.CONFIG, chatId));
    localStorage.removeItem(getChatKey(STORAGE_KEYS.WORKING_MEMORY, chatId));
    if (chatId === 'default') {
      localStorage.removeItem(STORAGE_KEYS.MESSAGES);
      localStorage.removeItem(STORAGE_KEYS.SUMMARY);
      localStorage.removeItem(STORAGE_KEYS.FACTS);
      localStorage.removeItem(STORAGE_KEYS.BRANCHES);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_BRANCH);
      localStorage.removeItem(STORAGE_KEYS.CONFIG);
      localStorage.removeItem(STORAGE_KEYS.WORKING_MEMORY);
    }
  } catch (err) {
    console.error('[Storage] Failed to delete chat storage:', err);
  }
}

/**
 * Load saved messages from localStorage for a specific chat.
 */
export function loadMessages(chatId: string = 'default'): Message[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = getItemWithFallback(STORAGE_KEYS.MESSAGES, chatId);
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
 * Save messages array to localStorage for a specific chat.
 */
export function saveMessages(messages: Message[], chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.MESSAGES, chatId), JSON.stringify(messages));
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
    }
  } catch (err) {
    console.error('[Storage] Failed to save messages to localStorage:', err);
  }
}

/**
 * Remove saved messages from localStorage for a specific chat.
 */
export function clearMessages(chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getChatKey(STORAGE_KEYS.MESSAGES, chatId));
    if (chatId === 'default') {
      localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    }
  } catch (err) {
    console.error('[Storage] Failed to clear messages from localStorage:', err);
  }
}

/**
 * Load saved summary from localStorage for a specific chat.
 */
export function loadSummary(chatId: string = 'default'): ConversationSummary {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SUMMARY };
    const raw = getItemWithFallback(STORAGE_KEYS.SUMMARY, chatId);
    if (!raw) return { ...DEFAULT_SUMMARY };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        lastSummarizedMessageId:
          typeof parsed.lastSummarizedMessageId === 'string' ? parsed.lastSummarizedMessageId : null,
        lastSummarizedIndex:
          typeof parsed.lastSummarizedIndex === 'number' ? parsed.lastSummarizedIndex : -1,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        version: typeof parsed.version === 'number' ? parsed.version : 1,
      };
    }
    return { ...DEFAULT_SUMMARY };
  } catch (err) {
    console.error('[Storage] Failed to load summary from localStorage:', err);
    return { ...DEFAULT_SUMMARY };
  }
}

/**
 * Save summary to localStorage for a specific chat.
 */
export function saveSummary(summary: ConversationSummary, chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.SUMMARY, chatId), JSON.stringify(summary));
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.SUMMARY, JSON.stringify(summary));
    }
  } catch (err) {
    console.error('[Storage] Failed to save summary to localStorage:', err);
  }
}

/**
 * Remove saved summary from localStorage for a specific chat.
 */
export function clearSummary(chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getChatKey(STORAGE_KEYS.SUMMARY, chatId));
    if (chatId === 'default') {
      localStorage.removeItem(STORAGE_KEYS.SUMMARY);
    }
  } catch (err) {
    console.error('[Storage] Failed to clear summary from localStorage:', err);
  }
}

/**
 * Load sticky facts from localStorage for a specific chat.
 */
export function loadFacts(chatId: string = 'default'): FactItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = getItemWithFallback(STORAGE_KEYS.FACTS, chatId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error('[Storage] Failed to load facts from localStorage:', err);
    return [];
  }
}

/**
 * Save sticky facts to localStorage for a specific chat.
 */
export function saveFacts(facts: FactItem[], chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.FACTS, chatId), JSON.stringify(facts));
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.FACTS, JSON.stringify(facts));
    }
  } catch (err) {
    console.error('[Storage] Failed to save facts to localStorage:', err);
  }
}

/**
 * Clear sticky facts from localStorage for a specific chat.
 */
export function clearFacts(chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getChatKey(STORAGE_KEYS.FACTS, chatId));
    if (chatId === 'default') {
      localStorage.removeItem(STORAGE_KEYS.FACTS);
    }
  } catch (err) {
    console.error('[Storage] Failed to clear facts from localStorage:', err);
  }
}

/**
 * Load branches from localStorage for a specific chat.
 */
export function loadBranches(chatId: string = 'default'): DialogueBranch[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = getItemWithFallback(STORAGE_KEYS.BRANCHES, chatId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error('[Storage] Failed to load branches from localStorage:', err);
    return [];
  }
}

/**
 * Save branches to localStorage for a specific chat.
 */
export function saveBranches(branches: DialogueBranch[], chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.BRANCHES, chatId), JSON.stringify(branches));
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.BRANCHES, JSON.stringify(branches));
    }
  } catch (err) {
    console.error('[Storage] Failed to save branches to localStorage:', err);
  }
}

/**
 * Load active branch ID from localStorage for a specific chat.
 */
export function loadActiveBranchId(chatId: string = 'default'): string {
  try {
    if (typeof localStorage === 'undefined') return 'main';
    const raw = getItemWithFallback(STORAGE_KEYS.ACTIVE_BRANCH, chatId);
    return raw && raw.trim() ? raw.trim() : 'main';
  } catch (err) {
    console.error('[Storage] Failed to load active branch id:', err);
    return 'main';
  }
}

/**
 * Save active branch ID to localStorage for a specific chat.
 */
export function saveActiveBranchId(id: string, chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.ACTIVE_BRANCH, chatId), id.trim());
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_BRANCH, id.trim());
    }
  } catch (err) {
    console.error('[Storage] Failed to save active branch id:', err);
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
 * Load saved agent configuration (model, contextWindow, mode, systemPrompt, provider, ollamaUrl) for a specific chat.
 */
export function loadConfig(chatId: string = 'default'): AgentConfig {
  const apiKey = loadApiKey();
  const ollamaUrl = loadOllamaUrl();
  const defaultModelConfig = loadDefaultModelConfig();

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = getItemWithFallback(STORAGE_KEYS.CONFIG, chatId);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          provider: (parsed.provider === 'ollama' ? 'ollama' : 'openrouter') as ModelProvider,
          apiKey,
          ollamaUrl: typeof parsed.ollamaUrl === 'string' && parsed.ollamaUrl.trim()
            ? parsed.ollamaUrl.trim()
            : ollamaUrl,
          model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : defaultModelConfig.model,
          contextWindow: typeof parsed.contextWindow === 'number' || parsed.contextWindow === null
            ? parsed.contextWindow
            : defaultModelConfig.contextWindow,
          mode: (parsed.mode === 'demo' || parsed.mode === 'production')
            ? (parsed.mode as AgentMode)
            : DEFAULT_CONFIG.mode,
          strategy: (['sliding_window', 'sticky_facts', 'branching', 'summary', 'demo'].includes(parsed.strategy))
            ? (parsed.strategy as ContextStrategy)
            : (parsed.mode === 'demo' ? 'demo' : DEFAULT_CONFIG.strategy),
          systemPrompt: typeof parsed.systemPrompt === 'string'
            ? parsed.systemPrompt
            : DEFAULT_CONFIG.systemPrompt,
          recentMessagesCount:
            typeof parsed.recentMessagesCount === 'number' && parsed.recentMessagesCount > 0
              ? parsed.recentMessagesCount
              : DEFAULT_CONFIG.recentMessagesCount,
          summaryThreshold:
            typeof parsed.summaryThreshold === 'number' && parsed.summaryThreshold > 0
              ? parsed.summaryThreshold
              : DEFAULT_CONFIG.summaryThreshold,
        };
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to load config from localStorage:', err);
  }

  return {
    ...DEFAULT_CONFIG,
    provider: defaultModelConfig.provider,
    model: defaultModelConfig.model,
    contextWindow: defaultModelConfig.contextWindow,
    apiKey,
    ollamaUrl,
  };
}

/**
 * Save configuration to localStorage for a specific chat.
 */
export function saveConfig(config: AgentConfig, chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const { apiKey, ollamaUrl, ...settingsWithoutSensitive } = config;
    saveApiKey(apiKey);
    saveOllamaUrl(ollamaUrl);
    localStorage.setItem(
      getChatKey(STORAGE_KEYS.CONFIG, chatId),
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

// ==========================================
// Working Memory Storage (Per-Chat / Per-Task)
// ==========================================

/**
 * Load working memory for a specific chat from localStorage.
 */
export function loadWorkingMemory(chatId: string = 'default'): WorkingMemory {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_WORKING_MEMORY };
    const raw = getItemWithFallback(STORAGE_KEYS.WORKING_MEMORY, chatId);
    if (!raw) return { ...DEFAULT_WORKING_MEMORY };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        goal: typeof parsed.goal === 'string' ? parsed.goal : '',
        plan: Array.isArray(parsed.plan)
          ? parsed.plan.filter(
              (p: unknown) =>
                p &&
                typeof p === 'object' &&
                typeof (p as PlanItem).id === 'string' &&
                typeof (p as PlanItem).text === 'string'
            )
          : [],
        scratchpad: typeof parsed.scratchpad === 'string' ? parsed.scratchpad : '',
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    }
  } catch (err) {
    console.error('[Storage] Failed to load working memory from localStorage:', err);
  }
  return { ...DEFAULT_WORKING_MEMORY };
}

/**
 * Save working memory for a specific chat to localStorage.
 */
export function saveWorkingMemory(memory: WorkingMemory, chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.WORKING_MEMORY, chatId), JSON.stringify(memory));
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.WORKING_MEMORY, JSON.stringify(memory));
    }
  } catch (err) {
    console.error('[Storage] Failed to save working memory to localStorage:', err);
  }
}

/**
 * Clear working memory for a specific chat in localStorage.
 */
export function clearWorkingMemory(chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getChatKey(STORAGE_KEYS.WORKING_MEMORY, chatId));
    if (chatId === 'default') {
      localStorage.removeItem(STORAGE_KEYS.WORKING_MEMORY);
    }
  } catch (err) {
    console.error('[Storage] Failed to clear working memory from localStorage:', err);
  }
}

// ==========================================
// Long-Term Memory Storage (Global Across Chats)
// ==========================================

/**
 * Load global long-term memory (user profile, decisions, knowledge base) from localStorage.
 */
export function loadLongTermMemory(): LongTermMemory {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_LONG_TERM_MEMORY };
    const raw = localStorage.getItem(STORAGE_KEYS.LONG_TERM_MEMORY);
    if (!raw) return { ...DEFAULT_LONG_TERM_MEMORY };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const rawProfile = parsed.profile;
      const profile: UserProfile = {
        id: typeof rawProfile?.id === 'string' ? rawProfile.id : '',
        name: typeof rawProfile?.name === 'string' ? rawProfile.name : '',
        role: typeof rawProfile?.role === 'string' ? rawProfile.role : '',
        style: typeof rawProfile?.style === 'string' ? rawProfile.style : '',
        format: typeof rawProfile?.format === 'string' ? rawProfile.format : '',
        constraints: Array.isArray(rawProfile?.constraints)
          ? rawProfile.constraints.filter((c: unknown) => typeof c === 'string')
          : [],
        customNotes: typeof rawProfile?.customNotes === 'string' ? rawProfile.customNotes : '',
        preferences: Array.isArray(rawProfile?.preferences)
          ? rawProfile.preferences.filter((p: unknown) => typeof p === 'string')
          : [],
        isBuiltin: Boolean(rawProfile?.isBuiltin),
      };

      const decisions: DecisionItem[] = Array.isArray(parsed.decisions)
        ? parsed.decisions.filter(
            (d: unknown) =>
              d &&
              typeof d === 'object' &&
              typeof (d as DecisionItem).id === 'string' &&
              typeof (d as DecisionItem).title === 'string'
          )
        : [];

      const knowledge: KnowledgeItem[] = Array.isArray(parsed.knowledge)
        ? parsed.knowledge.filter(
            (k: unknown) =>
              k &&
              typeof k === 'object' &&
              typeof (k as KnowledgeItem).id === 'string' &&
              typeof (k as KnowledgeItem).key === 'string'
          )
        : [];

      return {
        profile,
        decisions,
        knowledge,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    }
  } catch (err) {
    console.error('[Storage] Failed to load long-term memory from localStorage:', err);
  }
  return { ...DEFAULT_LONG_TERM_MEMORY };
}

/**
 * Save global long-term memory to localStorage.
 */
export function saveLongTermMemory(memory: LongTermMemory): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.LONG_TERM_MEMORY, JSON.stringify(memory));
  } catch (err) {
    console.error('[Storage] Failed to save long-term memory to localStorage:', err);
  }
}

/**
 * Clear global long-term memory in localStorage.
 */
export function clearLongTermMemory(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEYS.LONG_TERM_MEMORY);
  } catch (err) {
    console.error('[Storage] Failed to clear long-term memory from localStorage:', err);
  }
}

// ==========================================
// User Profiles & Personalization Storage
// ==========================================

/**
 * Load global user profiles library from localStorage.
 */
export function loadUserProfiles(): UserProfile[] {
  try {
    if (typeof localStorage === 'undefined') return BUILTIN_PROFILES.map((p) => ({ ...p }));
    const raw = localStorage.getItem(STORAGE_KEYS.USER_PROFILES);
    if (!raw) {
      saveUserProfiles(BUILTIN_PROFILES);
      return BUILTIN_PROFILES.map((p) => ({ ...p }));
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((p) => ({
        id: typeof p.id === 'string' ? p.id : `profile-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: typeof p.name === 'string' ? p.name : '',
        role: typeof p.role === 'string' ? p.role : '',
        style: typeof p.style === 'string' ? p.style : '',
        format: typeof p.format === 'string' ? p.format : '',
        constraints: Array.isArray(p.constraints)
          ? p.constraints.filter((c: unknown) => typeof c === 'string')
          : [],
        customNotes: typeof p.customNotes === 'string' ? p.customNotes : '',
        preferences: Array.isArray(p.preferences)
          ? p.preferences.filter((pref: unknown) => typeof pref === 'string')
          : [],
        isBuiltin: Boolean(p.isBuiltin),
      }));
    }
  } catch (err) {
    console.error('[Storage] Failed to load user profiles from localStorage:', err);
  }
  return BUILTIN_PROFILES.map((p) => ({ ...p }));
}

/**
 * Save global user profiles library to localStorage.
 */
export function saveUserProfiles(profiles: UserProfile[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.USER_PROFILES, JSON.stringify(profiles));
  } catch (err) {
    console.error('[Storage] Failed to save user profiles to localStorage:', err);
  }
}

/**
 * Load active profile ID for a specific chat from localStorage.
 */
export function loadActiveProfileId(chatId: string = 'default'): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const raw = getItemWithFallback(STORAGE_KEYS.ACTIVE_PROFILE_ID, chatId);
    if (raw && typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  } catch (err) {
    console.error('[Storage] Failed to load active profile ID from localStorage:', err);
  }
  return '';
}

/**
 * Save active profile ID for a specific chat in localStorage.
 */
export function saveActiveProfileId(profileId: string, chatId: string = 'default'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getChatKey(STORAGE_KEYS.ACTIVE_PROFILE_ID, chatId), profileId);
    if (chatId === 'default') {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE_ID, profileId);
    }
  } catch (err) {
    console.error('[Storage] Failed to save active profile ID to localStorage:', err);
  }
}

/**
 * Reset builtin profiles to their defaults while preserving user-created custom profiles.
 */
export function resetBuiltinProfiles(): UserProfile[] {
  const current = loadUserProfiles();
  const custom = current.filter((p) => !p.isBuiltin);
  const updated = [...BUILTIN_PROFILES.map((p) => ({ ...p })), ...custom];
  saveUserProfiles(updated);
  return updated;
}


