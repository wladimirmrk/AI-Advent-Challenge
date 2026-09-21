import React, { useState } from 'react';
import {
  WorkingMemory,
  LongTermMemory,
  MemoryTokensBreakdown,
  Message,
} from '../agent/types';
import { Agent } from '../agent/Agent';
import {
  Brain,
  Layers,
  CheckSquare,
  Square,
  Trash2,
  Plus,
  X,
  Eye,
  User,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';

interface MemoryHubProps {
  isOpen: boolean;
  onClose: () => void;
  workingMemory: WorkingMemory;
  longTermMemory: LongTermMemory;
  memoryTokensBreakdown: MemoryTokensBreakdown;
  recentMessagesCount: number;
  messages: Message[];
  agent: Agent;
}

type ActiveTab = 'short_term' | 'working' | 'long_term';

export const MemoryHub: React.FC<MemoryHubProps> = ({
  isOpen,
  onClose,
  workingMemory,
  longTermMemory,
  memoryTokensBreakdown,
  recentMessagesCount,
  messages,
  agent,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('working');
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [copiedContext, setCopiedContext] = useState(false);

  // Working Memory input state
  const [goalInput, setGoalInput] = useState(workingMemory.goal || '');
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [newPlanText, setNewPlanText] = useState('');
  const [scratchpadText, setScratchpadText] = useState(workingMemory.scratchpad || '');
  const [isScratchpadDirty, setIsScratchpadDirty] = useState(false);

  // Long-Term Memory input state
  const [profileName, setProfileName] = useState(longTermMemory.profile.name || '');
  const [profileRole, setProfileRole] = useState(longTermMemory.profile.role || '');
  const [profilePref, setProfilePref] = useState(longTermMemory.profile.preferences.join(', '));
  const [profileNotes, setProfileNotes] = useState(longTermMemory.profile.customNotes || '');
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Decision state
  const [newDecTitle, setNewDecTitle] = useState('');
  const [newDecRationale, setNewDecRationale] = useState('');
  const [isAddingDecision, setIsAddingDecision] = useState(false);

  // Knowledge state
  const [newKnowKey, setNewKnowKey] = useState('');
  const [newKnowContent, setNewKnowContent] = useState('');
  const [newKnowTags, setNewKnowTags] = useState('');
  const [isAddingKnowledge, setIsAddingKnowledge] = useState(false);

  if (!isOpen) return null;

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    agent.setWorkingGoal(goalInput.trim());
    setIsEditingGoal(false);
  };

  const handleAddPlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlanText.trim()) return;
    agent.addPlanItem(newPlanText.trim());
    setNewPlanText('');
  };

  const handleSaveScratchpad = () => {
    agent.updateScratchpad(scratchpadText);
    setIsScratchpadDirty(false);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const prefs = profilePref
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    agent.updateUserProfile({
      name: profileName.trim(),
      role: profileRole.trim(),
      preferences: prefs,
      customNotes: profileNotes.trim(),
    });
    setIsEditingProfile(false);
  };

  const handleAddDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecTitle.trim()) return;
    agent.addDecision(newDecTitle.trim(), newDecRationale.trim());
    setNewDecTitle('');
    setNewDecRationale('');
    setIsAddingDecision(false);
  };

  const handleAddKnowledge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKnowKey.trim() || !newKnowContent.trim()) return;
    const tags = newKnowTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    agent.addKnowledge(newKnowKey.trim(), newKnowContent.trim(), tags);
    setNewKnowKey('');
    setNewKnowContent('');
    setNewKnowTags('');
    setIsAddingKnowledge(false);
  };

  const handleLoadVerificationPreset = () => {
    // 1. Set Long-term memory profile and decisions
    agent.updateUserProfile({
      name: 'Алексей Архитектор',
      role: 'Staff Engineer (Go / Cloud Native)',
      preferences: ['Строгая типизация', 'Лаконичные ответы', 'Microservices', 'Clean Architecture'],
      customNotes: 'Фокус на отказоустойчивости, gRPC и PostgreSQL.',
    });

    agent.addDecision(
      'Стек: Go 1.22 + gRPC + Protobuf',
      'Высокая пропускная способность, строгие бинарные контракты и минимальный latency.'
    );

    agent.addKnowledge('AuthServiceInternalPort', 'Служебный порт авторизации: 50051', ['networking', 'auth']);

    // 2. Set Working memory task and checklist
    agent.clearWorkingMemory();
    agent.setWorkingGoal('Спроектировать и реализовать сервис авторизации (Auth Service)');
    agent.addPlanItem('Шаг 1: Описать proto-файлы и схему БД (выполнено)');
    agent.togglePlanItem(agent.getWorkingMemory().plan[0]?.id || '');
    agent.addPlanItem('Шаг 2: Реализовать генерацию и верификацию JWT RS256 токенов');
    agent.addPlanItem('Шаг 3: Написать интеграционные тесты для эндпоинта /VerifyToken');
    agent.updateScratchpad('Внимание: не хранить приватные ключи в кодовой базе, использовать Secret Manager.');

    // Update local inputs
    setGoalInput('Спроектировать и реализовать сервис авторизации (Auth Service)');
    setScratchpadText('Внимание: не хранить приватные ключи в кодовой базе, использовать Secret Manager.');
    setProfileName('Алексей Архитектор');
    setProfileRole('Staff Engineer (Go / Cloud Native)');
    setProfilePref('Строгая типизация, Лаконичные ответы, Microservices, Clean Architecture');
    setProfileNotes('Фокус на отказоустойчивости, gRPC и PostgreSQL.');
  };

  const preparedContext = agent.getPreparedMessages(agent.getHistory());
  const formattedContextText = preparedContext
    .map((m) => `=== [ROLE: ${m.role.toUpperCase()}] ===\n${m.content}`)
    .join('\n\n');

  const handleCopyContext = () => {
    navigator.clipboard.writeText(formattedContextText);
    setCopiedContext(true);
    setTimeout(() => setCopiedContext(false), 2000);
  };

  const doneCount = workingMemory.plan.filter((p) => p.done).length;

  return (
    <aside className="memory-hub-drawer" aria-label="Agent Memory Hub">
      {/* Drawer Header */}
      <div className="drawer-header">
        <div className="drawer-title-group">
          <Brain size={20} className="drawer-icon memory-icon-primary" />
          <div>
            <h3 className="drawer-title">Memory Hub</h3>
            <span className="drawer-subtitle">3 явных слоя памяти агента</span>
          </div>
        </div>
        <button
          type="button"
          className="drawer-close-btn"
          onClick={onClose}
          title="Закрыть панель памяти"
        >
          <X size={18} />
        </button>
      </div>

      {/* Token Distribution Bar */}
      <div className="memory-token-banner">
        <div className="token-breakdown-row">
          <span className="token-chip short-term" title="Токены недавних сообщений диалога">
            Short-term: ~{memoryTokensBreakdown.shortTermTokens}
          </span>
          <span className="token-chip working" title="Токены задачи, плана и заметок">
            Working: ~{memoryTokensBreakdown.workingTokens}
          </span>
          <span className="token-chip long-term" title="Токены профиля, решений и базы знаний">
            Long-term: ~{memoryTokensBreakdown.longTermTokens}
          </span>
          <span className="token-chip system" title="Токены системного промпта">
            System: ~{memoryTokensBreakdown.systemTokens}
          </span>
        </div>
        <div className="memory-banner-actions">
          <button
            type="button"
            className="context-inspect-btn"
            onClick={() => setIsContextModalOpen(true)}
            title="Посмотреть, как все 3 слоя памяти объединяются в реальный промпт для LLM"
          >
            <Eye size={13} />
            <span>Inspect Context</span>
          </button>
          <button
            type="button"
            className="preset-btn"
            onClick={handleLoadVerificationPreset}
            title="Загрузить готовый демонстрационный набор данных для тестирования слоев"
          >
            <Sparkles size={13} />
            <span>Load Demo Preset</span>
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="memory-tabs-nav">
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'short_term' ? 'active' : ''}`}
          onClick={() => setActiveTab('short_term')}
        >
          <Layers size={15} />
          <span>1. Short-Term</span>
          <span className="tab-badge">{messages.length}</span>
        </button>
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'working' ? 'active' : ''}`}
          onClick={() => setActiveTab('working')}
        >
          <CheckSquare size={15} />
          <span>2. Working</span>
          <span className="tab-badge">{workingMemory.plan.length}</span>
        </button>
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'long_term' ? 'active' : ''}`}
          onClick={() => setActiveTab('long_term')}
        >
          <User size={15} />
          <span>3. Long-Term</span>
          <span className="tab-badge">
            {longTermMemory.decisions.length + longTermMemory.knowledge.length}
          </span>
        </button>
      </div>

      {/* Drawer Body Tabs */}
      <div className="memory-tab-content">
        {/* TAB 1: SHORT-TERM MEMORY */}
        {activeTab === 'short_term' && (
          <div className="tab-pane short-term-pane">
            <div className="memory-layer-desc">
              <strong>Краткосрочная память (Short-Term Memory):</strong>
              <p>
                Текущий диалог в чате. Отправляет последние <strong>{recentMessagesCount}</strong>{' '}
                сообщений (Sliding Window). При переполнении окна старые сообщения вытесняются,
                сохраняя свежий локальный контекст.
              </p>
            </div>

            <div className="short-term-actions">
              <span className="messages-count-label">
                Сообщений в истории: <strong>{messages.length}</strong> (активное окно:{' '}
                {Math.min(messages.length, recentMessagesCount)})
              </span>
              {messages.length > 0 && (
                <button
                  type="button"
                  className="danger-outline-btn"
                  onClick={() => {
                    if (window.confirm('Очистить сообщения текущего диалога?')) {
                      agent.clearHistory();
                    }
                  }}
                >
                  <Trash2 size={13} />
                  <span>Очистить диалог</span>
                </button>
              )}
            </div>

            <div className="messages-preview-list">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <Layers size={28} className="empty-icon" />
                  <p>Диалог пуст. Отправьте сообщение, чтобы наполнить краткосрочную память.</p>
                </div>
              ) : (
                messages.slice(-recentMessagesCount).map((msg) => (
                  <div key={msg.id} className={`msg-preview-card ${msg.role}`}>
                    <div className="msg-preview-header">
                      <span className="msg-role-tag">{msg.role}</span>
                      <span className="msg-tokens-tag">~{msg.tokens || 0} токенов</span>
                    </div>
                    <div className="msg-preview-body">{msg.content}</div>
                    <div className="msg-preview-footer">
                      <button
                        type="button"
                        className="promote-btn"
                        onClick={() => {
                          agent.routeMemoryItem('working', {
                            text: msg.content.slice(0, 120),
                            category: 'scratchpad',
                          });
                        }}
                        title="Сохранить фрагмент в Рабочую память задачи"
                      >
                        → В Рабочую память
                      </button>
                      <button
                        type="button"
                        className="promote-btn"
                        onClick={() => {
                          agent.routeMemoryItem('long_term', {
                            key: `Заметка ${Date.now().toString().slice(-4)}`,
                            text: msg.content.slice(0, 150),
                            category: 'knowledge',
                          });
                        }}
                        title="Сохранить факт в Долговременную память"
                      >
                        → В Долговременную
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2: WORKING MEMORY */}
        {activeTab === 'working' && (
          <div className="tab-pane working-pane">
            <div className="memory-layer-desc">
              <strong>Рабочая память (Working Memory / Task Scratchpad):</strong>
              <p>
                Контекст текущей выполняемой задачи. Изолирована в рамках текущего чата.
                Включает цель задачи, чеклист плана и оперативные заметки.
              </p>
            </div>

            {/* Task Goal Card */}
            <div className="working-card goal-card">
              <div className="card-header">
                <span className="card-title">🎯 Цель задачи (Goal)</span>
                {!isEditingGoal && (
                  <button
                    type="button"
                    className="card-edit-btn"
                    onClick={() => setIsEditingGoal(true)}
                  >
                    {workingMemory.goal ? 'Изменить' : '+ Задать цель'}
                  </button>
                )}
              </div>
              {isEditingGoal ? (
                <form onSubmit={handleSaveGoal} className="inline-edit-form">
                  <input
                    type="text"
                    className="hub-input"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    placeholder="Например: Спроектировать схему базы данных биллинга"
                    autoFocus
                  />
                  <div className="form-actions">
                    <button type="submit" className="primary-btn-sm">
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => setIsEditingGoal(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <div className="goal-display">
                  {workingMemory.goal ? (
                    <p className="goal-text">{workingMemory.goal}</p>
                  ) : (
                    <p className="placeholder-text">Цель пока не задана. Добавьте цель задачи.</p>
                  )}
                </div>
              )}
            </div>

            {/* Plan / Checklist */}
            <div className="working-card plan-card">
              <div className="card-header">
                <span className="card-title">
                  📋 План и подзадачи ({doneCount}/{workingMemory.plan.length})
                </span>
              </div>

              <div className="plan-checklist">
                {workingMemory.plan.map((item) => (
                  <div key={item.id} className={`plan-item ${item.done ? 'done' : ''}`}>
                    <button
                      type="button"
                      className="checkbox-btn"
                      onClick={() => agent.togglePlanItem(item.id)}
                      title={item.done ? 'Отметить как невыполненный' : 'Отметить выполненным'}
                    >
                      {item.done ? (
                        <CheckSquare size={16} className="checked-icon" />
                      ) : (
                        <Square size={16} className="unchecked-icon" />
                      )}
                    </button>
                    <span className="plan-text">{item.text}</span>
                    <button
                      type="button"
                      className="item-delete-btn"
                      onClick={() => agent.removePlanItem(item.id)}
                      title="Удалить подзадачу"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add plan item form */}
              <form onSubmit={handleAddPlan} className="add-item-form">
                <input
                  type="text"
                  className="hub-input-sm"
                  value={newPlanText}
                  onChange={(e) => setNewPlanText(e.target.value)}
                  placeholder="+ Добавить шаг плана..."
                />
                <button type="submit" className="icon-btn-add" disabled={!newPlanText.trim()}>
                  <Plus size={15} />
                </button>
              </form>
            </div>

            {/* Scratchpad / Notes */}
            <div className="working-card scratchpad-card">
              <div className="card-header">
                <span className="card-title">📝 Рабочие заметки (Scratchpad)</span>
                {isScratchpadDirty && (
                  <button
                    type="button"
                    className="primary-btn-sm"
                    onClick={handleSaveScratchpad}
                  >
                    Сохранить заметки
                  </button>
                )}
              </div>
              <textarea
                className="hub-textarea"
                rows={3}
                value={scratchpadText}
                onChange={(e) => {
                  setScratchpadText(e.target.value);
                  setIsScratchpadDirty(true);
                }}
                placeholder="Оперативные переменные, временные ограничения и промежуточные результаты..."
              />
            </div>

            {/* Clear Working Memory */}
            <div className="layer-footer-actions">
              <button
                type="button"
                className="danger-outline-btn"
                onClick={() => {
                  if (window.confirm('Очистить рабочую память текущей задачи?')) {
                    agent.clearWorkingMemory();
                    setGoalInput('');
                    setScratchpadText('');
                  }
                }}
              >
                <Trash2 size={13} />
                <span>Очистить Рабочую память</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: LONG-TERM MEMORY */}
        {activeTab === 'long_term' && (
          <div className="tab-pane long-term-pane">
            <div className="memory-layer-desc">
              <strong>Долговременная память (Long-Term Memory):</strong>
              <p>
                Постоянные знания, сохраняемые между сессиями и общие для всех чатов.
                Включает профиль пользователя, архитектурные решения и базу знаний.
              </p>
            </div>

            {/* User Profile Card */}
            <div className="longterm-card profile-card">
              <div className="card-header">
                <span className="card-title">👤 Профиль пользователя</span>
                <button
                  type="button"
                  className="card-edit-btn"
                  onClick={() => setIsEditingProfile(!isEditingProfile)}
                >
                  {isEditingProfile ? 'Свернуть' : 'Редактировать'}
                </button>
              </div>

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="profile-edit-form">
                  <div className="form-group-sm">
                    <label>Имя пользователя:</label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Например: Алексей"
                    />
                  </div>
                  <div className="form-group-sm">
                    <label>Роль / Специализация:</label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profileRole}
                      onChange={(e) => setProfileRole(e.target.value)}
                      placeholder="Например: Senior Go Architect"
                    />
                  </div>
                  <div className="form-group-sm">
                    <label>Предпочтения (через запятую):</label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profilePref}
                      onChange={(e) => setProfilePref(e.target.value)}
                      placeholder="Например: TypeScript, краткость, тесты"
                    />
                  </div>
                  <div className="form-group-sm">
                    <label>Дополнительные примечания:</label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profileNotes}
                      onChange={(e) => setProfileNotes(e.target.value)}
                      placeholder="Особые требования к коду и стилю..."
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="primary-btn-sm">
                      Сохранить профиль
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => setIsEditingProfile(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <div className="profile-view">
                  <div className="profile-row">
                    <span className="lbl">Имя:</span>
                    <span className="val">{longTermMemory.profile.name || '—'}</span>
                  </div>
                  <div className="profile-row">
                    <span className="lbl">Роль:</span>
                    <span className="val">{longTermMemory.profile.role || '—'}</span>
                  </div>
                  {longTermMemory.profile.preferences.length > 0 && (
                    <div className="profile-row">
                      <span className="lbl">Предпочтения:</span>
                      <div className="tags-list">
                        {longTermMemory.profile.preferences.map((p, idx) => (
                          <span key={idx} className="pref-tag">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {longTermMemory.profile.customNotes && (
                    <div className="profile-row">
                      <span className="lbl">Заметки:</span>
                      <span className="val">{longTermMemory.profile.customNotes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Decisions List */}
            <div className="longterm-card decisions-card">
              <div className="card-header">
                <span className="card-title">
                  💡 Принятые решения ({longTermMemory.decisions.length})
                </span>
                <button
                  type="button"
                  className="card-edit-btn"
                  onClick={() => setIsAddingDecision(!isAddingDecision)}
                >
                  {isAddingDecision ? 'Свернуть' : '+ Добавить решение'}
                </button>
              </div>

              {isAddingDecision && (
                <form onSubmit={handleAddDecision} className="add-decision-form">
                  <input
                    type="text"
                    className="hub-input-sm"
                    value={newDecTitle}
                    onChange={(e) => setNewDecTitle(e.target.value)}
                    placeholder="Название решения (напр., Архитектура на Go + gRPC)..."
                    required
                  />
                  <input
                    type="text"
                    className="hub-input-sm"
                    value={newDecRationale}
                    onChange={(e) => setNewDecRationale(e.target.value)}
                    placeholder="Обоснование / почему было принято это решение..."
                  />
                  <div className="form-actions">
                    <button type="submit" className="primary-btn-sm">
                      Добавить
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => setIsAddingDecision(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              )}

              <div className="decisions-list">
                {longTermMemory.decisions.length === 0 ? (
                  <p className="placeholder-text">Нет сохранённых решений.</p>
                ) : (
                  longTermMemory.decisions.map((d) => (
                    <div key={d.id} className="decision-item">
                      <div className="decision-info">
                        <strong>{d.title}</strong>
                        {d.rationale && <p>{d.rationale}</p>}
                      </div>
                      <button
                        type="button"
                        className="item-delete-btn"
                        onClick={() => agent.removeDecision(d.id)}
                        title="Удалить решение"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Knowledge Base */}
            <div className="longterm-card knowledge-card">
              <div className="card-header">
                <span className="card-title">
                  📚 Постоянная база знаний ({longTermMemory.knowledge.length})
                </span>
                <button
                  type="button"
                  className="card-edit-btn"
                  onClick={() => setIsAddingKnowledge(!isAddingKnowledge)}
                >
                  {isAddingKnowledge ? 'Свернуть' : '+ Добавить знание'}
                </button>
              </div>

              {isAddingKnowledge && (
                <form onSubmit={handleAddKnowledge} className="add-knowledge-form">
                  <input
                    type="text"
                    className="hub-input-sm"
                    value={newKnowKey}
                    onChange={(e) => setNewKnowKey(e.target.value)}
                    placeholder="Ключ / Заголовок факта..."
                    required
                  />
                  <textarea
                    className="hub-textarea"
                    rows={2}
                    value={newKnowContent}
                    onChange={(e) => setNewKnowContent(e.target.value)}
                    placeholder="Содержание знания / факт..."
                    required
                  />
                  <input
                    type="text"
                    className="hub-input-sm"
                    value={newKnowTags}
                    onChange={(e) => setNewKnowTags(e.target.value)}
                    placeholder="Теги через запятую (напр., database, security)..."
                  />
                  <div className="form-actions">
                    <button type="submit" className="primary-btn-sm">
                      Добавить
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => setIsAddingKnowledge(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              )}

              <div className="knowledge-list">
                {longTermMemory.knowledge.length === 0 ? (
                  <p className="placeholder-text">База знаний пока пуста.</p>
                ) : (
                  longTermMemory.knowledge.map((k) => (
                    <div key={k.id} className="knowledge-item">
                      <div className="knowledge-header">
                        <strong>{k.key}</strong>
                        {k.tags.length > 0 && (
                          <span className="know-tags">[{k.tags.join(', ')}]</span>
                        )}
                      </div>
                      <p className="knowledge-body">{k.content}</p>
                      <button
                        type="button"
                        className="item-delete-btn"
                        onClick={() => agent.removeKnowledge(k.id)}
                        title="Удалить знание"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Clear Long-Term Memory */}
            <div className="layer-footer-actions">
              <button
                type="button"
                className="danger-outline-btn"
                onClick={() => {
                  if (window.confirm('Очистить глобальную долговременную память (профиль, решения, знания)?')) {
                    agent.clearLongTermMemory();
                    setProfileName('');
                    setProfileRole('');
                    setProfilePref('');
                    setProfileNotes('');
                  }
                }}
              >
                <Trash2 size={13} />
                <span>Очистить Долговременную память</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* INSPECT EFFECTIVE CONTEXT MODAL */}
      {isContextModalOpen && (
        <div className="modal-overlay" onClick={() => setIsContextModalOpen(false)}>
          <div
            className="context-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <Eye size={18} className="modal-icon" />
                <h3>Inspect Effective LLM Context (3 Layers)</h3>
              </div>
              <div className="modal-header-actions">
                <button
                  type="button"
                  className="copy-context-btn"
                  onClick={handleCopyContext}
                  title="Скопировать полный контекст"
                >
                  {copiedContext ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedContext ? 'Скопировано!' : 'Копировать'}</span>
                </button>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsContextModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="modal-body context-modal-body">
              <p className="context-modal-hint">
                Ниже показано буквальное содержимое запроса, которое передаётся в языковую модель при следующем обращении. Слои памяти скомпонованы в строгом порядке: <strong>System Prompt → Long-Term Memory → Working Memory → Short-Term History</strong>.
              </p>

              <div className="context-messages-display">
                {preparedContext.map((item, idx) => {
                  let layerBadge = 'Short-Term';
                  let layerClass = 'layer-short-term';
                  if (item.content.includes('[LONG-TERM MEMORY')) {
                    layerBadge = 'Long-Term Memory';
                    layerClass = 'layer-long-term';
                  } else if (item.content.includes('[WORKING MEMORY')) {
                    layerBadge = 'Working Memory';
                    layerClass = 'layer-working';
                  } else if (item.role === 'system') {
                    layerBadge = 'System Persona';
                    layerClass = 'layer-system';
                  }

                  return (
                    <div key={idx} className={`context-block ${layerClass}`}>
                      <div className="context-block-header">
                        <span className="block-layer-badge">{layerBadge}</span>
                        <span className="block-role-tag">role: {item.role}</span>
                      </div>
                      <pre className="context-block-pre">{item.content}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
