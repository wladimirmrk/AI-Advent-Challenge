import React, { useEffect, useRef, useState } from 'react';
import { Brain, MoreVertical, Shield, Trash2 } from 'lucide-react';

interface HeaderActionsMenuProps {
  invariantsCount: number;
  memoryCount: number;
  hasMessages: boolean;
  disabled?: boolean;
  active?: boolean;
  onOpenInvariants: () => void;
  onOpenMemoryHub: () => void;
  onClearHistory: () => void;
}

export const HeaderActionsMenu: React.FC<HeaderActionsMenuProps> = ({
  invariantsCount,
  memoryCount,
  hasMessages,
  disabled,
  active,
  onOpenInvariants,
  onOpenMemoryHub,
  onClearHistory,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const totalCount = invariantsCount + memoryCount;

  return (
    <div className="header-actions-menu" ref={containerRef}>
      <button
        type="button"
        className={`action-btn header-actions-toggle ${active ? 'active' : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        title="Инварианты, Memory Hub и очистка чата"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} />
        {totalCount > 0 && <span className="header-actions-count">{totalCount}</span>}
      </button>

      {isOpen && (
        <div className="header-actions-dropdown" role="menu">
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
