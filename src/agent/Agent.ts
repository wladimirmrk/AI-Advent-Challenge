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
  ContextStrategy,
  ModelProvider,
  TrimInfo,
  CustomModel,
  StateListener,
  ConversationSummary,
  FactItem,
  DialogueBranch,
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
  loadFacts,
  saveFacts,
  clearFacts,
  loadBranches,
  saveBranches,
  loadActiveBranchId,
  saveActiveBranchId,
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
  private chatId: string;
  private config: AgentConfig;
  private messages: Message[] = [];
  private summary: ConversationSummary;
  private facts: FactItem[] = [];
  private branches: DialogueBranch[] = [];
  private activeBranchId = 'main';
  private tokenStats: TokenStats;
  private customModels: CustomModel[] = [];
  private isLoading = false;
  private isSummarizing = false;
  private isExtractingFacts = false;
  private error: string | null = null;
  private lastTrimInfo: TrimInfo | null = null;
  private listeners: Set<StateListener> = new Set();
  private executionQueue: Promise<unknown> = Promise.resolve();
  private onMessageSent?: (content: string, role: 'user' | 'assistant') => void;

  constructor(
    chatIdOrConfig: string | Partial<AgentConfig> = 'default',
    initialConfig?: Partial<AgentConfig>
  ) {
    let resolvedChatId = 'default';
    let resolvedConfig: Partial<AgentConfig> | undefined = initialConfig;

    if (typeof chatIdOrConfig === 'string') {
      resolvedChatId = chatIdOrConfig;
    } else if (chatIdOrConfig && typeof chatIdOrConfig === 'object') {
      resolvedConfig = chatIdOrConfig;
    }

    this.chatId = resolvedChatId;

    // 0. Ensure schema migrations have run
    migrateStorage();

    // 1. Load saved configuration from localStorage (or fallback to defaults and .env)
    const storedConfig = loadConfig(this.chatId);
    this.config = {
      ...storedConfig,
      ...resolvedConfig,
    };

    // Auto-resolve context window if not explicitly provided
    if (this.config.contextWindow === null && this.config.model) {
      this.config.contextWindow = resolveContextLimit(this.config.model);
    }

    // 2. Load sticky facts
    this.facts = loadFacts(this.chatId);

    // 3. Load branches and active branch
    this.branches = loadBranches(this.chatId);
    this.activeBranchId = loadActiveBranchId(this.chatId);

    // 4. Load conversation history from localStorage
    const savedMessages = loadMessages(this.chatId);

    // Ensure at least a default 'main' branch exists
    if (this.branches.length === 0) {
      this.branches = [
        {
          id: 'main',
          name: 'Main',
          createdAt: Date.now(),
          messages: savedMessages,
        },
      ];
      this.activeBranchId = 'main';
      saveBranches(this.branches, this.chatId);
      saveActiveBranchId('main', this.chatId);
      this.messages = savedMessages;
    } else {
      const activeBranch = this.branches.find((b) => b.id === this.activeBranchId) || this.branches[0];
      this.activeBranchId = activeBranch.id;
      // Active branch messages take precedence if savedMessages matches or branch has messages
      this.messages = activeBranch.messages || savedMessages;
    }

    // 5. Load summary from localStorage
    this.summary = loadSummary(this.chatId);

    // 6. Load user-added custom models from localStorage
    this.customModels = loadCustomModels();

    // 7. Initialize token statistics based on restored history and context strategy
    this.tokenStats = this.calculateInitialTokenStats();
  }

  public getChatId(): string {
    return this.chatId;
  }

  public setOnMessageSent(callback: (content: string, role: 'user' | 'assistant') => void): void {
    this.onMessageSent = callback;
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
      isExtractingFacts: this.isExtractingFacts,
      error: this.error,
      lastTrimInfo: this.lastTrimInfo ? { ...this.lastTrimInfo } : null,
      summary: { ...this.summary },
      facts: [...this.facts],
      branches: [...this.branches],
      activeBranchId: this.activeBranchId,
    };
  }

  // ==========================================
  // Configuration Setters
  // ==========================================

  public setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey.trim();
    saveConfig(this.config, this.chatId);
    this.error = null;
    this.notify();
  }

  public setOllamaUrl(url: string): void {
    this.config.ollamaUrl = url.trim();
    saveConfig(this.config, this.chatId);
    this.notify();
  }

  public setProvider(provider: ModelProvider): void {
    this.config.provider = provider;
    saveConfig(this.config, this.chatId);
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
    saveConfig(this.config, this.chatId);
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
    saveConfig(this.config, this.chatId);
    this.notify();
  }

  public setStrategy(strategy: ContextStrategy): void {
    this.config.strategy = strategy;
    if (strategy === 'demo') {
      this.config.mode = 'demo';
    } else {
      this.config.mode = 'production';
    }
    saveConfig(this.config, this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  public setMode(mode: AgentMode): void {
    this.config.mode = mode;
    if (mode === 'demo') {
      this.config.strategy = 'demo';
    } else if (this.config.strategy === 'demo') {
      this.config.strategy = 'sliding_window';
    }
    saveConfig(this.config, this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  public setSystemPrompt(systemPrompt: string): void {
    this.config.systemPrompt = systemPrompt;
    saveConfig(this.config, this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  /**
   * Configure recent messages count to keep in context as-is (N).
   */
  public setRecentMessagesCount(n: number): void {
    if (n > 0) {
      this.config.recentMessagesCount = Math.floor(n);
      saveConfig(this.config, this.chatId);
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
      saveConfig(this.config, this.chatId);
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
  // Sticky Facts (Key-Value Memory) Management
  // ==========================================

  public getFacts(): FactItem[] {
    return [...this.facts];
  }

  public addFact(key: string, value: string, category: FactItem['category'] = 'other'): void {
    const trimmedKey = key.trim();
    const trimmedVal = value.trim();
    if (!trimmedKey || !trimmedVal) return;

    const existingIdx = this.facts.findIndex(
      (f) => f.key.toLowerCase() === trimmedKey.toLowerCase()
    );

    if (existingIdx >= 0) {
      this.facts[existingIdx] = {
        ...this.facts[existingIdx],
        value: trimmedVal,
        category: category || this.facts[existingIdx].category,
        updatedAt: Date.now(),
      };
    } else {
      this.facts.push({
        id: `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        key: trimmedKey,
        value: trimmedVal,
        category,
        updatedAt: Date.now(),
      });
    }

    saveFacts(this.facts, this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  public updateFact(id: string, updates: Partial<Omit<FactItem, 'id'>>): void {
    const idx = this.facts.findIndex((f) => f.id === id);
    if (idx >= 0) {
      this.facts[idx] = {
        ...this.facts[idx],
        ...updates,
        updatedAt: Date.now(),
      };
      saveFacts(this.facts, this.chatId);
      this.recalculateCurrentStats();
      this.notify();
    }
  }

  public removeFact(id: string): void {
    this.facts = this.facts.filter((f) => f.id !== id);
    saveFacts(this.facts, this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  public clearFacts(): void {
    this.facts = [];
    clearFacts(this.chatId);
    this.recalculateCurrentStats();
    this.notify();
  }

  public async extractFactsInBackground(userContent: string, assistantContent: string): Promise<void> {
    if (this.isExtractingFacts) return;

    this.isExtractingFacts = true;
    this.notify();

    try {
      const existingFactsSummary =
        this.facts.length > 0
          ? JSON.stringify(this.facts.map((f) => ({ key: f.key, value: f.value, category: f.category })))
          : '[]';

      const extractionPrompt = [
        {
          role: 'system',
          content: `You are a factual key-value memory extractor for an AI dialogue.
Analyze the latest exchange between User and Assistant, and extract or update important sticky facts.
Categories must be one of: "goal", "constraint", "preference", "decision", "agreement", "other".
Existing facts (JSON):
${existingFactsSummary}

Latest exchange:
User: ${userContent}
Assistant: ${assistantContent}

Respond ONLY with a valid JSON array of fact objects:
[
  { "key": "short descriptive key", "value": "fact content", "category": "goal|constraint|preference|decision|agreement|other" }
]
If facts changed or new facts arrived, include the complete updated list. If no new facts, return existing facts.
Do NOT wrap output in markdown fences, return pure JSON array.`,
        },
      ];

      const res = await this.callLLM(extractionPrompt);
      const cleaned = res.content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        const validCategories: FactItem['category'][] = ['goal', 'constraint', 'preference', 'decision', 'agreement', 'other'];
        const newFacts: FactItem[] = [];

        for (const item of parsed) {
          if (item && typeof item.key === 'string' && typeof item.value === 'string' && item.key.trim() && item.value.trim()) {
            const cat = validCategories.includes(item.category) ? item.category : 'other';
            newFacts.push({
              id: `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              key: item.key.trim(),
              value: item.value.trim(),
              category: cat,
              updatedAt: Date.now(),
            });
          }
        }

        if (newFacts.length > 0) {
          this.facts = newFacts;
          saveFacts(this.facts, this.chatId);
        }
      }
    } catch (err) {
      console.warn('[Agent] Background facts extraction skipped or failed:', err);
    } finally {
      this.isExtractingFacts = false;
      this.recalculateCurrentStats();
      this.notify();
    }
  }

  // ==========================================
  // Branch Management (Branching Strategy)
  // ==========================================

  public getBranches(): DialogueBranch[] {
    return [...this.branches];
  }

  public getActiveBranchId(): string {
    return this.activeBranchId;
  }

  public createBranch(name: string, fromMessageId?: string): DialogueBranch {
    const trimmedName = name.trim() || `Branch ${this.branches.length + 1}`;
    let forkedMessages: Message[] = [];

    if (fromMessageId) {
      const idx = this.messages.findIndex((m) => m.id === fromMessageId);
      if (idx >= 0) {
        forkedMessages = this.messages.slice(0, idx + 1);
      } else {
        forkedMessages = [...this.messages];
      }
    } else {
      forkedMessages = [...this.messages];
    }

    const newBranch: DialogueBranch = {
      id: `branch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: trimmedName,
      parentBranchId: this.activeBranchId,
      checkpointMessageId: fromMessageId,
      createdAt: Date.now(),
      messages: forkedMessages,
    };

    // Save current active branch state before switching
    const currentActiveIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
    if (currentActiveIdx >= 0) {
      this.branches[currentActiveIdx].messages = [...this.messages];
    }

    this.branches.push(newBranch);
    this.activeBranchId = newBranch.id;
    this.messages = [...forkedMessages];

    saveBranches(this.branches, this.chatId);
    saveActiveBranchId(this.activeBranchId, this.chatId);
    saveMessages(this.messages, this.chatId);

    this.recalculateCurrentStats();
    this.notify();

    return newBranch;
  }

  public switchBranch(branchId: string): void {
    if (branchId === this.activeBranchId) return;
    const targetBranch = this.branches.find((b) => b.id === branchId);
    if (!targetBranch) return;

    // Save current messages to active branch before switching
    const currentActiveIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
    if (currentActiveIdx >= 0) {
      this.branches[currentActiveIdx].messages = [...this.messages];
    }

    this.activeBranchId = targetBranch.id;
    this.messages = [...targetBranch.messages];

    saveBranches(this.branches, this.chatId);
    saveActiveBranchId(this.activeBranchId, this.chatId);
    saveMessages(this.messages, this.chatId);

    this.recalculateCurrentStats();
    this.notify();
  }

  public renameBranch(branchId: string, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const branch = this.branches.find((b) => b.id === branchId);
    if (branch) {
      branch.name = trimmed;
      saveBranches(this.branches, this.chatId);
      this.notify();
    }
  }

  public deleteBranch(branchId: string): void {
    if (this.branches.length <= 1) return; // Keep at least one branch
    const branchIndex = this.branches.findIndex((b) => b.id === branchId);
    if (branchIndex < 0) return;

    this.branches.splice(branchIndex, 1);

    if (this.activeBranchId === branchId) {
      const fallbackBranch = this.branches[0];
      this.activeBranchId = fallbackBranch.id;
      this.messages = [...fallbackBranch.messages];
      saveActiveBranchId(this.activeBranchId, this.chatId);
      saveMessages(this.messages, this.chatId);
    }

    saveBranches(this.branches, this.chatId);
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
    this.messages = loadMessages(this.chatId);
    this.summary = loadSummary(this.chatId);
    this.facts = loadFacts(this.chatId);
    this.branches = loadBranches(this.chatId);
    this.activeBranchId = loadActiveBranchId(this.chatId);
    this.tokenStats = this.calculateInitialTokenStats();
    this.lastTrimInfo = null;
    this.error = null;
    this.notify();
  }

  public saveHistory(): void {
    saveMessages(this.messages, this.chatId);
    saveSummary(this.summary, this.chatId);
    saveFacts(this.facts, this.chatId);
    saveBranches(this.branches, this.chatId);
    saveActiveBranchId(this.activeBranchId, this.chatId);
  }

  public clearHistory(): void {
    this.messages = [];
    clearMessages(this.chatId);

    // Clear messages for active branch as well
    const branchIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
    if (branchIdx >= 0) {
      this.branches[branchIdx].messages = [];
      saveBranches(this.branches, this.chatId);
    }

    this.summary = { ...DEFAULT_SUMMARY };
    clearSummary(this.chatId);
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
   * Prepares the messages array for LLM context according to active strategy:
   * - sliding_window: system prompt + last N messages
   * - sticky_facts: system prompt + Key-Value facts + last N messages
   * - branching: system prompt + last N messages of active branch
   * - summary: system prompt + incremental summary + last N messages
   * - demo: system prompt + full message history (Demo Overflow)
   */
  public getPreparedMessages(
    messagesList: Message[],
    newUserMessage?: { role: string; content: string }
  ): Array<{ role: string; content: string }> {
    const prepared: Array<{ role: string; content: string }> = [];

    // 1. System prompt
    if (this.config.systemPrompt && this.config.systemPrompt.trim()) {
      prepared.push({
        role: 'system',
        content: this.config.systemPrompt.trim(),
      });
    }

    const strategy = this.config.strategy || (this.config.mode === 'demo' ? 'demo' : 'sliding_window');

    // 2. Strategy-specific context augmentation
    if (strategy === 'summary') {
      if (this.summary && this.summary.summary && this.summary.summary.trim()) {
        prepared.push({
          role: 'system',
          content: `Summary of previous conversation:\n${this.summary.summary.trim()}`,
        });
      }
    } else if (strategy === 'sticky_facts') {
      if (this.facts && this.facts.length > 0) {
        const formattedFacts = this.facts
          .map((f) => `- [${f.category || 'fact'}] ${f.key}: ${f.value}`)
          .join('\n');
        prepared.push({
          role: 'system',
          content: `Key-Value Memory (Sticky Facts from conversation):\n${formattedFacts}`,
        });
      }
    }

    // 3. Message history window
    if (strategy === 'demo' || strategy === 'branching') {
      // Full history: Demo (untrimmed) and Branching (full branch thread)
      for (const msg of messagesList) {
        prepared.push({
          role: msg.role,
          content: msg.content,
        });
      }
    } else {
      // Sliding window across sliding_window, sticky_facts, summary
      const recent = messagesList.slice(-this.config.recentMessagesCount);
      for (const msg of recent) {
        prepared.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // 4. New user message (if provided)
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

        saveSummary(this.summary, this.chatId);
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

    // 1. Check if unsummarized older messages need to be summarized (only for summary strategy)
    if (this.config.strategy === 'summary') {
      const olderCutoff = Math.max(0, this.messages.length - this.config.recentMessagesCount);
      if (olderCutoff > 0) {
        const olderMessages = this.messages.slice(0, olderCutoff);
        await this.updateSummaryIfNeeded(olderMessages);
      }
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

    // Trigger onMessageSent if this is the first message in the chat
    if (pastMessages.length === 0) {
      try {
        this.onMessageSent?.(trimmedInput, 'user');
      } catch (cbErr) {
        console.warn('[Agent] onMessageSent callback error:', cbErr);
      }
    }

    // 3. Prepare messages to send to LLM according to strategy
    let messagesToSend = this.getPreparedMessages(pastMessages, userMessage);

    // 4. Handle Context Window limits (Trimming vs Demo Overflow)
    const isDemo = this.config.strategy === 'demo' || this.config.mode === 'demo';

    if (!isDemo && this.config.contextWindow !== null) {
      const { trimmedList, info } = this.trimHistoryForContext(
        pastMessages,
        userMessageTokens,
        this.config.contextWindow
      );
      if (info.wasTrimmed) {
        messagesToSend = this.getPreparedMessages(trimmedList, userMessage);
        this.lastTrimInfo = info;
      }
    } else if (isDemo && this.config.contextWindow !== null) {
      const totalEstimatedContext = estimateConversationTokens(messagesToSend);
      if (totalEstimatedContext > this.config.contextWindow) {
        this.error = `Context limit exceeded.\n\nConversation: ${totalEstimatedContext.toLocaleString()} tokens\nModel limit: ${this.config.contextWindow.toLocaleString()} tokens`;
        this.messages.push(userMessage);
        saveMessages(this.messages, this.chatId);
        this.recalculateCurrentStats();
        this.notify();
        throw new Error(this.error);
      }
    }

    // 5. Add user message immediately so it renders in the UI before network call
    this.messages.push(userMessage);
    saveMessages(this.messages, this.chatId);

    // Sync active branch with the new user message
    const branchPreIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
    if (branchPreIdx >= 0) {
      this.branches[branchPreIdx].messages = [...this.messages];
      saveBranches(this.branches, this.chatId);
    }

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

      // 9. Persist conversation history to localStorage and update active branch
      saveMessages(this.messages, this.chatId);
      const branchPostIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
      if (branchPostIdx >= 0) {
        this.branches[branchPostIdx].messages = [...this.messages];
        saveBranches(this.branches, this.chatId);
      }

      this.isLoading = false;
      this.notify();

      // 10. If in Sticky Facts strategy, trigger background fact extraction
      if (this.config.strategy === 'sticky_facts') {
        this.extractFactsInBackground(userMessage.content, assistantMessage.content);
      }

      return res.content;
    } catch (err: unknown) {
      this.isLoading = false;
      const errorText = err instanceof Error ? err.message : 'An unexpected error occurred.';
      this.error = errorText;

      // Roll back user message from history on LLM call error
      this.messages = this.messages.filter((m) => m.id !== userMessage.id);
      saveMessages(this.messages, this.chatId);
      const branchErrIdx = this.branches.findIndex((b) => b.id === this.activeBranchId);
      if (branchErrIdx >= 0) {
        this.branches[branchErrIdx].messages = [...this.messages];
        saveBranches(this.branches, this.chatId);
      }
      this.recalculateCurrentStats();
      this.notify();
      throw err;
    }
  }
}

// Export a singleton instance for standard use across the app
export const agentInstance = new Agent();
