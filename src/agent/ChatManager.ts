/**
 * ChatManager
 *
 * Coordinates multiple parallel chat sessions.
 * Each chat session has its own independent Agent instance with its own isolated
 * memory, dialogue history, sticky facts, summary, and branching trees.
 *
 * API keys and global provider URLs are shared across all chats.
 */

import { ChatMetadata } from './types';
import { Agent } from './Agent';
import {
  loadChatList,
  saveChatList,
  loadActiveChatId,
  saveActiveChatId,
  deleteChatStorage,
  loadDefaultModelConfig,
} from './storage';

export interface ChatManagerState {
  chats: ChatMetadata[];
  activeChatId: string;
  activeAgent: Agent;
}

export type ChatManagerListener = (state: ChatManagerState) => void;

export class ChatManager {
  private chats: ChatMetadata[] = [];
  private activeChatId: string = 'default';
  private agentMap: Map<string, Agent> = new Map();
  private listeners: Set<ChatManagerListener> = new Set();

  constructor() {
    this.chats = loadChatList();
    this.activeChatId = loadActiveChatId();

    if (this.chats.length === 0) {
      const defaultChat: ChatMetadata = {
        id: 'default',
        title: 'Основной чат',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.chats = [defaultChat];
      this.activeChatId = 'default';
      saveChatList(this.chats);
      saveActiveChatId(this.activeChatId);
    } else {
      const exists = this.chats.some((c) => c.id === this.activeChatId);
      if (!exists) {
        this.activeChatId = this.chats[0].id;
        saveActiveChatId(this.activeChatId);
      }
    }
  }

  public subscribe(listener: ChatManagerListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((l) => l(state));
  }

  public getState(): ChatManagerState {
    return {
      chats: [...this.chats],
      activeChatId: this.activeChatId,
      activeAgent: this.getActiveAgent(),
    };
  }

  public getChats(): ChatMetadata[] {
    return [...this.chats];
  }

  public getActiveChatId(): string {
    return this.activeChatId;
  }

  public getActiveAgent(): Agent {
    return this.getAgent(this.activeChatId);
  }

  public getAgent(chatId: string, initialConfig?: Partial<import('./types').AgentConfig>): Agent {
    let agent = this.agentMap.get(chatId);
    if (!agent) {
      agent = new Agent(chatId, initialConfig);

      // Setup auto-rename callback on first message
      agent.setOnMessageSent((content: string, role: 'user' | 'assistant') => {
        if (role === 'user') {
          this.handleAutoRenameOnFirstMessage(chatId, content);
        }
      });

      this.agentMap.set(chatId, agent);
    }
    return agent;
  }

  private handleAutoRenameOnFirstMessage(chatId: string, firstMessage: string): void {
    const chat = this.chats.find((c) => c.id === chatId);
    if (!chat) return;

    // Auto-rename if title is the default "Новый чат"
    if (chat.title === 'Новый чат' || !chat.title.trim()) {
      const cleanExcerpt = firstMessage
        .trim()
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 32)
        .trim();

      if (cleanExcerpt) {
        chat.title = cleanExcerpt;
        chat.updatedAt = Date.now();
        saveChatList(this.chats);
        this.notify();
      }
    }
  }

  public createChat(title?: string): { chat: ChatMetadata; agent: Agent } {
    const newChat: ChatMetadata = {
      id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: title && title.trim() ? title.trim() : 'Новый чат',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Prepend new chat to list (newest first)
    this.chats = [newChat, ...this.chats];
    this.activeChatId = newChat.id;

    saveChatList(this.chats);
    saveActiveChatId(this.activeChatId);

    const defaultModel = loadDefaultModelConfig();
    const agent = this.getAgent(newChat.id, {
      model: defaultModel.model,
      provider: defaultModel.provider,
      contextWindow: defaultModel.contextWindow,
    });
    this.notify();

    return { chat: newChat, agent };
  }

  public selectChat(chatId: string): void {
    if (chatId === this.activeChatId) return;
    const exists = this.chats.some((c) => c.id === chatId);
    if (!exists) return;

    this.activeChatId = chatId;
    saveActiveChatId(this.activeChatId);
    this.notify();
  }

  public renameChat(chatId: string, newTitle: string): void {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    const chat = this.chats.find((c) => c.id === chatId);
    if (chat) {
      chat.title = trimmed;
      chat.updatedAt = Date.now();
      saveChatList(this.chats);
      this.notify();
    }
  }

  public deleteChat(chatId: string): void {
    const index = this.chats.findIndex((c) => c.id === chatId);
    if (index < 0) return;

    this.chats.splice(index, 1);
    this.agentMap.delete(chatId);
    deleteChatStorage(chatId);

    // If all chats were deleted, automatically create a fresh one
    if (this.chats.length === 0) {
      const defaultModel = loadDefaultModelConfig();
      const freshChat: ChatMetadata = {
        id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        title: 'Новый чат',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.chats = [freshChat];
      this.activeChatId = freshChat.id;
      this.getAgent(freshChat.id, {
        model: defaultModel.model,
        provider: defaultModel.provider,
        contextWindow: defaultModel.contextWindow,
      });
    } else if (this.activeChatId === chatId) {
      this.activeChatId = this.chats[0].id;
    }

    saveChatList(this.chats);
    saveActiveChatId(this.activeChatId);
    this.notify();
  }
}

export const chatManagerInstance = new ChatManager();
