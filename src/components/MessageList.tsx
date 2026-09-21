import React, { useEffect, useRef, useState } from 'react';
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
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface InvariantCheckResult {
  status: 'PASS' | 'CONFLICT';
  violated?: string;
  analysis?: string;
  raw: string;
}

interface StateCheckData {
  status: 'VALID' | 'INVALID_TRANSITION';
  currentStage?: string;
  requestedStage?: string;
  reason?: string;
  raw: string;
}

function parseStateCheck(content: string): {
  stateCheck: StateCheckData | null;
  cleanedContent: string;
} {
  const match = content.match(/<state_check>([\s\S]*?)<\/state_check>/i);
  if (!match) {
    return { stateCheck: null, cleanedContent: content };
  }

  const raw = match[0];
  const inner = match[1];

  let status: 'VALID' | 'INVALID_TRANSITION' = 'VALID';
  if (/status:\s*INVALID_TRANSITION/i.test(inner)) {
    status = 'INVALID_TRANSITION';
  }

  const currentMatch = inner.match(/current_stage:\s*([a-z_]+)/i);
  const requestedMatch = inner.match(/requested_stage:\s*([a-z_]+)/i);
  const reasonMatch = inner.match(/reason:\s*([^\r\n]+)/i);

  const cleanedContent = content.replace(raw, '').trim();

  return {
    stateCheck: {
      status,
      currentStage: currentMatch ? currentMatch[1] : undefined,
      requestedStage: requestedMatch ? requestedMatch[1] : undefined,
      reason: reasonMatch ? reasonMatch[1].trim() : undefined,
      raw,
    },
    cleanedContent,
  };
}

const StateCheckCard: React.FC<{ check: StateCheckData }> = ({ check }) => {
  const isInvalid = check.status === 'INVALID_TRANSITION';
  const [isOpen, setIsOpen] = useState(isInvalid);

  return (
    <div className={`state-check-card ${isInvalid ? 'status-invalid' : 'status-valid'}`}>
      <div
        className="state-check-header"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsOpen(!isOpen);
          }
        }}
      >
        <div className="state-check-title-row">
          {isInvalid ? (
            <AlertTriangle size={15} className="state-icon-invalid" />
          ) : (
            <ShieldCheck size={15} className="state-icon-valid" />
          )}
          <span className="state-check-title">
            {isInvalid
              ? '🚫 Попытка перескока этапа заблокирована (Guardrail)'
              : '🎯 Жизненный цикл FSM: этап соблюдён'}
          </span>
          {check.currentStage && (
            <span className="state-stage-badge">Этап: {check.currentStage}</span>
          )}
        </div>
        <div className="state-toggle-action">
          <span className="state-toggle-hint">{isOpen ? 'Скрыть' : 'Подробнее'}</span>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isOpen && (
        <div className="state-check-body">
          {check.requestedStage && (
            <div className="state-detail-line">
              <strong className="state-label">Запрошен перескок на этап:</strong>{' '}
              <span className="state-val-warn">{check.requestedStage}</span>
            </div>
          )}
          {check.reason && (
            <div className="state-detail-line">
              <strong className="state-label">Причина блокировки:</strong>{' '}
              <span className="state-val-reason">{check.reason}</span>
            </div>
          )}
          {!isInvalid && (
            <div className="state-detail-line">
              <span className="state-val-ok">Действие выполняется строго в рамках утвержденного этапа жизненного цикла задачи.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function parseInvariantCheck(content: string): {
  check: InvariantCheckResult | null;
  cleanedContent: string;
} {
  const match = content.match(/<invariant_check>([\s\S]*?)<\/invariant_check>/i);
  if (!match) {
    const cleaned = content.replace(/<task_update\s+[^>]+\/?>/gi, '').trim();
    return { check: null, cleanedContent: cleaned };
  }

  const raw = match[0];
  const inner = match[1];

  let status: 'PASS' | 'CONFLICT' = 'PASS';
  if (/status:\s*CONFLICT/i.test(inner)) {
    status = 'CONFLICT';
  }

  let violated = '';
  const violatedMatch = inner.match(/violated:\s*([^\r\n]+)/i);
  if (violatedMatch && violatedMatch[1] && !/none/i.test(violatedMatch[1])) {
    violated = violatedMatch[1].trim();
  }

  let analysis = '';
  const analysisMatch = inner.match(/analysis:\s*([\s\S]+)$/i);
  if (analysisMatch && analysisMatch[1]) {
    analysis = analysisMatch[1].trim();
  } else {
    analysis = inner
      .replace(/status:[^\r\n]+/i, '')
      .replace(/violated:[^\r\n]+/i, '')
      .trim();
  }

  const cleanedContent = content
    .replace(raw, '')
    .replace(/<task_update\s+[^>]+\/?>/gi, '')
    .trim();

  return {
    check: { status, violated, analysis, raw },
    cleanedContent,
  };
}

const InvariantCheckCard: React.FC<{ check: InvariantCheckResult }> = ({ check }) => {
  const [isOpen, setIsOpen] = useState(check.status === 'CONFLICT');
  const isConflict = check.status === 'CONFLICT';

  return (
    <div className={`invariant-check-card ${isConflict ? 'status-conflict' : 'status-pass'}`}>
      <div
        className="invariant-check-header"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsOpen(!isOpen);
          }
        }}
      >
        <div className="invariant-check-title-row">
          {isConflict ? (
            <ShieldAlert size={15} className="invariant-icon-conflict" />
          ) : (
            <ShieldCheck size={15} className="invariant-icon-pass" />
          )}
          <span className="invariant-check-title">
            {isConflict ? '🚨 Конфликт с инвариантом' : '🛡️ Проверка инвариантов пройдена'}
          </span>
          {isConflict && check.violated && (
            <span className="invariant-violated-badge">{check.violated}</span>
          )}
        </div>
        <div className="invariant-toggle-action">
          <span className="invariant-toggle-hint">{isOpen ? 'Скрыть анализ' : 'Показать анализ'}</span>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isOpen && (
        <div className="invariant-check-body">
          <div className="invariant-reasoning-line">
            <strong className="invariant-label">Анализ соблюдения ограничений:</strong>
            <p className="invariant-text">
              {check.analysis || 'Запрос проверен против активных инвариантов системы.'}
            </p>
          </div>
          {isConflict && (
            <div className="invariant-conflict-alert">
              <span>🛑 Ассистент зафиксировал конфликт правил и предоставил обоснованный отказ с альтернативой.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

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

                      {(() => {
                        if (msg.role === 'assistant') {
                          const { stateCheck, cleanedContent: afterStateCleaned } = parseStateCheck(msg.content);
                          const { check, cleanedContent } = parseInvariantCheck(afterStateCleaned);
                          return (
                            <>
                              {stateCheck && <StateCheckCard check={stateCheck} />}
                              {check && <InvariantCheckCard check={check} />}
                              <div className="message-content">
                                {cleanedContent}
                              </div>
                            </>
                          );
                        }
                        return (
                          <div className="message-content">
                            {msg.content}
                          </div>
                        );
                      })()}
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
