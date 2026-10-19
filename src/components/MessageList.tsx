import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Message, TrimInfo, ContextStrategy, McpCallMeta } from '../agent/types';
import Markdown from './Markdown';
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
  Wrench,
  Brain,
  RotateCcw,
  FileText,
  FileCode,
  FileDiff,
  FilePlus,
  Search,
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

const ThinkingCard: React.FC<{
  thinking: string;
  isThinking?: boolean;
  durationMs?: number;
}> = ({ thinking, isThinking, durationMs }) => {
  // Auto-expanded while thinking is active, auto-collapsed once finished; user can freely toggle anytime.
  const [isOpen, setIsOpen] = useState(Boolean(isThinking));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live timer while isThinking is active
  useEffect(() => {
    if (!isThinking) return;
    setIsOpen(true);
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, (Date.now() - startTime) / 1000));
    }, 100);
    return () => clearInterval(interval);
  }, [isThinking]);

  // When thinking finishes, automatically collapse the card
  const prevThinkingRef = useRef(isThinking);
  useEffect(() => {
    if (prevThinkingRef.current && !isThinking) {
      setIsOpen(false);
    }
    prevThinkingRef.current = isThinking;
  }, [isThinking]);

  const displayTime = isThinking
    ? `${elapsedSeconds.toFixed(1)} с`
    : durationMs
    ? `${(durationMs / 1000).toFixed(1)} с`
    : null;

  return (
    <div className={`thinking-card ${isThinking ? 'thinking-active' : 'thinking-done'}`}>
      <div
        className="thinking-header"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsOpen(!isOpen);
          }
        }}
      >
        <div className="thinking-title-row">
          <Brain size={16} className={`thinking-icon ${isThinking ? 'pulsing' : ''}`} />
          <span className="thinking-title">
            {isThinking ? 'Размышления...' : 'Ход мыслей'}
          </span>
          {displayTime && (
            <span className="thinking-timer-badge">
              {displayTime}
            </span>
          )}
        </div>
        <div className="thinking-toggle-btn">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isOpen && (
        <div className="thinking-body">
          <Markdown content={thinking} />
          {isThinking && <span className="streaming-cursor" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
};

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

const DiffViewer: React.FC<{ diffText: string }> = ({ diffText }) => {
  const lines = diffText.split(/\r?\n/);
  return (
    <div
      style={{
        background: '#090d13',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '6px',
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fontSize: '11px',
        lineHeight: '1.45',
        overflowX: 'auto',
        padding: '6px 8px',
        marginTop: '6px',
        maxHeight: '360px',
        overflowY: 'auto',
      }}
    >
      {lines.map((line, idx) => {
        let bg = 'transparent';
        let color = '#94a3b8';
        let fontWeight = 'normal';

        if (line.startsWith('+++') || line.startsWith('---')) {
          color = '#e2e8f0';
          fontWeight = '600';
        } else if (line.startsWith('+')) {
          bg = 'rgba(34, 197, 94, 0.18)';
          color = '#4ade80';
        } else if (line.startsWith('-')) {
          bg = 'rgba(239, 68, 68, 0.18)';
          color = '#f87171';
        } else if (line.startsWith('@@')) {
          bg = 'rgba(56, 189, 248, 0.14)';
          color = '#38bdf8';
        } else if (line.startsWith('diff --git')) {
          color = '#60a5fa';
          fontWeight = 'bold';
        }

        return (
          <div
            key={idx}
            style={{
              background: bg,
              color,
              fontWeight,
              whiteSpace: 'pre',
              padding: '1px 4px',
              borderRadius: '2px',
            }}
          >
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
};

const getToolIcon = (toolName: string) => {
  if (toolName === 'get_file_diff') return <FileDiff size={14} style={{ color: '#38bdf8' }} />;
  if (toolName === 'write_project_file') return <FilePlus size={14} style={{ color: '#4ade80' }} />;
  if (toolName === 'patch_project_file') return <FileCode size={14} style={{ color: '#facc15' }} />;
  if (toolName === 'read_project_file' || toolName === 'list_project_files') return <FileText size={14} style={{ color: '#a78bfa' }} />;
  if (toolName === 'search_project_files') return <Search size={14} style={{ color: '#fb923c' }} />;
  if (toolName === 'get_current_git_branch') return <GitBranch size={14} style={{ color: '#34d399' }} />;
  return <Wrench size={14} style={{ color: '#22c55e' }} />;
};

const McpToolCallCard: React.FC<{ calls: McpCallMeta[] }> = ({ calls }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!calls || calls.length === 0) return null;

  const hasErrors = calls.some((c) => c.isError);
  const primaryTool = calls[0]?.toolName || '';

  return (
    <div
      className={`mcp-tool-card ${hasErrors ? 'status-error' : 'status-success'}`}
      style={{
        marginBottom: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        background: hasErrors ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 197, 94, 0.08)',
        border: `1px solid ${hasErrors ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
        fontSize: '12px',
      }}
    >
      <div
        className="mcp-tool-header"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        role="button"
        tabIndex={0}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {getToolIcon(primaryTool)}
          <strong style={{ color: hasErrors ? '#ef4444' : '#22c55e' }}>
            🛠️ MCP вызов: {calls.map((c) => c.toolName).join(', ')}
          </strong>
          {calls[0]?.serverName && (
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: 'var(--text-secondary, #94a3b8)',
                fontSize: '11px',
              }}
            >
              {calls[0].serverName}
            </span>
          )}
          {typeof calls[0]?.latencyMs === 'number' && calls[0].latencyMs > 0 && (
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: 'var(--text-secondary, #94a3b8)',
                fontSize: '11px',
              }}
            >
              {calls[0].latencyMs}ms
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text-secondary, #94a3b8)', display: 'flex', alignItems: 'center' }}>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isOpen && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          {calls.map((call, idx) => {
            let parsedDiff: string | null = null;
            if (call.toolName === 'get_file_diff') {
              try {
                const parsed = JSON.parse(call.result || '{}');
                if (parsed.diff) parsedDiff = parsed.diff;
              } catch {
                if (call.result && (call.result.includes('diff --git') || call.result.includes('@@'))) {
                  parsedDiff = call.result;
                }
              }
            }

            return (
              <div key={idx} style={{ marginBottom: idx < calls.length - 1 ? '10px' : '0' }}>
                <div style={{ marginBottom: '4px', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>
                  Параметры:
                </div>
                <pre
                  style={{
                    background: 'rgba(0, 0, 0, 0.35)',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    overflowX: 'auto',
                    fontSize: '11px',
                    margin: '0 0 6px 0',
                    color: '#e2e8f0',
                  }}
                >
                  {JSON.stringify(call.args, null, 2)}
                </pre>
                <div style={{ marginBottom: '4px', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>
                  Ответ сервера MCP:
                </div>
                <pre
                  style={{
                    background: 'rgba(0, 0, 0, 0.35)',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    overflowX: 'auto',
                    fontSize: '11px',
                    margin: '0',
                    color: call.isError ? '#fca5a5' : '#86efac',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {call.result}
                </pre>

                {parsedDiff && (
                  <div style={{ marginTop: '8px' }}>
                    <div
                      style={{
                        marginBottom: '4px',
                        color: '#38bdf8',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <FileDiff size={13} />
                      Unified Git Diff:
                    </div>
                    <DiffViewer diffText={parsedDiff} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function cleanMessageContent(content: string): string {
  return content
    .replace(/<task_update\s+[^>]+\/?>/gi, '')
    .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, '')
    .replace(/<mcp_call\b[\s\S]*?<\/mcp_call>|<mcp_call\b[^>]*\/>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .trim();
}

function parseInvariantCheck(content: string): {
  check: InvariantCheckResult | null;
  cleanedContent: string;
} {
  const match = content.match(/<invariant_check>([\s\S]*?)<\/invariant_check>/i);
  if (!match) {
    const cleaned = cleanMessageContent(content);
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

  const cleanedContent = cleanMessageContent(content.replace(raw, ''));

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

const PAGE_SIZE = 50; // messages rendered initially and per scroll-up batch
const LOAD_MORE_THRESHOLD = 80; // px from the top that triggers loading older messages
const NEAR_BOTTOM_THRESHOLD = 120; // px from the bottom that counts as "viewing the newest"

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isStreaming?: boolean;
  error: string | null;
  lastTrimInfo: TrimInfo | null;
  strategy?: ContextStrategy;
  recentMessagesCount?: number;
  onClearError: () => void;
  onSuggestionClick?: (prompt: string) => void;
  onBranchFromMessage?: (messageId: string) => void;
  onUndoLastTurn?: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  isStreaming = false,
  error,
  lastTrimInfo,
  strategy = 'sliding_window',
  recentMessagesCount = 10,
  onClearError,
  onSuggestionClick,
  onBranchFromMessage,
  onUndoLastTurn,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const isNearBottomRef = useRef(true);
  const pendingRestoreRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const suppressAnimIdsRef = useRef<Set<string> | null>(null);
  if (suppressAnimIdsRef.current === null) {
    suppressAnimIdsRef.current = new Set(messages.map((m) => m.id));
  }
  const prevLastIdRef = useRef<string | null>(null);
  const prevIsLoadingRef = useRef(false);

  // Open on the newest messages instantly — no smooth scroll, no row animation.
  useLayoutEffect(() => {
    const wrapper = listRef.current;
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    }
  }, []);

  // Keep the viewport anchored while a batch of older messages is prepended.
  useLayoutEffect(() => {
    const wrapper = listRef.current;
    const pending = pendingRestoreRef.current;
    if (!wrapper || !pending) return;
    pendingRestoreRef.current = null;
    wrapper.scrollTop = wrapper.scrollHeight - pending.prevScrollHeight + pending.prevScrollTop;
  }, [visibleCount]);

  // Auto-scroll only for live conversation updates, never while the user reads history.
  useEffect(() => {
    const wrapper = listRef.current;
    if (!wrapper) return;
    const last = messages[messages.length - 1];
    const prevLastId = prevLastIdRef.current;
    prevLastIdRef.current = last ? last.id : null;
    const isLoadingTurnedOn = isLoading && !prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;
    if (prevLastId === null) return;

    const lastChanged = last !== undefined && last.id !== prevLastId;
    const lastIsUser = last?.role === 'user';
    const lastIsStreaming = last?.isStreaming || last?.isThinking;
    if (
      (lastChanged && (isNearBottomRef.current || lastIsUser)) ||
      (lastIsStreaming && isNearBottomRef.current) ||
      (isLoadingTurnedOn && isNearBottomRef.current)
    ) {
      wrapper.scrollTop = wrapper.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleScroll = () => {
    const wrapper = listRef.current;
    if (!wrapper) return;
    const { scrollTop, scrollHeight, clientHeight } = wrapper;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;

    if (scrollTop <= LOAD_MORE_THRESHOLD && messages.length > visibleCount) {
      const nextCount = Math.min(visibleCount + PAGE_SIZE, messages.length);
      const firstVisible = messages.length - visibleCount;
      const newFirst = messages.length - nextCount;
      const suppress = suppressAnimIdsRef.current;
      if (suppress) {
        for (let i = newFirst; i < firstVisible; i++) {
          suppress.add(messages[i].id);
        }
      }
      pendingRestoreRef.current = { prevScrollHeight: scrollHeight, prevScrollTop: scrollTop };
      setVisibleCount(nextCount);
    }
  };

  const firstVisibleIndex = Math.max(0, messages.length - visibleCount);
  const visibleMessages = messages.slice(firstVisibleIndex);

  return (
    <div className="message-list-wrapper" ref={listRef} onScroll={handleScroll}>
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
                onClick={() => onSuggestionClick?.('/help')}
              >
                <Sparkles size={14} />
                <span>"/help" (Справка по проекту CryptoTrack)</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggestionClick?.('/help Как устроен data-слой и Room Database?')}
              >
                <Sparkles size={14} />
                <span>"/help Как устроен data-слой и Room Database?"</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() =>
                  onSuggestionClick?.(
                    'Найди все места, где используется SafeApiCall в проекте CryptoTrack, проанализируй обработку ошибок и подготовь архитектурный отчет'
                  )
                }
              >
                <Search size={14} style={{ color: '#fb923c' }} />
                <span>"🔍 Найти использование SafeApiCall и подготовить отчет"</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() =>
                  onSuggestionClick?.(
                    'Изучи существующие ADR в docs/decisions и создай новый ADR-019 о внедрении фонового обновления курсов криптовалют в CryptoTrack'
                  )
                }
              >
                <FilePlus size={14} style={{ color: '#4ade80' }} />
                <span>"📝 Создать ADR-019 (фоновое обновление курсов)"</span>
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() =>
                  onSuggestionClick?.(
                    'Покажи git diff всех сделанных изменений в CryptoTrack и подготовь список изменений'
                  )
                }
              >
                <FileDiff size={14} style={{ color: '#38bdf8' }} />
                <span>"📊 Показать git diff изменений в CryptoTrack"</span>
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

            return visibleMessages.map((msg, i) => {
              const idx = firstVisibleIndex + i;
              const isOutsideContext = cutoffIndex > 0 && idx < cutoffIndex;
              const isLastMessage = idx === messages.length - 1;

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
                    className={`message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'} ${isOutsideContext ? 'outside-context' : ''} ${suppressAnimIdsRef.current?.has(msg.id) ? 'no-anim' : ''}`}
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
                          const displayContent = cleanedContent
                            .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, '')
                            .replace(/<mcp_call\b[\s\S]*?<\/mcp_call>|<mcp_call\b[^>]*\/>/gi, '')
                            .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                            .trim();

                          return (
                            <>
                              {msg.thinking && (
                                <ThinkingCard
                                  thinking={msg.thinking}
                                  isThinking={msg.isThinking}
                                  durationMs={msg.thinkingDurationMs}
                                />
                              )}
                              {msg.mcpCalls && msg.mcpCalls.length > 0 && (
                                <McpToolCallCard calls={msg.mcpCalls} />
                              )}
                              {stateCheck && <StateCheckCard check={stateCheck} />}
                              {check && <InvariantCheckCard check={check} />}
                              {(displayContent || (!msg.thinking && !msg.mcpCalls)) && (
                                <div className="message-content">
                                  <Markdown
                                    content={
                                      displayContent ||
                                      (msg.mcpCalls && msg.mcpCalls.length > 0
                                        ? '✅ Все операции успешно выполнены через внешние MCP-серверы.'
                                        : msg.content)
                                    }
                                  />
                                  {msg.isStreaming && !msg.isThinking && (
                                    <span className="streaming-cursor" aria-hidden="true" />
                                  )}
                                </div>
                              )}
                            </>
                          );
                        }
                        return (
                          <div className="message-content">
                            {msg.content}
                          </div>
                        );
                      })()}

                      {isLastMessage && onUndoLastTurn && (
                        <div className="message-action-bar">
                          <button
                            type="button"
                            className="msg-undo-btn"
                            onClick={onUndoLastTurn}
                            disabled={isLoading || isStreaming}
                            title="Отменить последний шаг диалога и вернуть текст запроса в поле ввода"
                          >
                            <RotateCcw size={13} />
                            <span>Отменить и вернуть текст</span>
                          </button>
                        </div>
                      )}
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
          {isLoading && !messages.some((m) => (m.isStreaming || m.isThinking) && (m.content || m.thinking)) && (
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

          <div className="scroll-anchor" />
        </div>
      )}
    </div>
  );
};
