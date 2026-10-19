import React, { useState, useRef, useEffect } from 'react';
import { Send, Key, CornerDownLeft, Square } from 'lucide-react';
import { estimateTokens } from '../agent/tokenizer';

interface MessageInputProps {
  onSendMessage: (text: string) => Promise<void>;
  disabled: boolean;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  restoredText?: { text: string; timestamp: number } | null;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  disabled,
  hasApiKey,
  onOpenSettings,
  onStop,
  isStreaming,
  restoredText,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height as text expands
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Handle restored text (e.g. from undoing the last turn)
  useEffect(() => {
    if (restoredText) {
      setInput(restoredText.text);
      if (textareaRef.current) {
        textareaRef.current.focus();
        const len = restoredText.text.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    }
  }, [restoredText]);

  const liveTokenEstimate = input.trim() ? estimateTokens(input.trim()) : 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!hasApiKey) {
      onOpenSettings();
      return;
    }
    const textToSend = input.trim();
    if (!textToSend || disabled) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await onSendMessage(textToSend);
    } catch {
      // Error handled via Agent state
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="input-outer-wrapper">
      {!hasApiKey && (
        <div className="api-key-warning-bar" onClick={onOpenSettings}>
          <Key size={14} />
          <span>API key is not configured. Click here or open Settings to enter your OpenRouter key.</span>
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="input-box-container">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasApiKey
                ? 'Введите сообщение или /help <вопрос>... (Enter — отправить)'
                : 'Configure your API key in Settings to begin chatting...'
            }
            disabled={disabled || !hasApiKey}
            className="message-textarea"
          />

          {input.trim() === '/' && (
            <div
              className="command-hint-pill"
              style={{
                padding: '6px 12px',
                margin: '2px 8px 6px',
                fontSize: '12px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                color: '#38bdf8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={() => {
                setInput('/help ');
                if (textareaRef.current) textareaRef.current.focus();
              }}
            >
              <span>💡 Нажмите для вставки <strong>/help</strong> — справка по проекту CryptoTrack (Git Branch + RAG Structural)</span>
            </div>
          )}

          <div className="input-footer">
            <div className="input-stats-hint">
              {liveTokenEstimate > 0 ? (
                <span className="live-tokens">
                  Prompt: ~<strong>{liveTokenEstimate}</strong> tokens
                </span>
              ) : (
                <span className="shortcut-hint">
                  <CornerDownLeft size={12} /> Enter sends
                </span>
              )}
            </div>

            {isStreaming && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="stop-button"
                title="Остановить генерацию"
              >
                <Square size={14} className="stop-icon" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || !input.trim() || !hasApiKey}
                className="send-button"
                title={hasApiKey ? 'Send message' : 'Configure API key first'}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
