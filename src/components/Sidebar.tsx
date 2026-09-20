import React, { useState, useRef, useEffect } from 'react';
import { ChatMetadata } from '../agent/types';
import {
  Plus,
  MessageSquare,
  Trash2,
  Edit2,
  Check,
  X,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';

interface SidebarProps {
  chats: ChatMetadata[];
  activeChatId: string;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSelectChat: (chatId: string) => void;
  onCreateChat: () => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onDeleteChat: (chatId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  chats,
  activeChatId,
  isOpen,
  onToggleOpen,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onDeleteChat,
}) => {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  const handleStartRename = (e: React.MouseEvent, chat: ChatMetadata) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const handleSaveRename = (e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (editingChatId) {
      const trimmed = editingTitle.trim();
      if (trimmed) {
        onRenameChat(editingChatId, trimmed);
      }
      setEditingChatId(null);
      setEditingTitle('');
    }
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(null);
    setEditingTitle('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingChatId(null);
      setEditingTitle('');
    }
  };

  const handleDelete = (e: React.MouseEvent, chat: ChatMetadata) => {
    e.stopPropagation();
    if (chats.length <= 1) {
      if (window.confirm(`Удалить "${chat.title}"? История будет очищена, и откроется новый пустой диалог.`)) {
        onDeleteChat(chat.id);
      }
      return;
    }

    if (window.confirm(`Вы уверены, что хотите удалить чат "${chat.title}"?`)) {
      onDeleteChat(chat.id);
    }
  };

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isOpen && <div className="sidebar-backdrop" onClick={onToggleOpen} />}

      <aside className={`chat-sidebar ${isOpen ? 'open' : 'collapsed'}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="new-chat-btn"
            onClick={onCreateChat}
            title="Создать новый чат"
          >
            <Plus size={18} />
            <span>Новый чат</span>
          </button>

          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleOpen}
            title={isOpen ? 'Свернуть панель' : 'Развернуть панель'}
          >
            {isOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>
        </div>

        <div className="sidebar-chat-list">
          <div className="chat-list-label">Ваши диалоги</div>
          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isEditing = chat.id === editingChatId;

            return (
              <div
                key={chat.id}
                className={`chat-list-item ${isActive ? 'active' : ''}`}
                onClick={() => !isEditing && onSelectChat(chat.id)}
                title={chat.title}
              >
                <MessageSquare size={16} className="chat-item-icon" />

                {isEditing ? (
                  <div className="chat-item-edit-wrapper" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={editInputRef}
                      type="text"
                      className="chat-item-edit-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleKeyDown}
                      maxLength={60}
                    />
                    <button
                      type="button"
                      className="chat-edit-action-btn confirm"
                      onClick={handleSaveRename}
                      title="Сохранить"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="chat-edit-action-btn cancel"
                      onClick={handleCancelRename}
                      title="Отмена"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="chat-item-title">{chat.title}</span>
                    <div className="chat-item-actions">
                      <button
                        type="button"
                        className="chat-item-action-btn edit-btn"
                        onClick={(e) => handleStartRename(e, chat)}
                        title="Переименовать"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        className="chat-item-action-btn delete-btn"
                        onClick={(e) => handleDelete(e, chat)}
                        title="Удалить чат"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
};
