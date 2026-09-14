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
  ModelProvider,
  TrimInfo,
  CustomModel,
  StateListener,
  ConversationSummary,
} from './types';
import {
  loadMessages,
  saveMessages,
  clearMessages,
  loadConfig,
  saveConfig,
  loadCustomModels,
  saveCustomModels,
  loadSummary,
  saveSummary,
  clearSummary,
  migrateStorage,
  DEFAULT_SUMMARY,
} from './storage';
import {
  estimateTokens,
  estimateConversationTokens,
  calculateEstimatedCost,
  resolveContextLimit,
} from './tokenizer';
import { sendOllamaChat, fetchOllamaModelInfo } from './ollama';

export class Agent {
  private config: AgentConfig;
  private messages: Message[] = [];
  private summary: ConversationSummary;
  private tokenStats: TokenStats;
  private customModels: CustomModel[] = [];
  private isLoading = false;
  private isSummarizing = false;
  private error: string | null = null;
  private lastTrimInfo: TrimInfo | null = null;
  private listeners: Set<StateListener> = new Set();
  private executionQueue: Promise<unknown> = Promise.resolve();

  constructor(initialConfig?: Partial<AgentConfig>) {
    // 0. Ensure schema migrations have run
    migrateStorage();

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

    // 3. Load summary from localStorage
    this.summary = loadSummary();

    // 4. Load user-added custom models from localStorage
    this.customModels = loadCustomModels();

    // 5. Initialize token statistics based on restored history and summary
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
      isSummarizing: this.isSummarizing,
      error: this.error,
      lastTrimInfo: this.lastTrimInfo ? { ...this.lastTrimInfo } : null,
      summary: { ...this.summary },
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

  public setOllamaUrl(url: string): void {
    this.config.ollamaUrl = url.trim();
    saveConfig(this.config);
    this.notify();
  }

  public setProvider(provider: ModelProvider): void {
    this.config.provider = provider;
    saveConfig(this.config);
    this.recalculateCurrentStats();
    this.notify();
  }

  public async setModel(
    model: string,
    customContextWindow?: number | null,
    provider?: ModelProvider
  ): Promise<void> {
    this.config.model = model.trim();

    // Resolve provider if explicitly specified or look up in customModels
    if (provider) {
      this.config.provider = provider;
    } else {
      const foundCustom = this.customModels.find((m) => m.id === this.config.model);
      if (foundCustom && foundCustom.provider) {
        this.config.provider = foundCustom.provider;
      }
    }

    if (customContextWindow !== undefined) {
      this.config.contextWindow = customContextWindow;
    } else {
      // 1. Check if model is in customModels
      const foundCustom = this.customModels.find((m) => m.id === this.config.model);
      if (foundCustom && foundCustom.contextLength !== undefined && foundCustom.contextLength !== null) {
        this.config.contextWindow = foundCustom.contextLength;
      } else if (this.config.provider === 'ollama') {
        // Try fetching context from Ollama
        const info = await fetchOllamaModelInfo(this.config.ollamaUrl, this.config.model);
        this.config.contextWindow = info.contextLength;
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
      ? {
          id: model.trim(),
          contextLength: resolveContextLimit(model.trim()),
          provider: this.config.provider,
        }
      : {
          id: model.id.trim(),
          name: model.name,
          contextLength: model.contextLength,
          provider: model.provider || this.config.provider,
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
      this.setModel('openai/gpt-4o-mini', 128000, 'openrouter');
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

  /**
   * Configure recent messages count to keep in context as-is (N).
   */
  public setRecentMessagesCount(n: number): void {
    if (n > 0) {
      this.config.recentMessagesCount = Math.floor(n);
      saveConfig(this.config);
      this.recalculateCurrentStats();
      this.notify();
    }
  }

  /**
   * Configure the threshold of unsummarized older messages needed to trigger incremental summary.
   */
  public setSummaryThreshold(threshold: number): void {
    if (threshold > 0) {
      this.config.summaryThreshold = Math.floor(threshold);
      saveConfig(this.config);
      this.notify();
    }
  }

  // ==========================================
  // Summary Access & Management
  // ==========================================

  public getSummary(): ConversationSummary {
    return { ...this.summary };
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
    this.summary = loadSummary();
    this.tokenStats = this.calculateInitialTokenStats();
    this.lastTrimInfo = null;
    this.error = null;
    this.notify();
  }

  public saveHistory(): void {
    saveMessages(this.messages);
    saveSummary(this.summary);
  }

  public clearHistory(): void {
    this.messages = [];
    clearMessages();
    this.summary = { ...DEFAULT_SUMMARY };
    clearSummary();
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
      estimatedCost: calculateEstimatedCost(conversationTokens, 0, this.config.model, this.config.provider),
      isLocal: this.config.provider === 'ollama',
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
      estimatedCost: calculateEstimatedCost(conversationTokens, this.tokenStats.response, this.config.model, this.config.provider),
      isLocal: this.config.provider === 'ollama',
    };
  }

  /**
   * Prepares the messages array for LLM context.
   * Transmits:
   * 1. system prompt
   * 2. summary of previous conversation history (if present)
   * 3. last N messages without changes
   * 4. new user message (if provided)
   */
  public getPreparedMessages(
    messagesList: Message[],
    newUserMessage?: { role: string; content: string }
  ): Array<{ role: string; content: string }> {
    const prepared: Array<{ role: string; content: string }> = [];

    // 1. system prompt
    if (this.config.systemPrompt && this.config.systemPrompt.trim()) {
      prepared.push({
        role: 'system',
        content: this.config.systemPrompt.trim(),
      });
    }

    // 2. summary of old conversation (if available)
    if (this.summary && this.summary.summary && this.summary.summary.trim()) {
      prepared.push({
        role: 'system',
        content: `Summary of previous conversation:\n${this.summary.summary.trim()}`,
      });
    }

    // 3. last N messages without changes
    const recent = messagesList.slice(-this.config.recentMessagesCount);
    for (const msg of recent) {
      prepared.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 4. new user message (if provided)
    if (newUserMessage) {
      prepared.push({
        role: newUserMessage.role,
        content: newUserMessage.content,
      });
    }

    return prepared;
  }

  // ==========================================
  // Context Trimming Logic (Fallback for tight context limits)
  // ==========================================

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
  // LLM Communication Layer
  // ==========================================

  private async callLLM(
    messages: Array<{ role: string; content: string }>,
    modelToUse?: string
  ): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    isEstimated: boolean;
  }> {
    const model = modelToUse || this.config.model;

    if (this.config.provider === 'ollama') {
      const ollamaRes = await sendOllamaChat(this.config.ollamaUrl, {
        model,
        messages,
      });

      const promptTokens = ollamaRes.promptTokens || estimateConversationTokens(messages);
      const completionTokens = ollamaRes.responseTokens || estimateTokens(ollamaRes.content);
      return {
        content: ollamaRes.content,
        promptTokens,
        completionTokens,
        totalTokens: ollamaRes.totalTokens || (promptTokens + completionTokens),
        isEstimated: ollamaRes.promptTokens === 0 && ollamaRes.responseTokens === 0,
      };
    } else {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
          'X-Title': 'Educational AI Agent Chat',
        },
        body: JSON.stringify({
          model,
          messages,
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {}

        if (response.status === 401) {
          errorMessage = 'Invalid API key. Please verify your OpenRouter API key in Settings.';
        } else if (response.status === 402) {
          errorMessage = 'Insufficient credits. Please check your OpenRouter account balance or switch to a free model.';
        } else if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment before sending another message.';
        } else if (response.status === 400 && errorMessage.toLowerCase().includes('context')) {
          errorMessage = `Context limit exceeded by API.\n\n${errorMessage}`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Received malformed response from OpenRouter API.');
      }

      const assistantContent = data.choices[0].message.content || '';
      const usage = data.usage;
      const promptTokens = usage?.prompt_tokens ?? estimateConversationTokens(messages);
      const completionTokens = usage?.completion_tokens ?? estimateTokens(assistantContent);
      const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);

      return {
        content: assistantContent,
        promptTokens,
        completionTokens,
        totalTokens,
        isEstimated: !usage,
      };
    }
  }

  // ==========================================
  // Incremental Summary Generation
  // ==========================================

  /**
   * Periodically updates the conversation summary when messages older than
   * the recent N window accumulate beyond summaryThreshold.
   *
   * Incremental approach:
   * Takes existing summary + new unsummarized messages older than N,
   * calls LLM to produce an updated summary, and updates the lastSummarizedMessageId pointer.
   *
   * Error handling:
   * If summary generation fails, existing summary, pointer, and history remain untouched.
   */
  private async updateSummaryIfNeeded(olderMessages: Message[]): Promise<void> {
    if (olderMessages.length === 0) return;

    let unsummarized: Message[] = [];
    if (this.summary.lastSummarizedMessageId) {
      const lastIdx = olderMessages.findIndex((m) => m.id === this.summary.lastSummarizedMessageId);
      if (lastIdx >= 0) {
        unsummarized = olderMessages.slice(lastIdx + 1);
      } else {
        const allIdx = this.messages.findIndex((m) => m.id === this.summary.lastSummarizedMessageId);
        if (allIdx >= olderMessages.length) {
          unsummarized = [];
        } else {
          unsummarized = olderMessages;
        }
      }
    } else {
      unsummarized = olderMessages;
    }

    // Only update if accumulated unsummarized count reaches threshold
    if (unsummarized.length < this.config.summaryThreshold) {
      return;
    }

    this.isSummarizing = true;
    this.notify();

    try {
      const formattedBatch = unsummarized
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const promptMessages: Array<{ role: string; content: string }> = [
        {
          role: 'system',
          content:
            'You are an expert conversation summarizer. Your task is to maintain a concise, factual summary of the ongoing conversation. Retain all critical facts, user requirements, decisions, names, and context accurately in concise bullet points or short paragraphs.',
        },
      ];

      if (this.summary.summary && this.summary.summary.trim()) {
        promptMessages.push({
          role: 'user',
          content: `Existing conversation summary:\n${this.summary.summary.trim()}\n\nNew messages to append and incorporate into the summary:\n${formattedBatch}\n\nProvide an updated, cohesive summary incorporating both the existing summary and the new messages:`,
        });
      } else {
        promptMessages.push({
          role: 'user',
          content: `Summarize the following conversation messages:\n\n${formattedBatch}\n\nProvide a concise summary:`,
        });
      }

      const res = await this.callLLM(promptMessages);
      const newSummaryText = res.content.trim();

      if (newSummaryText) {
        const lastMsg = unsummarized[unsummarized.length - 1];
        const lastMsgIdx = this.messages.findIndex((m) => m.id === lastMsg.id);

        this.summary = {
          summary: newSummaryText,
          lastSummarizedMessageId: lastMsg.id,
          lastSummarizedIndex: lastMsgIdx,
          updatedAt: Date.now(),
          version: (this.summary.version || 1) + 1,
        };

        saveSummary(this.summary);
      }
    } catch (err) {
      // Graceful degradation: do NOT fail chat, do NOT modify history or existing summary
      console.warn('[Agent] Incremental summary update failed (graceful degradation):', err);
    } finally {
      this.isSummarizing = false;
      this.notify();
    }
  }

  // ==========================================
  // Core Message Sending Flow
  // ==========================================

  /**
   * Sends a user message to the LLM agent.
   *
   * Sequential execution queue ensures full protection against race conditions
   * during concurrent calls.
   */
  public sendMessage(content: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.executionQueue = this.executionQueue
        .then(() => this._executeSendMessage(content))
        .then(resolve, reject);
    });
  }

  private async _executeSendMessage(content: string): Promise<string> {
    const trimmedInput = content.trim();
    if (!trimmedInput) {
      throw new Error('Message cannot be empty.');
    }

    if (this.isLoading) {
      throw new Error('Agent is already processing a request.');
    }

    // OpenRouter requires an API key; Ollama does not
    if (this.config.provider === 'openrouter' && !this.config.apiKey) {
      this.error = 'API key is not configured. Open Settings and enter your OpenRouter API key.';
      this.notify();
      throw new Error(this.error);
    }

    // Reset temporary error & trim states
    this.error = null;
    this.lastTrimInfo = null;

    // 1. Check if unsummarized older messages need to be summarized before sending
    const olderCutoff = Math.max(0, this.messages.length - this.config.recentMessagesCount);
    if (olderCutoff > 0) {
      const olderMessages = this.messages.slice(0, olderCutoff);
      await this.updateSummaryIfNeeded(olderMessages);
    }

    // 2. Create user message
    const userMessageTokens = estimateTokens(trimmedInput);
    const userMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      tokens: userMessageTokens,
    };

    // Past messages before this new message
    const pastMessages = [...this.messages];

    // 3. Prepare messages to send to LLM:
    // system prompt + summary (if present) + last N past messages + new user message
    let messagesToSend = this.getPreparedMessages(pastMessages, userMessage);

    // 4. Handle Context Window limits (Production Trimming vs Demo Overflow)
    if (this.config.mode === 'production' && this.config.contextWindow !== null) {
      const { trimmedList, info } = this.trimHistoryForContext(
        pastMessages,
        userMessageTokens,
        this.config.contextWindow
      );
      if (info.wasTrimmed) {
        messagesToSend = this.getPreparedMessages(trimmedList, userMessage);
        this.lastTrimInfo = info;
      }
    } else if (this.config.mode === 'demo' && this.config.contextWindow !== null) {
      const totalEstimatedContext = estimateConversationTokens(messagesToSend);
      if (totalEstimatedContext > this.config.contextWindow) {
        this.error = `Context limit exceeded.\n\nConversation: ${totalEstimatedContext.toLocaleString()} tokens\nModel limit: ${this.config.contextWindow.toLocaleString()} tokens`;
        this.messages.push(userMessage);
        saveMessages(this.messages);
        this.recalculateCurrentStats();
        this.notify();
        throw new Error(this.error);
      }
    }

    // 5. Add user message immediately so it renders in the UI before network call
    this.messages.push(userMessage);
    saveMessages(this.messages);

    // Update token stats for pre-request stage
    const preRequestConvTokens = estimateConversationTokens(messagesToSend);
    this.tokenStats = {
      currentRequest: userMessageTokens,
      conversation: preRequestConvTokens,
      response: 0,
      total: preRequestConvTokens,
      contextWindow: this.config.contextWindow,
      isEstimated: true,
      estimatedCost: calculateEstimatedCost(preRequestConvTokens, 0, this.config.model, this.config.provider),
      isLocal: this.config.provider === 'ollama',
    };

    this.isLoading = true;
    this.notify();

    try {
      // 6. Call LLM
      const res = await this.callLLM(messagesToSend);

      // 7. Create and append assistant message
      const assistantMessage: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: 'assistant',
        content: res.content,
        timestamp: Date.now(),
        tokens: res.completionTokens,
      };

      this.messages.push(assistantMessage);

      // 8. Update exact token stats
      this.tokenStats = {
        currentRequest: userMessageTokens,
        conversation: res.promptTokens,
        response: res.completionTokens,
        total: res.totalTokens,
        contextWindow: this.config.contextWindow,
        isEstimated: res.isEstimated,
        estimatedCost: calculateEstimatedCost(res.promptTokens, res.completionTokens, this.config.model, this.config.provider),
        isLocal: this.config.provider === 'ollama',
      };

      // 9. Persist conversation history to localStorage
      saveMessages(this.messages);

      this.isLoading = false;
      this.notify();

      return res.content;
    } catch (err: unknown) {
      this.isLoading = false;
      const errorText = err instanceof Error ? err.message : 'An unexpected error occurred.';
      this.error = errorText;

      // Roll back user message from history on LLM call error
      this.messages = this.messages.filter((m) => m.id !== userMessage.id);
      saveMessages(this.messages);
      this.recalculateCurrentStats();
      this.notify();
      throw err;
    }
  }
}

// Export a singleton instance for standard use across the app
export const agentInstance = new Agent();
