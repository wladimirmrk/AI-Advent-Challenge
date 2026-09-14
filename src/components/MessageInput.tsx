import React, { useState, useRef, useEffect } from 'react';
import { Send, Key, CornerDownLeft } from 'lucide-react';
import { estimateTokens } from '../agent/tokenizer';

interface MessageInputProps {
  onSendMessage: (text: string) => Promise<void>;
  disabled: boolean;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  disabled,
  hasApiKey,
  onOpenSettings,
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
                ? 'Type your message... (Enter to send, Shift+Enter for new line)'
                : 'Configure your API key in Settings to begin chatting...'
            }
            disabled={disabled || !hasApiKey}
            className="message-textarea"
          />

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

            <button
              type="submit"
              disabled={disabled || !input.trim() || !hasApiKey}
              className="send-button"
              title={hasApiKey ? 'Send message' : 'Configure API key first'}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
