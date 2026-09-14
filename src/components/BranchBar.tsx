import React, { useState } from 'react';
import { DialogueBranch } from '../agent/types';
import {
  GitBranch,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Bookmark,
} from 'lucide-react';

interface BranchBarProps {
  branches: DialogueBranch[];
  activeBranchId: string;
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (name: string) => void;
  onRenameBranch: (branchId: string, name: string) => void;
  onDeleteBranch: (branchId: string) => void;
  disabled?: boolean;
}

export const BranchBar: React.FC<BranchBarProps> = ({
  branches,
  activeBranchId,
  onSwitchBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  disabled,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleStartCreate = () => {
    setNewBranchName(`Ветка ${branches.length + 1}`);
    setIsCreating(true);
  };

  const handleConfirmCreate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (newBranchName.trim()) {
      onCreateBranch(newBranchName.trim());
      setNewBranchName('');
      setIsCreating(false);
    }
  };

  const handleStartRename = (branch: DialogueBranch, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBranchId(branch.id);
    setEditName(branch.name);
  };

  const handleSaveRename = (branchId: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (editName.trim()) {
      onRenameBranch(branchId, editName.trim());
    }
    setEditingBranchId(null);
  };

  const handleDelete = (branchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (branches.length <= 1) return;
    if (window.confirm('Удалить эту ветку диалога? Сообщения в ней будут удалены.')) {
      onDeleteBranch(branchId);
    }
  };

  return (
    <div className="branch-bar-container" aria-label="Диалоговые ветки">
      <div className="branch-bar-label" title="Стратегия ветвления диалога: независимые ветки от чекпоинтов">
        <GitBranch size={15} />
        <span>Ветки:</span>
      </div>

      <div className="branch-tabs-wrapper">
        {branches.map((branch) => {
          const isActive = branch.id === activeBranchId;
          const isEditing = editingBranchId === branch.id;

          if (isEditing) {
            return (
              <div key={branch.id} className="branch-tab editing">
                <input
                  type="text"
                  className="branch-name-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename(branch.id);
                    if (e.key === 'Escape') setEditingBranchId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="tab-mini-action-btn check"
                  onClick={(e) => handleSaveRename(branch.id, e)}
                  title="Сохранить имя"
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="tab-mini-action-btn cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingBranchId(null);
                  }}
                  title="Отмена"
                >
                  <X size={12} />
                </button>
              </div>
            );
          }

          return (
            <button
              key={branch.id}
              type="button"
              className={`branch-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSwitchBranch(branch.id)}
              disabled={disabled}
              title={`Переключиться на ветку "${branch.name}" (${branch.messages.length} сообщ.)`}
            >
              {branch.checkpointMessageId && (
                <span title="Ответвлено от чекпоинта">
                  <Bookmark size={12} className="checkpoint-marker" />
                </span>
              )}
              <span className="branch-name">{branch.name}</span>
              <span className="branch-msg-count">{branch.messages.length}</span>

              {/* Inline actions on tab */}
              <div className="tab-actions-group" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="tab-hover-action"
                  onClick={(e) => handleStartRename(branch, e)}
                  title="Переименовать ветку"
                >
                  <Edit2 size={11} />
                </button>
                {branches.length > 1 && (
                  <button
                    type="button"
                    className="tab-hover-action delete"
                    onClick={(e) => handleDelete(branch.id, e)}
                    title="Удалить ветку"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </button>
          );
        })}

        {/* Create Branch Button or Input */}
        {isCreating ? (
          <form className="branch-tab create-form" onSubmit={handleConfirmCreate}>
            <input
              type="text"
              className="branch-name-input"
              value={newBranchName}
              placeholder="Имя ветки"
              onChange={(e) => setNewBranchName(e.target.value)}
              autoFocus
            />
            <button type="submit" className="tab-mini-action-btn check" title="Создать">
              <Check size={12} />
            </button>
            <button
              type="button"
              className="tab-mini-action-btn cancel"
              onClick={() => setIsCreating(false)}
              title="Отмена"
            >
              <X size={12} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="branch-tab add-branch-btn"
            onClick={handleStartCreate}
            disabled={disabled}
            title="Создать новую ветку от текущего состояния"
          >
            <Plus size={13} />
            <span>Новая ветка</span>
          </button>
        )}
      </div>
    </div>
  );
};
