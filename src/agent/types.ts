/**
 * Type definitions for the AI Agent architecture.
 */

export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  tokens?: number;
}

export type AgentMode = 'production' | 'demo';
export type ContextStrategy = 'sliding_window' | 'sticky_facts' | 'branching' | 'summary' | 'demo';
export type ModelProvider = 'openrouter' | 'ollama';

export interface FactItem {
  id: string;
  key: string;
  value: string;
  category?: 'goal' | 'constraint' | 'preference' | 'decision' | 'agreement' | 'other';
  updatedAt: number;
}

export interface DialogueBranch {
  id: string;
  name: string;
  parentBranchId?: string;
  checkpointMessageId?: string;
  createdAt: number;
  messages: Message[];
}

export interface TokenStats {
  /** Tokens in the user's latest prompt */
  currentRequest: number;
  /** Tokens across all messages included in the context sent to the model */
  conversation: number;
  /** Tokens in the model's generated response */
  response: number;
  /** Total tokens (conversation + response) */
  total: number;
  /** Context window limit of the active model (or custom limit) */
  contextWindow: number | null;
  /** Whether the current token counts are approximate estimates or confirmed by API usage */
  isEstimated: boolean;
  /** Estimated cost in USD based on model pricing heuristics */
  estimatedCost: number | null;
  /** Whether the model is running locally (e.g. Ollama) */
  isLocal?: boolean;
}

export interface ConversationSummary {
  summary: string;
  lastSummarizedMessageId: string | null;
  lastSummarizedIndex: number;
  updatedAt: number;
  version: number;
}

export interface AgentConfig {
  provider: ModelProvider;
  apiKey: string;
  ollamaUrl: string;
  model: string;
  contextWindow: number | null;
  mode: AgentMode;
  strategy: ContextStrategy;
  systemPrompt: string;
  /** Number of recent messages to send as-is (N). Defaults to 10. */
  recentMessagesCount: number;
  /** Number of unsummarized messages older than the N window needed to trigger incremental summary. Defaults to 10. */
  summaryThreshold: number;
}

export interface TrimInfo {
  wasTrimmed: boolean;
  messagesRemoved: number;
  originalTokens: number;
  trimmedTokens: number;
}

export interface CustomModel {
  id: string;
  name?: string;
  contextLength: number | null;
  provider?: ModelProvider;
}

export interface AgentState {
  messages: Message[];
  tokenStats: TokenStats;
  config: AgentConfig;
  customModels: CustomModel[];
  isLoading: boolean;
  isSummarizing: boolean;
  isExtractingFacts: boolean;
  error: string | null;
  lastTrimInfo: TrimInfo | null;
  summary: ConversationSummary | null;
  facts: FactItem[];
  branches: DialogueBranch[];
  activeBranchId: string;
}

export type StateListener = (state: AgentState) => void;

