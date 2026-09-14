import React from 'react';
import { ContextStrategy } from '../agent/types';
import {
  Layers,
  Pin,
  GitBranch,
  FileText,
  AlertOctagon,
  Sparkles,
  ChevronDown,
  Sliders,
} from 'lucide-react';

interface StrategySelectorProps {
  strategy: ContextStrategy;
  onStrategyChange: (strategy: ContextStrategy) => void;
  recentMessagesCount: number;
  onRecentMessagesCountChange: (count: number) => void;
  factsCount: number;
  isFactsOpen: boolean;
  onToggleFacts: () => void;
  disabled?: boolean;
}

const STRATEGIES: Array<{
  id: ContextStrategy;
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    id: 'sliding_window',
    label: 'Sliding Window',
    icon: <Layers size={14} />,
    description: 'Хранит и отправляет в модель только последние N сообщений. Всё остальное отсекается.',
  },
  {
    id: 'sticky_facts',
    label: 'Sticky Facts',
    icon: <Pin size={14} />,
    description: 'Key-Value память фактов (цели, ограничения, договорённости) + последние N сообщений.',
  },
  {
    id: 'branching',
    label: 'Branching',
    icon: <GitBranch size={14} />,
    description: 'Ветки диалога и чекпоинты: полная история активной ветки передаётся в контекст.',
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: <FileText size={14} />,
    description: 'Инкрементальное сжатие старых сообщений в саммари + последние N сообщений.',
  },
  {
    id: 'demo',
    label: 'Demo Overflow',
    icon: <AlertOctagon size={14} />,
    description: 'Без управления контекстом: отправляет полную историю для демонстрации лимита окна.',
  },
];

const WINDOW_SIZES = [3, 5, 10, 20];
const STRATEGIES_WITH_N: ContextStrategy[] = ['sliding_window', 'sticky_facts', 'summary'];

export const StrategySelector: React.FC<StrategySelectorProps> = ({
  strategy,
  onStrategyChange,
  recentMessagesCount,
  onRecentMessagesCountChange,
  factsCount,
  isFactsOpen,
  onToggleFacts,
  disabled,
}) => {
  const currentStrategy = STRATEGIES.find((s) => s.id === strategy);
  const showNSelector = STRATEGIES_WITH_N.includes(strategy);

  return (
    <div className="strategy-selector-container">
      {/* Dropdown Selector for Context Strategy */}
      <div
        className="strategy-dropdown-wrapper"
        title={currentStrategy ? `${currentStrategy.label}: ${currentStrategy.description}` : 'Выбор стратегии контекста'}
      >
        <span className="strategy-dropdown-icon">
          {currentStrategy ? currentStrategy.icon : <Sliders size={14} />}
        </span>

        <select
          className={`strategy-dropdown-select ${strategy === 'demo' ? 'demo-active' : ''}`}
          value={strategy}
          onChange={(e) => onStrategyChange(e.target.value as ContextStrategy)}
          disabled={disabled}
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <ChevronDown size={13} className="strategy-dropdown-chevron" />
      </div>

      {/* Quick N Selector (visible ONLY for strategies that use window N: Sliding Window, Sticky Facts, Summary) */}
      {showNSelector && (
        <div className="window-n-selector" title="Размер скользящего окна N (количество последних сообщений)">
          <span className="window-n-label">N:</span>
          <div className="window-n-chips">
            {WINDOW_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`window-n-chip ${recentMessagesCount === size ? 'active' : ''}`}
                onClick={() => onRecentMessagesCountChange(size)}
                disabled={disabled}
                title={`Передавать последние ${size} сообщений в контекст`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toggle Facts Panel Button (visible in sticky_facts or if facts exist) */}
      {(strategy === 'sticky_facts' || factsCount > 0) && (
        <button
          type="button"
          className={`facts-toggle-btn ${isFactsOpen ? 'open' : ''} ${strategy === 'sticky_facts' ? 'highlight' : ''}`}
          onClick={onToggleFacts}
          title="Открыть/закрыть панель Sticky Facts (Key-Value Memory)"
        >
          <Sparkles size={13} />
          <span>Facts</span>
          <span className="facts-count-badge">{factsCount}</span>
        </button>
      )}
    </div>
  );
};
