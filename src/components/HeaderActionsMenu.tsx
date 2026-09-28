import React, { useEffect, useRef, useState } from 'react';
import { Brain, Monitor, Moon, MoreVertical, Server, Shield, Sun, Trash2 } from 'lucide-react';
import { useThemePreference, ThemePreference } from '../theme';

const THEME_OPTIONS: Array<{ value: ThemePreference; icon: React.ReactNode; label: string }> = [
  { value: 'light', icon: <Sun size={14} />, label: 'Светлая тема' },
  { value: 'dark', icon: <Moon size={14} />, label: 'Тёмная тема' },
  { value: 'system', icon: <Monitor size={14} />, label: 'Как в системе' },
];

interface HeaderActionsMenuProps {
  invariantsCount: number;
  memoryCount: number;
  mcpCount?: number;
  hasMessages: boolean;
  disabled?: boolean;
  active?: boolean;
  onOpenInvariants: () => void;
  onOpenMemoryHub: () => void;
  onOpenMcp: () => void;
  onClearHistory: () => void;
}

export const HeaderActionsMenu: React.FC<HeaderActionsMenuProps> = ({
  invariantsCount,
  memoryCount,
  mcpCount = 0,
  hasMessages,
  disabled,
  active,
  onOpenInvariants,
  onOpenMemoryHub,
  onOpenMcp,
  onClearHistory,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { preference, setPreference } = useThemePreference();

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const close = () => setIsOpen(false);
  const totalCount = invariantsCount + memoryCount + (mcpCount || 0);

  return (
    <div className="header-actions-menu" ref={containerRef}>
      <button
        type="button"
        className={`action-btn header-actions-toggle ${active ? 'active' : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        title="Инварианты, Memory Hub, MCP и очистка чата"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} />
        {totalCount > 0 && <span className="header-actions-count">{totalCount}</span>}
      </button>

      {isOpen && (
        <div className="header-actions-dropdown" role="menu">
          <div className="header-actions-theme" role="group" aria-label="Тема оформления">
            <span className="header-actions-theme-label">Тема</span>
            <div className="header-actions-theme-group">
              {THEME_OPTIONS.map(({ value, icon, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`header-actions-theme-btn ${preference === value ? 'active' : ''}`}
                  onClick={() => setPreference(value)}
                  title={label}
                  aria-pressed={preference === value}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="header-actions-divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="header-actions-item"
            onClick={() => {
              close();
              onOpenInvariants();
            }}
            title="Инварианты и ограничения состояния (День 14): нажмите для просмотра и настройки"
          >
            <Shield size={15} />
            <span className="header-actions-item-label">Инварианты</span>
            <span className="header-actions-item-count invariants">{invariantsCount}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="header-actions-item"
            onClick={() => {
              close();
              onOpenMemoryHub();
            }}
            title="Memory Hub: слои памяти агента (Short-Term, Working, Long-Term)"
          >
            <Brain size={15} />
            <span className="header-actions-item-label">Memory Hub</span>
            <span className="header-actions-item-count memory">{memoryCount}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="header-actions-item"
            onClick={() => {
              close();
              onOpenMcp();
            }}
            title="MCP: Model Context Protocol (День 16) — управление серверами инструментов"
          >
            <Server size={15} />
            <span className="header-actions-item-label">MCP</span>
            {mcpCount > 0 && (
              <span className="header-actions-item-count mcp">{mcpCount}</span>
            )}
          </button>

          {hasMessages && (
            <button
              type="button"
              role="menuitem"
              className="header-actions-item header-actions-item-danger"
              onClick={() => {
                close();
                onClearHistory();
              }}
              title="Clear conversation and localStorage"
              disabled={disabled}
            >
              <Trash2 size={15} />
              <span className="header-actions-item-label">Очистить чат</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
