import React, { useState } from 'react';
import { FactItem } from '../agent/types';
import {
  Pin,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface StickyFactsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  facts: FactItem[];
  isExtracting: boolean;
  onAddFact: (key: string, value: string, category: FactItem['category']) => void;
  onUpdateFact: (id: string, updates: Partial<Omit<FactItem, 'id'>>) => void;
  onRemoveFact: (id: string) => void;
  onClearFacts: () => void;
}

const CATEGORY_COLORS: Record<string, { label: string; bg: string; text: string }> = {
  goal: { label: 'Цель', bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
  constraint: { label: 'Ограничение', bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171' },
  preference: { label: 'Предпочтение', bg: 'rgba(168, 85, 247, 0.2)', text: '#c084fc' },
  decision: { label: 'Решение', bg: 'rgba(34, 197, 94, 0.2)', text: '#4ade80' },
  agreement: { label: 'Договорённость', bg: 'rgba(234, 179, 8, 0.2)', text: '#facc15' },
  other: { label: 'Факт', bg: 'rgba(148, 163, 184, 0.2)', text: '#94a3b8' },
};

export const StickyFactsPanel: React.FC<StickyFactsPanelProps> = ({
  isOpen,
  onClose,
  facts,
  isExtracting,
  onAddFact,
  onUpdateFact,
  onRemoveFact,
  onClearFacts,
}) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newCategory, setNewCategory] = useState<FactItem['category']>('other');
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editCategory, setEditCategory] = useState<FactItem['category']>('other');

  if (!isOpen) return null;

  const handleStartEdit = (fact: FactItem) => {
    setEditingId(fact.id);
    setEditKey(fact.key);
    setEditValue(fact.value);
    setEditCategory(fact.category || 'other');
  };

  const handleSaveEdit = (id: string) => {
    if (editKey.trim() && editValue.trim()) {
      onUpdateFact(id, {
        key: editKey.trim(),
        value: editValue.trim(),
        category: editCategory,
      });
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    onAddFact(newKey.trim(), newValue.trim(), newCategory);
    setNewKey('');
    setNewValue('');
    setNewCategory('other');
    setIsAdding(false);
  };

  return (
    <aside className="sticky-facts-drawer" aria-label="Sticky Facts Memory">
      <div className="drawer-header">
        <div className="drawer-title-group">
          <Pin size={18} className="drawer-icon" />
          <h3 className="drawer-title">Sticky Facts Memory</h3>
          <span className="drawer-count">({facts.length})</span>
        </div>
        <button
          type="button"
          className="drawer-close-btn"
          onClick={onClose}
          title="Закрыть панель"
        >
          <X size={18} />
        </button>
      </div>

      <div className="drawer-description">
        Key-Value память сохраняет важные факты (цели, ограничения, договорённости) и передаётся в каждом запросе к модели вместе с последними N сообщениями.
      </div>

      {isExtracting && (
        <div className="facts-extracting-banner">
          <RefreshCw size={14} className="spinning" />
          <span>Фоновое обновление фактов через LLM...</span>
        </div>
      )}

      {/* Action Bar */}
      <div className="drawer-actions">
        <button
          type="button"
          className="action-pill-btn add-btn"
          onClick={() => setIsAdding(!isAdding)}
        >
          {isAdding ? <X size={14} /> : <Plus size={14} />}
          <span>{isAdding ? 'Отмена' : 'Добавить факт'}</span>
        </button>

        {facts.length > 0 && (
          <button
            type="button"
            className="action-pill-btn clear-btn-facts"
            onClick={() => {
              if (window.confirm('Очистить все сохранённые факты?')) {
                onClearFacts();
              }
            }}
            title="Очистить все факты"
          >
            <Trash2 size={13} />
            <span>Очистить</span>
          </button>
        )}
      </div>

      {/* Add New Fact Form */}
      {isAdding && (
        <form className="add-fact-form" onSubmit={handleAddSubmit}>
          <div className="form-row">
            <input
              type="text"
              placeholder="Ключ (например, бюджет, цель)"
              className="fact-input"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
            />
            <select
              className="fact-category-select"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as FactItem['category'])}
            >
              <option value="goal">🎯 Цель</option>
              <option value="constraint">⛔ Ограничение</option>
              <option value="preference">⭐ Предпочтение</option>
              <option value="decision">💡 Решение</option>
              <option value="agreement">🤝 Договорённость</option>
              <option value="other">📌 Другое</option>
            </select>
          </div>
          <div className="form-row">
            <input
              type="text"
              placeholder="Значение (например, до $500, только TypeScript)"
              className="fact-input value-input"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
            <button
              type="submit"
              className="save-fact-btn"
              disabled={!newKey.trim() || !newValue.trim()}
            >
              <Check size={14} />
              <span>Сохранить</span>
            </button>
          </div>
        </form>
      )}

      {/* Facts List */}
      <div className="facts-list">
        {facts.length === 0 ? (
          <div className="empty-facts-placeholder">
            <Sparkles size={24} className="placeholder-icon" />
            <p className="placeholder-text">Пока нет сохранённых фактов.</p>
            <span className="placeholder-hint">
              В стратегии Sticky Facts факты извлекаются моделью автоматически после сообщений пользователя, либо вы можете добавить их вручную.
            </span>
          </div>
        ) : (
          facts.map((fact) => {
            const isEditing = editingId === fact.id;
            const categoryInfo = CATEGORY_COLORS[fact.category || 'other'] || CATEGORY_COLORS.other;

            if (isEditing) {
              return (
                <div key={fact.id} className="fact-item editing">
                  <div className="fact-edit-grid">
                    <input
                      type="text"
                      className="fact-input"
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
                    />
                    <select
                      className="fact-category-select"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as FactItem['category'])}
                    >
                      <option value="goal">🎯 Цель</option>
                      <option value="constraint">⛔ Ограничение</option>
                      <option value="preference">⭐ Предпочтение</option>
                      <option value="decision">💡 Решение</option>
                      <option value="agreement">🤝 Договорённость</option>
                      <option value="other">📌 Другое</option>
                    </select>
                    <input
                      type="text"
                      className="fact-input value-input full-width"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                  </div>
                  <div className="fact-edit-actions">
                    <button
                      type="button"
                      className="icon-action-btn check-btn"
                      onClick={() => handleSaveEdit(fact.id)}
                      title="Сохранить"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-action-btn cancel-btn"
                      onClick={handleCancelEdit}
                      title="Отмена"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={fact.id} className="fact-item">
                <div className="fact-content">
                  <div className="fact-top-line">
                    <span
                      className="fact-category-tag"
                      style={{
                        backgroundColor: categoryInfo.bg,
                        color: categoryInfo.text,
                      }}
                    >
                      {categoryInfo.label}
                    </span>
                    <span className="fact-key">{fact.key}</span>
                  </div>
                  <div className="fact-value">{fact.value}</div>
                </div>
                <div className="fact-actions">
                  <button
                    type="button"
                    className="fact-action-btn"
                    onClick={() => handleStartEdit(fact)}
                    title="Редактировать"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="fact-action-btn delete-btn"
                    onClick={() => onRemoveFact(fact.id)}
                    title="Удалить"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
