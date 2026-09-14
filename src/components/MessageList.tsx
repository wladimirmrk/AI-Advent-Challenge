import React, { useEffect, useRef } from 'react';
import { Message, TrimInfo, ContextStrategy } from '../agent/types';
import {
  User,
  Bot,
  AlertTriangle,
  Sparkles,
  Scissors,
  X,
  GitBranch,
  Layers,
} from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastTrimInfo: TrimInfo | null;
  strategy?: ContextStrategy;
  recentMessagesCount?: number;
  onClearError: () => void;
  onSuggestionClick?: (prompt: string) => void;
  onBranchFromMessage?: (messageId: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  error,
  lastTrimInfo,
  strategy = 'sliding_window',
  recentMessagesCount = 10,
  onClearError,
  onSuggestionClick,
  onBranchFromMessage,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error, lastTrimInfo]);

  return (
    <div className="message-list-wrapper">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon-circle">
            <Bot size={36} />
          </div>
          <h2>Welcome to Educational AI Agent Chat</h2>
          <p className="empty-subtitle">
            This chat showcases how an AI Agent manages conversation context, local persistence,
            and token usage using direct OpenRouter API calls.
          </p>

          <div className="quick-suggestions">
            <div className="suggestion-title">Try asking:</div>
            <div className="suggestion-grid">
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggestionClick?.('Меня зовут Алексей. Запомни это.')}
              >
                <Sparkles size={14} />
                <span>"Меня зовут Алексей. Запомни это." (Test persistence)</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggestionClick?.('Расскажи коротко, что такое LLM-агент?')}
              >
                <Sparkles size={14} />
                <span>"Расскажи коротко, что такое LLM-агент?"</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggestionClick?.('Чем отличаются prompt tokens и completion tokens?')}
              >
                <Sparkles size={14} />
                <span>"Чем отличаются prompt tokens и completion tokens?"</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="messages-container">
          {(() => {
            const usesWindowN = strategy === 'sliding_window' || strategy === 'sticky_facts' || strategy === 'summary';
            const cutoffIndex = usesWindowN ? Math.max(0, messages.length - recentMessagesCount) : 0;

            return messages.map((msg, idx) => {
              const isOutsideContext = cutoffIndex > 0 && idx < cutoffIndex;

              return (
                <React.Fragment key={msg.id}>
                  {cutoffIndex > 0 && idx === cutoffIndex && (
                    <div className="context-cutoff-divider">
                      <div className="cutoff-line" />
                      <div
                        className="cutoff-badge"
                        title={`В контекст модели передаются только сообщения ниже этой черты (последние ${recentMessagesCount})`}
                      >
                        <Layers size={13} />
                        <span>Граница окна (N = {recentMessagesCount}) • Сообщения выше отсечены от LLM</span>
                      </div>
                      <div className="cutoff-line" />
                    </div>
                  )}

                  <div
                    className={`message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'} ${isOutsideContext ? 'outside-context' : ''}`}
                    title={isOutsideContext ? 'Это сообщение находится за пределами окна N и не передаётся в LLM' : undefined}
                  >
                    <div className="avatar-col">
                      <div className={`avatar ${msg.role}`}>
                        {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                      </div>
                    </div>

                    <div className="message-bubble-col">
                      <div className="message-header">
                        <span className="sender-name">{msg.role === 'user' ? 'You' : 'Agent'}</span>
                        <span className="message-time">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.tokens !== undefined && (
                          <span className="message-token-pill" title="Tokens consumed by this message">
                            {msg.tokens} tokens
                          </span>
                        )}
                        {isOutsideContext && (
                          <span className="outside-context-pill" title="Отсечено из контекста модели">
                            Отсечено (вне N)
                          </span>
                        )}

                        {onBranchFromMessage && (
                          <button
                            type="button"
                            className="msg-branch-btn"
                            onClick={() => onBranchFromMessage(msg.id)}
                            title="Создать новую ветку диалога от этого сообщения"
                          >
                            <GitBranch size={12} />
                            <span>Ветка</span>
                          </button>
                        )}
                      </div>

                      <div className="message-content">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            });
          })()}

          {/* Context Trim Notification */}
          {lastTrimInfo && lastTrimInfo.wasTrimmed && (
            <div className="context-trim-notice">
              <Scissors size={16} className="notice-icon" />
              <div className="notice-text">
                <strong>Context was trimmed to fit the model limit.</strong>
                <span>
                  {' '}Removed {lastTrimInfo.messagesRemoved} older message(s) to reduce context from{' '}
                  {lastTrimInfo.originalTokens.toLocaleString()} to {lastTrimInfo.trimmedTokens.toLocaleString()} tokens.
                </span>
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="message-row assistant-row loading-row">
              <div className="avatar-col">
                <div className="avatar assistant thinking">
                  <Bot size={18} />
                </div>
              </div>
              <div className="message-bubble-col">
                <div className="loading-indicator">
                  <div className="pulse-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="loading-text">Agent is thinking...</span>
                </div>
              </div>
            </div>
          )}

          {/* Human-friendly Error Card */}
          {error && (
            <div className="error-banner">
              <AlertTriangle size={20} className="error-icon" />
              <div className="error-body">
                <div className="error-title">Error occurred</div>
                <div className="error-message">{error}</div>
              </div>
              <button
                type="button"
                className="error-dismiss-btn"
                onClick={onClearError}
                title="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div ref={bottomRef} className="scroll-anchor" />
        </div>
      )}
    </div>
  );
};
