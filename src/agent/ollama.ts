/**
 * Ollama API integration module.
 *
 * Provides native communication with local Ollama instance:
 * - Status / version check
 * - Listing locally installed models (GET /api/tags)
 * - Model info and context length resolution (POST /api/show)
 * - Chat completion (POST /api/chat)
 */

import { CustomModel } from './types';

export interface OllamaConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface OllamaChatResult {
  content: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

/**
 * Normalizes Ollama base URL by trimming trailing slashes.
 */
export function normalizeOllamaUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : 'http://localhost:11434';
}

/**
 * Checks connection to the Ollama server.
 */
export async function checkOllamaConnection(ollamaUrl: string): Promise<OllamaConnectionResult> {
  const baseUrl = normalizeOllamaUrl(ollamaUrl);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${baseUrl}/api/version`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        ok: false,
        error: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      version: data.version || 'Connected',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown connection error';
    return {
      ok: false,
      error: msg.includes('abort')
        ? 'Connection timed out. Ensure Ollama is running.'
        : `Could not connect to Ollama at ${baseUrl}. Ensure Ollama is running and OLLAMA_ORIGINS="*" is set. (${msg})`,
    };
  }
}

/**
 * Fetches list of locally installed models from Ollama via GET /api/tags.
 */
export async function fetchOllamaModels(ollamaUrl: string): Promise<CustomModel[]> {
  const baseUrl = normalizeOllamaUrl(ollamaUrl);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const modelsList: Array<{ name: string; size?: number }> = data.models || [];

    const models: CustomModel[] = modelsList.map((m) => ({
      id: m.name,
      name: m.name,
      contextLength: null,
      provider: 'ollama',
    }));

    return models;
  } catch (err) {
    console.error(`[Ollama] Failed to fetch models from ${baseUrl}:`, err);
    throw err;
  }
}

/**
 * Resolves model metadata including context window size via POST /api/show.
 * Strategy:
 * 1. Checks parameters string for explicit `num_ctx <value>`
 * 2. If not found, inspects model_info object for keys ending with `.context_length`
 */
export async function fetchOllamaModelInfo(
  ollamaUrl: string,
  modelName: string
): Promise<{ contextLength: number | null; name: string }> {
  const baseUrl = normalizeOllamaUrl(ollamaUrl);
  const trimmedModel = modelName.trim();
  if (!trimmedModel) {
    return { contextLength: null, name: modelName };
  }

  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: trimmedModel }),
    });

    if (!res.ok) {
      console.warn(`[Ollama] /api/show returned HTTP ${res.status} for ${trimmedModel}`);
      return { contextLength: null, name: trimmedModel };
    }

    const data = await res.json();
    let contextLength: number | null = null;

    // 1. Check parameters for num_ctx
    if (typeof data.parameters === 'string') {
      const match = data.parameters.match(/num_ctx\s+(\d+)/i);
      if (match && match[1]) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          contextLength = parsed;
        }
      }
    }

    // 2. If not in parameters, check model_info keys like <arch>.context_length
    if (contextLength === null && data.model_info && typeof data.model_info === 'object') {
      for (const [key, value] of Object.entries(data.model_info)) {
        if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
          contextLength = value;
          break;
        }
      }
    }

    return {
      contextLength,
      name: trimmedModel,
    };
  } catch (err) {
    console.error(`[Ollama] Failed to fetch model info for ${trimmedModel}:`, err);
    return { contextLength: null, name: trimmedModel };
  }
}

/**
 * Sends chat completion request to native Ollama API POST /api/chat.
 */
export async function sendOllamaChat(
  ollamaUrl: string,
  payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  }
): Promise<OllamaChatResult> {
  const baseUrl = normalizeOllamaUrl(ollamaUrl);

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    let errorText = `HTTP Error ${res.status}: ${res.statusText}`;
    try {
      const errData = await res.json();
      if (errData.error) {
        errorText = errData.error;
      }
    } catch {
      // Use status text if not JSON
    }
    throw new Error(`Ollama API Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const content = data.message?.content ?? '';

  const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0;
  const responseTokens = typeof data.eval_count === 'number' ? data.eval_count : 0;
  const totalTokens = promptTokens + responseTokens;

  return {
    content,
    promptTokens,
    responseTokens,
    totalTokens,
  };
}
