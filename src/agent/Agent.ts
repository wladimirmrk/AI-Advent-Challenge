/**
 * Agent Class
 *
 * This class is the core entity of the application.
 * It encapsulates:
 * 1. API key and model configuration
 * 2. Conversation history (messages)
 * 3. Token statistics and estimation
 * 4. Context overflow management (Demo Overflow vs Production Trimming)
 * 5. LocalStorage persistence delegation
 * 6. Direct communication with OpenRouter API
 *
 * Notice: React components NEVER call OpenRouter directly.
 * All operations pass through this Agent class.
 */

import {
  Message,
  AgentConfig,
  AgentState,
  TokenStats,
  AgentMode,
  TrimInfo,
  CustomModel,
  StateListener,
} from './types';
import {
  loadMessages,
  saveMessages,
  clearMessages,
  loadConfig,
  saveConfig,
  loadCustomModels,
  saveCustomModels,
} from './storage';
import {
  estimateTokens,
  estimateConversationTokens,
  calculateEstimatedCost,
  resolveContextLimit,
} from './tokenizer';

export class Agent {
  private config: AgentConfig;
  private messages: Message[] = [];
  private tokenStats: TokenStats;
  private customModels: CustomModel[] = [];
  private isLoading = false;
  private error: string | null = null;
  private lastTrimInfo: TrimInfo | null = null;
  private listeners: Set<StateListener> = new Set();

  constructor(initialConfig?: Partial<AgentConfig>) {
    // 1. Load saved configuration from localStorage (or fallback to defaults and .env)
    const storedConfig = loadConfig();
    this.config = {
      ...storedConfig,
      ...initialConfig,
    };

    // Auto-resolve context window if not explicitly provided
    if (this.config.contextWindow === null && this.config.model) {
      this.config.contextWindow = resolveContextLimit(this.config.model);
    }

    // 2. Load conversation history from localStorage
    this.messages = loadMessages();

    // 3. Load user-added custom models from localStorage
    this.customModels = loadCustomModels();

    // 4. Initialize token statistics based on restored history
    this.tokenStats = this.calculateInitialTokenStats();
  }

  // ==========================================
  // State Subscription (Observer Pattern)
  // Allows React components to reactively re-render
  // whenever Agent state changes.
  // ==========================================

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately emit current state on subscription
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const currentState = this.getState();
    this.listeners.forEach((listener) => listener(currentState));
  }

  public getState(): AgentState {
    return {
      messages: [...this.messages],
      tokenStats: { ...this.tokenStats },
      config: { ...this.config },
      customModels: [...this.customModels],
      isLoading: this.isLoading,
      error: this.error,
      lastTrimInfo: this.lastTrimInfo ? { ...this.lastTrimInfo } : null,
    };
  }

  // ==========================================
  // Configuration Setters
  // ==========================================

  public setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey.trim();
    saveConfig(this.config);
    this.error = null;
    this.notify();
  }

  public setModel(model: string, customContextWindow?: number | null): void {
    this.config.model = model.trim();
    if (customContextWindow !== undefined) {
      this.config.contextWindow = customContextWindow;
    } else {
      // 1. Check if model is in customModels
      const foundCustom = this.customModels.find((m) => m.id === this.config.model);
      if (foundCustom && foundCustom.contextLength !== undefined) {
        this.config.contextWindow = foundCustom.contextLength;
      } else {
        this.config.contextWindow = resolveContextLimit(this.config.model);
      }
    }
    this.tokenStats.contextWindow = this.config.contextWindow;
    this.recalculateCurrentStats();
    saveConfig(this.config);
    this.notify();
  }

  public getCustomModels(): CustomModel[] {
    return [...this.customModels];
  }

  public addCustomModel(model: CustomModel | string): void {
    const modelObj: CustomModel = typeof model === 'string'
      ? { id: model.trim(), contextLength: resolveContextLimit(model.trim()) }
      : {
          id: model.id.trim(),
          name: model.name,
          contextLength: model.contextLength,
        };

    if (!modelObj.id) return;

    const existingIndex = this.customModels.findIndex((m) => m.id === modelObj.id);
    if (existingIndex >= 0) {
      this.customModels[existingIndex] = modelObj;
    } else {
      this.customModels.push(modelObj);
    }
    saveCustomModels(this.customModels);
    this.notify();
  }

  public removeCustomModel(modelId: string): void {
    const trimmed = modelId.trim();
    this.customModels = this.customModels.filter((m) => m.id !== trimmed);
    saveCustomModels(this.customModels);

    // If the removed model was active, fall back to default model
    if (this.config.model === trimmed) {
      this.setModel('openai/gpt-4o-mini');
    } else {
      this.notify();
    }
  }

  public setContextWindow(limit: number | null): void {
    this.config.contextWindow = limit;
    this.tokenStats.contextWindow = limit;
    saveConfig(this.config);
    this.notify();
  }

  public setMode(mode: AgentMode): void {
    this.config.mode = mode;
    saveConfig(this.config);
    this.notify();
  }

  public setSystemPrompt(systemPrompt: string): void {
    this.config.systemPrompt = systemPrompt;
    saveConfig(this.config);
    this.recalculateCurrentStats();
    this.notify();
  }

  // ==========================================
  // History & Persistence
  // ==========================================

  public getHistory(): Message[] {
    return [...this.messages];
  }

  public getTokenStats(): TokenStats {
    return { ...this.tokenStats };
  }

  public loadHistory(): void {
    this.messages = loadMessages();
    this.tokenStats = this.calculateInitialTokenStats();
    this.lastTrimInfo = null;
    this.error = null;
    this.notify();
  }

  public saveHistory(): void {
    saveMessages(this.messages);
  }

  public clearHistory(): void {
    this.messages = [];
    clearMessages();
    this.tokenStats = this.calculateInitialTokenStats();
    this.lastTrimInfo = null;
    this.error = null;
    this.notify();
  }

  public clearError(): void {
    this.error = null;
    this.notify();
  }

  // ==========================================
  // Token Calculation Helpers
  // ==========================================

  private calculateInitialTokenStats(): TokenStats {
    const formattedMessages = this.getPreparedMessages(this.messages);
    const conversationTokens = estimateConversationTokens(formattedMessages);
    return {
      currentRequest: 0,
      conversation: conversationTokens,
      response: 0,
      total: conversationTokens,
      contextWindow: this.config.contextWindow,
      isEstimated: true,
      estimatedCost: calculateEstimatedCost(conversationTokens, 0, this.config.model),
    };
  }

  private recalculateCurrentStats(): void {
    const formattedMessages = this.getPreparedMessages(this.messages);
    const conversationTokens = estimateConversationTokens(formattedMessages);
    this.tokenStats = {
      ...this.tokenStats,
      conversation: conversationTokens,
      total: conversationTokens + this.tokenStats.response,
      contextWindow: this.config.contextWindow,
      estimatedCost: calculateEstimatedCost(conversationTokens, this.tokenStats.response, this.config.model),
    };
  }

  /**
   * Prepares the messages array for LLM submission, prepending the system prompt
   * if one is configured.
   */
  private getPreparedMessages(messagesList: Message[]): Array<{ role: string; content: string }> {
    const prepared: Array<{ role: string; content: string }> = [];
    if (this.config.systemPrompt && this.config.systemPrompt.trim()) {
      prepared.push({
        role: 'system',
        content: this.config.systemPrompt.trim(),
      });
    }
    for (const msg of messagesList) {
      prepared.push({
        role: msg.role,
        content: msg.content,
      });
    }
    return prepared;
  }

  // ==========================================
  // Context Trimming Logic (Production Mode)
  // ==========================================

  /**
   * In Production mode, trims older user/assistant messages to ensure total
   * tokens fit within the model's context window (leaving a safety headroom
   * of 500 tokens for the completion).
   *
   * Rules:
   * 1. Preserves the system message.
   * 2. Preserves the newest messages.
   * 3. Trims the oldest conversation messages until token count <= limit.
   */
  private trimHistoryForContext(
    messagesList: Message[],
    newRequestTokens: number,
    limit: number
  ): { trimmedList: Message[]; info: TrimInfo } {
    const safetyBuffer = 500; // headroom for generation
    const targetLimit = Math.max(100, limit - safetyBuffer);

    let currentList = [...messagesList];
    const initialTokens = estimateConversationTokens(this.getPreparedMessages(currentList)) + newRequestTokens;

    if (initialTokens <= targetLimit || currentList.length <= 1) {
      return {
        trimmedList: currentList,
        info: {
          wasTrimmed: false,
          messagesRemoved: 0,
          originalTokens: initialTokens,
          trimmedTokens: initialTokens,
        },
      };
    }

    let removedCount = 0;
    while (currentList.length > 1) {
      // Remove oldest message
      currentList.shift();
      removedCount++;

      const tokensNow = estimateConversationTokens(this.getPreparedMessages(currentList)) + newRequestTokens;
      if (tokensNow <= targetLimit) {
        break;
      }
    }

    const finalTokens = estimateConversationTokens(this.getPreparedMessages(currentList)) + newRequestTokens;

    return {
      trimmedList: currentList,
      info: {
        wasTrimmed: true,
        messagesRemoved: removedCount,
        originalTokens: initialTokens,
        trimmedTokens: finalTokens,
      },
    };
  }

  // ==========================================
  // Core Message Sending Flow
  // ==========================================

  /**
   * Sends a user message to the LLM agent.
   *
   * Flow:
   * 1. Validate input & API key.
   * 2. Append user message to history.
   * 3. Apply context strategy (Demo Overflow vs Production Trimming).
   * 4. Call OpenRouter HTTP API.
   * 5. Parse response & usage tokens.
   * 6. Append assistant message to history.
   * 7. Persist updated history to localStorage.
   */
  public async sendMessage(content: string): Promise<string> {
    const trimmedInput = content.trim();
    if (!trimmedInput) {
      throw new Error('Message cannot be empty.');
    }

    if (this.isLoading) {
      throw new Error('Agent is already processing a request.');
    }

    if (!this.config.apiKey) {
      this.error = 'API key is not configured. Open Settings and enter your OpenRouter API key.';
      this.notify();
      throw new Error(this.error);
    }

    // Reset temporary error & trim states
    this.error = null;
    this.lastTrimInfo = null;

    // 1. Create and add user message
    const userMessageTokens = estimateTokens(trimmedInput);
    const userMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      tokens: userMessageTokens,
    };

    this.messages.push(userMessage);

    // 2. Determine message list to send based on mode
    let messagesToSend = [...this.messages];

    if (this.config.mode === 'production' && this.config.contextWindow !== null) {
      // Production mode: proactively trim to prevent context overflow
      const { trimmedList, info } = this.trimHistoryForContext(
        this.messages,
        userMessageTokens,
        this.config.contextWindow
      );
      if (info.wasTrimmed) {
        this.messages = trimmedList;
        messagesToSend = trimmedList;
        this.lastTrimInfo = info;
      }
    } else if (this.config.mode === 'demo' && this.config.contextWindow !== null) {
      // Demo Overflow mode: do NOT trim.
      // Check if current context already exceeds the configured limit to clearly inform student
      const totalEstimatedContext = estimateConversationTokens(this.getPreparedMessages(messagesToSend));
      if (totalEstimatedContext > this.config.contextWindow) {
        this.error = `Context limit exceeded.\n\nConversation: ${totalEstimatedContext.toLocaleString()} tokens\nModel limit: ${this.config.contextWindow.toLocaleString()} tokens`;
        // Save user message so student sees it in history, but do not call API
        saveMessages(this.messages);
        this.recalculateCurrentStats();
        this.notify();
        throw new Error(this.error);
      }
    }

    // Update token stats for pre-request stage
    const preparedMessages = this.getPreparedMessages(messagesToSend);
    const preRequestConvTokens = estimateConversationTokens(preparedMessages);
    this.tokenStats = {
      currentRequest: userMessageTokens,
      conversation: preRequestConvTokens,
      response: 0,
      total: preRequestConvTokens,
      contextWindow: this.config.contextWindow,
      isEstimated: true,
      estimatedCost: calculateEstimatedCost(preRequestConvTokens, 0, this.config.model),
    };

    this.isLoading = true;
    this.notify();

    try {
      // 3. Call OpenRouter HTTP API
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Educational AI Agent Chat',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: preparedMessages,
        }),
      });

      // 4. Handle HTTP / API errors
      if (!response.ok) {
        let errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // If response body is not JSON, use default status text
        }

        // Format user-friendly error messages
        if (response.status === 401) {
          errorMessage = 'Invalid API key. Please verify your OpenRouter API key in Settings.';
        } else if (response.status === 402) {
          errorMessage = 'Insufficient credits. Please check your OpenRouter account balance or switch to a free model.';
        } else if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment before sending another message.';
        } else if (response.status === 400 && errorMessage.toLowerCase().includes('context')) {
          // Real OpenRouter context limit exceeded error!
          errorMessage = `Context limit exceeded by API.\n\n${errorMessage}`;
        }

        console.error('[Agent] OpenRouter API call failed:', {
          status: response.status,
          message: errorMessage,
        });

        throw new Error(errorMessage);
      }

      // 5. Parse successful response
      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Received malformed response from OpenRouter API.');
      }

      const assistantContent: string = data.choices[0].message.content || '';

      // 6. Extract token usage statistics
      // OpenRouter returns usage: { prompt_tokens, completion_tokens, total_tokens }
      const usage = data.usage;
      const responseTokens = usage?.completion_tokens ?? estimateTokens(assistantContent);
      const promptTokens = usage?.prompt_tokens ?? preRequestConvTokens;
      const totalTokens = usage?.total_tokens ?? (promptTokens + responseTokens);
      const isEstimated = !usage;

      // 7. Create and append assistant message
      const assistantMessage: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
        tokens: responseTokens,
      };

      this.messages.push(assistantMessage);

      // 8. Update exact token stats
      this.tokenStats = {
        currentRequest: userMessageTokens,
        conversation: promptTokens,
        response: responseTokens,
        total: totalTokens,
        contextWindow: this.config.contextWindow,
        isEstimated,
        estimatedCost: calculateEstimatedCost(promptTokens, responseTokens, this.config.model),
      };

      // 9. Persist conversation history to localStorage
      saveMessages(this.messages);

      this.isLoading = false;
      this.notify();

      return assistantContent;
    } catch (err: unknown) {
      this.isLoading = false;
      const errorText = err instanceof Error ? err.message : 'An unexpected error occurred.';
      this.error = errorText;

      // Persist user message even if API call failed, so history is preserved
      saveMessages(this.messages);
      this.notify();
      throw err;
    }
  }
}

// Export a singleton instance for standard use across the app
export const agentInstance = new Agent();
