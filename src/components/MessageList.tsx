import React, { useEffect, useRef } from 'react';
import { Message, TrimInfo } from '../agent/types';
import { User, Bot, AlertTriangle, Sparkles, Scissors, X } from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastTrimInfo: TrimInfo | null;
  onClearError: () => void;
  onSuggestionClick?: (prompt: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  error,
  lastTrimInfo,
  onClearError,
  onSuggestionClick,
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
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}
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
                </div>

                <div className="message-content">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

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
