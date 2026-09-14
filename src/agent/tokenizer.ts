/**
 * Tokenizer module: provides token counting and estimation.
 *
 * Requirements:
 * - Pre-request: estimates tokens for user prompt and full conversation history.
 * - Post-request: updates statistics with exact `usage` from OpenRouter API if available.
 * - Explicitly marks approximate counts with `~` and `isEstimated: true`.
 */

// Tokenizer utilities and constants

/**
 * Known pricing per 1 million tokens (USD) for common OpenRouter models.
 * Used exclusively for educational cost demonstration.
 */
const MODEL_PRICING: Record<string, { promptPerM: number; completionPerM: number }> = {
  'openai/gpt-4o-mini': { promptPerM: 0.15, completionPerM: 0.60 },
  'openai/gpt-4o': { promptPerM: 2.50, completionPerM: 10.00 },
  'google/gemini-2.0-flash-001': { promptPerM: 0.10, completionPerM: 0.40 },
  'meta-llama/llama-3.3-70b-instruct': { promptPerM: 0.12, completionPerM: 0.30 },
  'anthropic/claude-3.5-haiku': { promptPerM: 0.80, completionPerM: 4.00 },
  'deepseek/deepseek-chat': { promptPerM: 0.14, completionPerM: 0.28 },
};

/**
 * Standard known context window limits for popular models.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'openai/gpt-4o-mini': 128000,
  'openai/gpt-4o': 128000,
  'google/gemini-2.0-flash-001': 1048576,
  'meta-llama/llama-3.3-70b-instruct': 131072,
  'anthropic/claude-3.5-haiku': 200000,
  'deepseek/deepseek-chat': 64000,
};

/**
 * Estimates token count for raw text using standard multi-language BPE heuristics.
 *
 * Logic:
 * - English/Latin text: ~4 characters per token.
 * - Cyrillic text: ~1.5 - 2 characters per token in modern BPE (cl100k/o200k).
 * - Code/punctuation/whitespace: separate tokens.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let tokens = 0;
  // Match Cyrillic character runs separately as they consume more byte tokens in BPE
  const cyrillicMatches = text.match(/[\u0400-\u04FF]/g);
  const cyrillicCount = cyrillicMatches ? cyrillicMatches.length : 0;
  const nonCyrillicLength = text.length - cyrillicCount;

  // Non-cyrillic: ~4 chars per token (minimum 1)
  tokens += Math.ceil(nonCyrillicLength / 3.8);

  // Cyrillic: ~1.6 chars per token in modern LLM vocabularies
  tokens += Math.ceil(cyrillicCount / 1.6);

  // Add 1 token for basic delimiter/whitespace distribution
  return Math.max(1, tokens);
}

/**
 * Estimates tokens for an individual chat message, taking into account
 * role markers and ChatML framing overhead (<|im_start|>role\ncontent<|im_end|> ≈ 4 tokens).
 */
export function estimateMessageTokens(message: { role: string; content: string }): number {
  const contentTokens = estimateTokens(message.content);
  // Each message includes ~4 metadata tokens for role envelope
  return contentTokens + 4;
}

/**
 * Estimates total conversation tokens across an array of messages
 * plus priming overhead (typically ~3 tokens for conversation start/assistant prompt).
 */
export function estimateConversationTokens(messages: Array<{ role: string; content: string }>): number {
  if (!messages || messages.length === 0) return 0;
  const messageTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  // 3 priming tokens (e.g. <|im_start|>assistant<|message|>)
  return messageTokens + 3;
}

/**
 * Formats a token count, prefixing with `~` if the count is an estimation.
 */
export function formatTokenCount(count: number, isEstimated: boolean): string {
  return isEstimated ? `~${count.toLocaleString()}` : count.toLocaleString();
}

import { ModelProvider } from './types';

/**
 * Calculates estimated USD cost based on token counts and model pricing.
 * For local Ollama models, returns 0.
 */
export function calculateEstimatedCost(
  promptTokens: number,
  completionTokens: number,
  model: string,
  provider?: ModelProvider
): number | null {
  if (provider === 'ollama') {
    return 0;
  }
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const promptCost = (promptTokens / 1_000_000) * pricing.promptPerM;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPerM;
  return promptCost + completionCost;
}

/**
 * Resolves default context limit for a model name.
 * Returns null if the model limit is unknown.
 */
export function resolveContextLimit(model: string): number | null {
  return MODEL_CONTEXT_LIMITS[model] ?? null;
}

/**
 * Queries OpenRouter API for a specific model's metadata (context_length, name).
 * Endpoint: https://openrouter.ai/api/v1/model/<model_id>
 */
export async function fetchModelInfo(
  modelId: string,
  apiKey?: string
): Promise<{ contextLength: number | null; name?: string } | null> {
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  try {
    const headers: Record<string, string> = {};
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    const response = await fetch(`https://openrouter.ai/api/v1/model/${trimmed}`, {
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const data = json.data;
    if (!data) return null;

    const contextLength = typeof data.context_length === 'number' ? data.context_length : null;
    const name = typeof data.name === 'string' ? data.name : undefined;

    return { contextLength, name };
  } catch (err) {
    console.error(`[Tokenizer] Failed to fetch model info for ${trimmed}:`, err);
    return null;
  }
}
