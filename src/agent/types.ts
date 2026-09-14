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
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  contextWindow: number | null;
  mode: AgentMode;
  systemPrompt: string;
}

export interface TrimInfo {
  wasTrimmed: boolean;
  messagesRemoved: number;
  originalTokens: number;
  trimmedTokens: number;
}

export interface AgentState {
  messages: Message[];
  tokenStats: TokenStats;
  config: AgentConfig;
  isLoading: boolean;
  error: string | null;
  lastTrimInfo: TrimInfo | null;
}

export type StateListener = (state: AgentState) => void;
