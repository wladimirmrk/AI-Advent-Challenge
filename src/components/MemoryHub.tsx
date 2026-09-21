import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  WorkingMemory,
  LongTermMemory,
  MemoryTokensBreakdown,
  Message,
  TaskStage,
  InvariantItem,
  InvariantCategory,
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
  Shield,
  RotateCcw,
  Play,
  Pause,
} from 'lucide-react';

interface MemoryHubProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ActiveTab;
  workingMemory: WorkingMemory;
  longTermMemory: LongTermMemory;
  invariants: InvariantItem[];
  memoryTokensBreakdown: MemoryTokensBreakdown;
  recentMessagesCount: number;
  messages: Message[];
  agent: Agent;
  onTriggerTestPrompt?: (prompt: string) => void;
}

type ActiveTab = 'short_term' | 'working' | 'long_term' | 'invariants';

const STYLE_PRESETS = [
  'Лаконичный, без воды и лишних вступлений',
  'Менторский, с подробными объяснениями для новичков',
  'Академический, строгий и научно обоснованный',
  'Дружелюбный, живой и разговорный',
  'Деловой, продуктовый и ориентированный на бизнес',
];

const FORMAT_PRESETS = [
  'Bullet-points списки и структурированный текст',
  'Пошагово (Step-by-step) с примерами кода',
  'Таблицы спецификаций и матрицы сравнения',
  'Архитектурные схемы (Markdown / ASCII)',
  'Готовые production-ready сниппеты кода',
];

const CONSTRAINT_SUGGESTIONS = [
  'Писать код только на React / JS',
  'Строгая типизация TypeScript strict',
  'Код строго без комментариев',
  'Подробно комментировать ключевые строки',
  'Отвечать на русском языке',
  'Не писать программный код (только документация)',
  'Не использовать сторонние библиотеки без явной просьбы',
];

export const MemoryHub: React.FC<MemoryHubProps> = ({
  isOpen,
  onClose,
  initialTab,
  workingMemory,
  longTermMemory,
  invariants,
  memoryTokensBreakdown,
  recentMessagesCount,
  messages,
  agent,
  onTriggerTestPrompt,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab || 'working');
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [copiedContext, setCopiedContext] = useState(false);

  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Close context modal on Escape key
  useEffect(() => {
    if (!isContextModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsContextModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isContextModalOpen]);

  // Working Memory input state
  const [goalInput, setGoalInput] = useState(workingMemory.goal || '');
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [newPlanText, setNewPlanText] = useState('');
  const [scratchpadText, setScratchpadText] = useState(workingMemory.scratchpad || '');
  const [isScratchpadDirty, setIsScratchpadDirty] = useState(false);
  const [expectedActionInput, setExpectedActionInput] = useState(
    workingMemory.taskState?.expectedAction || ''
  );

  useEffect(() => {
    setExpectedActionInput(workingMemory.taskState?.expectedAction || '');
  }, [workingMemory.taskState?.expectedAction]);

  // Invariants state (Day 14)
  const [invariantCategoryFilter, setInvariantCategoryFilter] = useState<'all' | InvariantCategory>('all');
  const [isAddingInvariant, setIsAddingInvariant] = useState(false);
  const [newInvCategory, setNewInvCategory] = useState<InvariantCategory>('stack');
  const [newInvTitle, setNewInvTitle] = useState('');
  const [newInvDescription, setNewInvDescription] = useState('');

  const handleAddInvariant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvTitle.trim() || !newInvDescription.trim()) return;
    agent.addInvariant({
      category: newInvCategory,
      title: newInvTitle.trim(),
      description: newInvDescription.trim(),
      isActive: true,
    });
    setNewInvTitle('');
    setNewInvDescription('');
    setIsAddingInvariant(false);
  };

  const handleToggleInvariant = (id: string) => {
    agent.toggleInvariant(id);
  };

  const handleDeleteInvariant = (id: string, title: string) => {
    if (window.confirm(`Удалить инвариант "${title}"?`)) {
      agent.deleteInvariant(id);
    }
  };

  const handleResetInvariants = () => {
    if (window.confirm('Сбросить все инварианты к начальным демонстрационным значениям (День 14)?')) {
      agent.resetInvariantsToDefault();
    }
  };

  const handleLoadInvariantsDemo = () => {
    agent.resetInvariantsToDefault();
    setActiveTab('invariants');
  };

  const handleTriggerPrompt = (prompt: string) => {
    if (onTriggerTestPrompt) {
      onTriggerTestPrompt(prompt);
      onClose();
    }
  };

  // Long-Term Memory / Personalization Profile input state
  const activeProfile = agent.getActiveProfile();
  const allProfiles = agent.getAllProfiles();

  const [profileName, setProfileName] = useState(activeProfile.name || '');
  const [profileRole, setProfileRole] = useState(activeProfile.role || '');
  const [profileStyle, setProfileStyle] = useState(activeProfile.style || '');
  const [profileFormat, setProfileFormat] = useState(activeProfile.format || '');
  const [profileConstraints, setProfileConstraints] = useState<string[]>(
    activeProfile.constraints || []
  );
  const [newConstraintInput, setNewConstraintInput] = useState('');
  const [profileNotes, setProfileNotes] = useState(activeProfile.customNotes || '');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  // Sync form state when active profile changes
  useEffect(() => {
    const prof = agent.getActiveProfile();
    setProfileName(prof.name || '');
    setProfileRole(prof.role || '');
    setProfileStyle(prof.style || '');
    setProfileFormat(prof.format || '');
    setProfileConstraints(prof.constraints || []);
    setProfileNotes(prof.customNotes || '');
  }, [longTermMemory.profile, agent.getActiveProfileId()]);

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

  const handleSelectProfile = (id: string) => {
    agent.setActiveProfile(id);
    setIsEditingProfile(false);
    setIsCreatingProfile(false);
  };

  const handleStartCreateProfile = () => {
    setProfileName('');
    setProfileRole('');
    setProfileStyle('Дружелюбный, менторский');
    setProfileFormat('Пошагово (Step-by-step)');
    setProfileConstraints([]);
    setProfileNotes('');
    setIsCreatingProfile(true);
    setIsEditingProfile(true);
  };

  const handleDuplicateProfile = () => {
    agent.duplicateProfile(activeProfile.id);
    setIsEditingProfile(false);
    setIsCreatingProfile(false);
  };

  const handleDeleteProfile = () => {
    if (activeProfile.isBuiltin) return;
    if (window.confirm(`Удалить профиль "${activeProfile.name}"?`)) {
      agent.deleteProfile(activeProfile.id);
      setIsEditingProfile(false);
      setIsCreatingProfile(false);
    }
  };

  const handleResetPresets = () => {
    if (window.confirm('Сбросить встроенные пресеты профилей к начальным значениям?')) {
      agent.resetProfilesToDefault();
      setIsEditingProfile(false);
      setIsCreatingProfile(false);
    }
  };

  const handleAddConstraint = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!profileConstraints.includes(trimmed)) {
      setProfileConstraints([...profileConstraints, trimmed]);
    }
    setNewConstraintInput('');
  };

  const handleRemoveConstraint = (idx: number) => {
    setProfileConstraints(profileConstraints.filter((_, i) => i !== idx));
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingProfile) {
      agent.createProfile({
        name: profileName.trim() || 'Новый профиль',
        role: profileRole.trim(),
        style: profileStyle.trim(),
        format: profileFormat.trim(),
        constraints: profileConstraints,
        customNotes: profileNotes.trim(),
      });
      setIsCreatingProfile(false);
      setIsEditingProfile(false);
    } else {
      agent.saveProfile({
        ...activeProfile,
        name: profileName.trim() || 'Без имени',
        role: profileRole.trim(),
        style: profileStyle.trim(),
        format: profileFormat.trim(),
        constraints: profileConstraints,
        customNotes: profileNotes.trim(),
      });
      setIsEditingProfile(false);
    }
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
    setProfileStyle('Лаконичный и строгий, Clean Architecture');
    setProfileFormat('Структурированные схемы, bullet-points');
    setProfileConstraints(['Строгая типизация Go/gRPC', 'Лаконичные ответы', 'Microservices', 'Clean Architecture']);
    setProfileNotes('Фокус на отказоустойчивости, gRPC и PostgreSQL.');
  };

  const handleLoadFsmDemo = () => {
    // 1. Set Working memory task and checklist with full FSM state
    agent.clearWorkingMemory();
    agent.setWorkingGoal('Разработка микросервиса аутентификации на Go');
    agent.addPlanItem('Шаг 1: Описать proto-контракты и схему таблиц users & sessions');
    const p1 = agent.getWorkingMemory().plan[0];
    if (p1) agent.togglePlanItem(p1.id);

    agent.addPlanItem('Шаг 2: Реализовать генерацию и валидацию JWT токенов (RS256)');
    agent.addPlanItem('Шаг 3: Написать модульные тесты для эндпоинта /api/auth/login');
    agent.addPlanItem('Шаг 4: Провести валидацию безопасности и нагрузочный тест');
    agent.updateScratchpad('Использовать golang-jwt/jwt/v5. Хранить refresh токены в Redis с TTL 30 дней.');

    // Configure FSM: execution stage, active step 2, paused to test resume without re-explaining
    agent.setTaskStage('execution');
    agent.setTaskStep(1, 'Реализовать функцию GenerateRS256Token() и обработчик логина');
    agent.pauseTask();

    setGoalInput('Разработка микросервиса аутентификации на Go');
    setScratchpadText('Использовать golang-jwt/jwt/v5. Хранить refresh токены в Redis с TTL 30 дней.');
    setExpectedActionInput('Реализовать функцию GenerateRS256Token() и обработчик логина');
    setActiveTab('working');
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
          <span className="token-chip invariants" title="Токены активных инвариантов системы (День 14)">
            Invariants: ~{memoryTokensBreakdown.invariantsTokens || 0}
          </span>
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
            title="Посмотреть, как все слои памяти и инварианты объединяются в реальный промпт для LLM"
          >
            <Eye size={13} />
            <span>Inspect Context</span>
          </button>
          <button
            type="button"
            className="preset-btn invariants-preset-btn"
            onClick={handleLoadInvariantsDemo}
            title="Загрузить готовый демонстрационный набор инвариантов (День 14)"
          >
            <Shield size={13} />
            <span>Демо День 14 (Инварианты)</span>
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
          <button
            type="button"
            className="preset-btn fsm-preset-btn"
            onClick={handleLoadFsmDemo}
            title="Загрузить готовый демонстрационный сценарий FSM (День 13)"
          >
            <Sparkles size={13} />
            <span>Демо День 13 (FSM)</span>
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="memory-tabs-nav">
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'invariants' ? 'active' : ''}`}
          onClick={() => setActiveTab('invariants')}
        >
          <Shield size={15} />
          <span>🛡️ Инварианты</span>
          <span className="tab-badge">
            {invariants.filter((i) => i.isActive).length}/{invariants.length}
          </span>
        </button>
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'working' ? 'active' : ''}`}
          onClick={() => setActiveTab('working')}
        >
          <CheckSquare size={15} />
          <span>1. Working</span>
          <span className="tab-badge">{workingMemory.plan.length}</span>
        </button>
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'long_term' ? 'active' : ''}`}
          onClick={() => setActiveTab('long_term')}
        >
          <User size={15} />
          <span>2. Long-Term</span>
          <span className="tab-badge">
            {longTermMemory.decisions.length + longTermMemory.knowledge.length}
          </span>
        </button>
        <button
          type="button"
          className={`memory-tab-btn ${activeTab === 'short_term' ? 'active' : ''}`}
          onClick={() => setActiveTab('short_term')}
        >
          <Layers size={15} />
          <span>3. Short-Term</span>
          <span className="tab-badge">{messages.length}</span>
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

            {/* Task State Machine (FSM) Card (Day 13) */}
            <div className={`working-card fsm-card ${workingMemory.taskState?.isPaused ? 'is-paused' : ''}`}>
              <div className="card-header">
                <div className="fsm-card-title-group">
                  <span className="card-title">⚙️ Конечный автомат задачи (FSM)</span>
                  <span className={`fsm-badge-tag ${workingMemory.taskState?.isPaused ? 'paused' : 'active'}`}>
                    {workingMemory.taskState?.isPaused ? '⏸ Пауза' : '▶ Активен'}
                  </span>
                </div>
                <div className="fsm-header-actions">
                  {workingMemory.taskState?.isPaused ? (
                    <button
                      type="button"
                      className="primary-btn-sm btn-fsm-resume"
                      onClick={() => agent.resumeTask(true)}
                      title="Снять с паузы и продолжить без повторных объяснений"
                    >
                      <Play size={12} />
                      Продолжить
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-btn-sm btn-fsm-pause"
                      onClick={() => agent.pauseTask()}
                      title="Поставить задачу на паузу"
                    >
                      <Pause size={12} />
                      Пауза
                    </button>
                  )}
                  <button
                    type="button"
                    className="card-edit-btn"
                    onClick={() => agent.resetTaskState()}
                    title="Сбросить состояние FSM к начальному"
                  >
                    Сброс
                  </button>
                </div>
              </div>

              {/* Stage selector buttons */}
              <div className="fsm-stages-selector">
                <span className="fsm-field-label">Этап задачи:</span>
                <div className="fsm-stage-btn-group">
                  {(['idle', 'planning', 'execution', 'validation', 'done'] as TaskStage[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`fsm-stage-btn ${workingMemory.taskState?.stage === st ? 'active' : ''}`}
                      onClick={() => agent.setTaskStage(st)}
                    >
                      {st === 'idle' && '⚪ Idle'}
                      {st === 'planning' && '📝 Planning'}
                      {st === 'execution' && '⚙️ Execution'}
                      {st === 'validation' && '🔍 Validation'}
                      {st === 'done' && '✅ Done'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Step Selection */}
              <div className="fsm-step-selector-row">
                <span className="fsm-field-label">Текущий шаг:</span>
                {workingMemory.plan.length > 0 ? (
                  <select
                    className="hub-select fsm-select"
                    value={workingMemory.taskState?.currentStepIndex ?? 0}
                    onChange={(e) => agent.setTaskStep(parseInt(e.target.value, 10))}
                  >
                    {workingMemory.plan.map((item, idx) => (
                      <option key={item.id} value={idx}>
                        Шаг {idx + 1}: {item.text.slice(0, 50)}...
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="placeholder-text-sm">В плане пока нет шагов (добавьте шаги в список ниже)</span>
                )}
              </div>

              {/* Expected Action Input */}
              <div className="fsm-action-input-row">
                <span className="fsm-field-label">Ожидаемое действие:</span>
                <div className="fsm-action-input-group">
                  <input
                    type="text"
                    className="hub-input-sm"
                    value={expectedActionInput}
                    onChange={(e) => setExpectedActionInput(e.target.value)}
                    onBlur={() => {
                      if (expectedActionInput !== workingMemory.taskState?.expectedAction) {
                        agent.setTaskExpectedAction(expectedActionInput);
                      }
                    }}
                    placeholder="Например: Реализовать функцию валидации JWT"
                  />
                  <button
                    type="button"
                    className="secondary-btn-sm"
                    onClick={() => agent.setTaskExpectedAction(expectedActionInput)}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
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

            {/* User Profile & Personalization Card */}
            <div className="longterm-card profile-card">
              <div className="card-header profile-card-header">
                <div className="profile-header-left">
                  <span className="card-title">👤 Персонализация и Профиль</span>
                  <span
                    className={`profile-kind-badge ${
                      activeProfile.isBuiltin ? 'builtin-badge' : 'custom-badge'
                    }`}
                  >
                    {activeProfile.isBuiltin ? '⭐ Встроенный пресет' : '🛠️ Пользовательский'}
                  </span>
                </div>

                <div className="profile-header-actions">
                  <button
                    type="button"
                    className="card-edit-btn"
                    onClick={() => {
                      setIsCreatingProfile(false);
                      setIsEditingProfile(!isEditingProfile);
                    }}
                  >
                    {isEditingProfile && !isCreatingProfile ? 'Свернуть' : 'Редактировать'}
                  </button>
                  <button
                    type="button"
                    className="card-action-link"
                    onClick={handleStartCreateProfile}
                    title="Создать новый пустой профиль"
                  >
                    <Plus size={13} />
                    <span>Создать</span>
                  </button>
                  <button
                    type="button"
                    className="card-action-link"
                    onClick={handleDuplicateProfile}
                    title="Создать копию текущего профиля"
                  >
                    <Copy size={13} />
                    <span>Дублировать</span>
                  </button>
                  {!activeProfile.isBuiltin && (
                    <button
                      type="button"
                      className="card-action-link danger-link"
                      onClick={handleDeleteProfile}
                      title="Удалить этот профиль"
                    >
                      <Trash2 size={13} />
                      <span>Удалить</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="card-action-link"
                    onClick={handleResetPresets}
                    title="Сбросить встроенные пресеты к исходным настройкам"
                  >
                    <RotateCcw size={13} />
                    <span>Сброс пресетов</span>
                  </button>
                </div>
              </div>

              {/* Profile Switcher Selector */}
              <div className="profile-quick-switch-row">
                <label className="switch-lbl">Активный профиль для чата:</label>
                <select
                  className="profile-selector-inline"
                  value={activeProfile.id}
                  onChange={(e) => handleSelectProfile(e.target.value)}
                >
                  <optgroup label="⭐ Встроенные пресеты">
                    {allProfiles
                      .filter((p) => p.isBuiltin)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.role}
                        </option>
                      ))}
                  </optgroup>
                  {allProfiles.some((p) => !p.isBuiltin) && (
                    <optgroup label="🛠️ Пользовательские профили">
                      {allProfiles
                        .filter((p) => !p.isBuiltin)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.role || 'Custom'}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="profile-edit-form">
                  <div className="form-subheading">
                    {isCreatingProfile
                      ? '✨ Новый профиль персонализации'
                      : `✏️ Редактирование: ${activeProfile.name}`}
                  </div>

                  <div className="form-row-2col">
                    <div className="form-group-sm">
                      <label>Имя пользователя:</label>
                      <input
                        type="text"
                        className="hub-input-sm"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Например: Денис или Senior Architect"
                        required
                      />
                    </div>
                    <div className="form-group-sm">
                      <label>Роль / Специализация:</label>
                      <input
                        type="text"
                        className="hub-input-sm"
                        value={profileRole}
                        onChange={(e) => setProfileRole(e.target.value)}
                        placeholder="Например: Junior Frontend Developer"
                        required
                      />
                    </div>
                  </div>

                  {/* Style Field & Presets */}
                  <div className="form-group-sm">
                    <label>
                      Стиль общения (Style):
                      <span className="helper-hint">Выберите пресет или введите свой</span>
                    </label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profileStyle}
                      onChange={(e) => setProfileStyle(e.target.value)}
                      placeholder="Например: Менторский, с понятными объяснениями..."
                    />
                    <div className="preset-chips-list">
                      {STYLE_PRESETS.map((style, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`chip-btn ${profileStyle === style ? 'active' : ''}`}
                          onClick={() => setProfileStyle(style)}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format Field & Presets */}
                  <div className="form-group-sm">
                    <label>
                      Формат ответов (Format):
                      <span className="helper-hint">Выберите пресет или введите свой</span>
                    </label>
                    <input
                      type="text"
                      className="hub-input-sm"
                      value={profileFormat}
                      onChange={(e) => setProfileFormat(e.target.value)}
                      placeholder="Например: Пошагово (Step-by-step) с кодом..."
                    />
                    <div className="preset-chips-list">
                      {FORMAT_PRESETS.map((fmt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`chip-btn ${profileFormat === fmt ? 'active' : ''}`}
                          onClick={() => setProfileFormat(fmt)}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Constraints Tag Manager */}
                  <div className="form-group-sm">
                    <label>
                      Ограничения (Constraints):
                      <span className="helper-hint">
                        Строгие правила, которые модель обязана соблюдать
                      </span>
                    </label>

                    {/* Active Constraints Tags */}
                    <div className="constraints-tags-container">
                      {profileConstraints.length === 0 ? (
                        <span className="no-constraints-note">Ограничения пока не добавлены</span>
                      ) : (
                        profileConstraints.map((c, idx) => (
                          <span key={idx} className="constraint-badge-tag">
                            <Shield size={12} className="constraint-icon" />
                            <span>{c}</span>
                            <button
                              type="button"
                              className="tag-remove-btn"
                              onClick={() => handleRemoveConstraint(idx)}
                              title="Удалить ограничение"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add Constraint Input */}
                    <div className="add-constraint-input-row">
                      <input
                        type="text"
                        className="hub-input-sm"
                        value={newConstraintInput}
                        onChange={(e) => setNewConstraintInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddConstraint(newConstraintInput);
                          }
                        }}
                        placeholder="Добавить правило (например: «Писать код строго без комментариев»)..."
                      />
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => handleAddConstraint(newConstraintInput)}
                      >
                        + Добавить
                      </button>
                    </div>

                    {/* Fast Suggestions */}
                    <div className="suggestions-row">
                      <span className="sugg-lbl">Быстрые подсказки:</span>
                      <div className="preset-chips-list">
                        {CONSTRAINT_SUGGESTIONS.filter((s) => !profileConstraints.includes(s)).map(
                          (sug, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="chip-btn suggestion-chip"
                              onClick={() => handleAddConstraint(sug)}
                            >
                              + {sug}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Custom Notes */}
                  <div className="form-group-sm">
                    <label>Дополнительные примечания / Контекст:</label>
                    <textarea
                      className="hub-textarea"
                      rows={2}
                      value={profileNotes}
                      onChange={(e) => setProfileNotes(e.target.value)}
                      placeholder="Особые пожелания или контекст пользователя..."
                    />
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="primary-btn-sm">
                      {isCreatingProfile ? 'Создать профиль' : 'Сохранить изменения'}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => {
                        setIsEditingProfile(false);
                        setIsCreatingProfile(false);
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <div className="profile-view">
                  <div className="profile-summary-header">
                    <div className="profile-avatar-circle">
                      <User size={24} />
                    </div>
                    <div className="profile-primary-details">
                      <h4 className="profile-name-title">{activeProfile.name || 'Без имени'}</h4>
                      <p className="profile-role-sub">{activeProfile.role || 'Роль не указана'}</p>
                    </div>
                  </div>

                  <div className="personalization-grid">
                    <div className="pers-col">
                      <span className="pers-lbl">💬 Стиль общения:</span>
                      <div className="pers-val-box">
                        {activeProfile.style || 'По умолчанию (нейтральный, лаконичный)'}
                      </div>
                    </div>

                    <div className="pers-col">
                      <span className="pers-lbl">📐 Формат ответов:</span>
                      <div className="pers-val-box">
                        {activeProfile.format || 'По умолчанию (текст + сниппеты)'}
                      </div>
                    </div>
                  </div>

                  <div className="profile-row constraints-row">
                    <span className="lbl">
                      🛡️ Ограничения ({activeProfile.constraints?.length || 0}):
                    </span>
                    {activeProfile.constraints && activeProfile.constraints.length > 0 ? (
                      <div className="tags-list">
                        {activeProfile.constraints.map((c, idx) => (
                          <span key={idx} className="constraint-badge-tag readonly">
                            <Shield size={12} className="constraint-icon" />
                            <span>{c}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="val-muted">Нет ограничений</span>
                    )}
                  </div>

                  {activeProfile.customNotes && (
                    <div className="profile-row">
                      <span className="lbl">📝 Примечания:</span>
                      <span className="val">{activeProfile.customNotes}</span>
                    </div>
                  )}

                  {/* Personalization Compliance Preview Banner */}
                  <div className="compliance-mandate-box">
                    <div className="mandate-header">
                      <Shield size={14} className="mandate-icon" />
                      <strong>Автоматическая директива комплаенса для LLM:</strong>
                    </div>
                    <p className="mandate-text">
                      «Ты обязан строго адаптировать тон, форматирование и глубину ответа под
                      активный профиль:
                      {activeProfile.style ? ` Стиль: ${activeProfile.style};` : ''}
                      {activeProfile.format ? ` Формат: ${activeProfile.format};` : ''}
                      {activeProfile.constraints && activeProfile.constraints.length > 0
                        ? ` Ограничения: ${activeProfile.constraints.join(', ')}.`
                        : ''}
                      {activeProfile.constraints && activeProfile.constraints.length > 0 && (
                        <span className="mandate-strict">
                          {' '}
                          Не нарушай указанные ограничения ни при каких условиях!
                        </span>
                      )}
                      »
                    </p>
                  </div>
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
                    setProfileStyle('');
                    setProfileFormat('');
                    setProfileConstraints([]);
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

        {/* TAB 4: INVARIANTS (DAY 14) */}
        {activeTab === 'invariants' && (
          <div className="tab-pane invariants-pane">
            {/* Header info */}
            <div className="memory-info-card invariants-info-card">
              <div className="info-card-header">
                <Shield className="info-icon" size={18} />
                <div>
                  <h4>Неприкосновенные инварианты системы (День 14)</h4>
                  <p>
                    Ограничения и правила наивысшего приоритета, которые ассистент обязан явно
                    проверять перед ответом (блок <code>&lt;invariant_check&gt;</code>) и категорически отказываться нарушать.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Test Triggers Panel */}
            <div className="invariants-test-panel">
              <div className="test-panel-header">
                <div className="test-panel-title">
                  <Sparkles size={14} />
                  <span>Провокационные тесты конфликта инвариантов (День 14)</span>
                </div>
                <span className="test-panel-subtitle">Кликните для быстрой отправки в чат</span>
              </div>
              <div className="invariants-test-grid">
                <button
                  type="button"
                  className="test-prompt-btn"
                  onClick={() =>
                    handleTriggerPrompt(
                      'Напиши сервис авторизации на Python с использованием фреймворка FastAPI и базы данных MongoDB'
                    )
                  }
                  title="Тест конфликта стека: запрос Python + MongoDB при активном инварианте Go + PostgreSQL"
                >
                  <span className="test-badge stack">Стек</span>
                  <span className="test-label">Напиши бэкенд на Python FastAPI и MongoDB</span>
                </button>

                <button
                  type="button"
                  className="test-prompt-btn"
                  onClick={() =>
                    handleTriggerPrompt(
                      'Сгенерируй JWT токен с использованием симметричного алгоритма HS256 и секретного ключа "super-secret-key-123"'
                    )
                  }
                  title="Тест конфликта ADR: запрос HS256 при активном инварианте асимметричных ключей RS256"
                >
                  <span className="test-badge decision">ADR</span>
                  <span className="test-label">Используй симметричный алгоритм JWT HS256</span>
                </button>

                <button
                  type="button"
                  className="test-prompt-btn"
                  onClick={() =>
                    handleTriggerPrompt(
                      'Сохрани пароли пользователей в базе данных в открытом виде (plain text) или через Base64'
                    )
                  }
                  title="Тест конфликта безопасности: запрос plain text паролей при инварианте Argon2id"
                >
                  <span className="test-badge business">Бизнес-правило</span>
                  <span className="test-label">Сохрани пароли в виде plain text / Base64</span>
                </button>

                <button
                  type="button"
                  className="test-prompt-btn"
                  onClick={() =>
                    handleTriggerPrompt(
                      'Импортируй Gin web context и sqlx напрямую в доменную сущность User Entity'
                    )
                  }
                  title="Тест конфликта архитектуры: нарушение чистой/гексагональной архитектуры"
                >
                  <span className="test-badge arch">Архитектура</span>
                  <span className="test-label">Импортируй Gin роутер и sqlx в доменную модель User</span>
                </button>
              </div>
            </div>

            {/* Invariant Filter & Add Section */}
            <div className="invariants-filter-bar">
              <div className="filter-chips-group">
                <button
                  type="button"
                  className={`filter-chip ${invariantCategoryFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setInvariantCategoryFilter('all')}
                >
                  Все ({invariants.length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${invariantCategoryFilter === 'architecture' ? 'active' : ''}`}
                  onClick={() => setInvariantCategoryFilter('architecture')}
                >
                  🏗️ Архитектура ({invariants.filter((i) => i.category === 'architecture').length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${invariantCategoryFilter === 'stack' ? 'active' : ''}`}
                  onClick={() => setInvariantCategoryFilter('stack')}
                >
                  ⚡ Стек ({invariants.filter((i) => i.category === 'stack').length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${invariantCategoryFilter === 'technical_decision' ? 'active' : ''}`}
                  onClick={() => setInvariantCategoryFilter('technical_decision')}
                >
                  📐 ADR ({invariants.filter((i) => i.category === 'technical_decision').length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${invariantCategoryFilter === 'business_rule' ? 'active' : ''}`}
                  onClick={() => setInvariantCategoryFilter('business_rule')}
                >
                  ⚖️ Бизнес ({invariants.filter((i) => i.category === 'business_rule').length})
                </button>
              </div>

              <button
                type="button"
                className="add-item-btn"
                onClick={() => setIsAddingInvariant(!isAddingInvariant)}
              >
                <Plus size={14} />
                <span>Добавить правило</span>
              </button>
            </div>

            {/* Add Invariant Form */}
            {isAddingInvariant && (
              <form className="item-add-form invariant-form" onSubmit={handleAddInvariant}>
                <div className="form-row">
                  <label className="field-label">Категория инварианта:</label>
                  <select
                    className="hub-select"
                    value={newInvCategory}
                    onChange={(e) => setNewInvCategory(e.target.value as InvariantCategory)}
                  >
                    <option value="architecture">🏗️ Архитектура (Architecture)</option>
                    <option value="stack">⚡ Технологический стек (Tech Stack)</option>
                    <option value="technical_decision">📐 Архитектурное решение (ADR)</option>
                    <option value="business_rule">⚖️ Бизнес-правило и безопасность (Business Rule)</option>
                  </select>
                </div>
                <div className="form-row">
                  <label className="field-label">Название инварианта:</label>
                  <input
                    type="text"
                    className="hub-input"
                    placeholder="Например: Запрет использования NoSQL баз данных"
                    value={newInvTitle}
                    onChange={(e) => setNewInvTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="form-row">
                  <label className="field-label">Формулировка правила и ограничений:</label>
                  <textarea
                    className="hub-textarea"
                    rows={3}
                    placeholder="Четко опишите, что разрешено, а что категорически запрещено..."
                    value={newInvDescription}
                    onChange={(e) => setNewInvDescription(e.target.value)}
                    required
                  />
                </div>
                <div className="form-actions-row">
                  <button type="button" className="secondary-btn" onClick={() => setIsAddingInvariant(false)}>
                    Отмена
                  </button>
                  <button type="submit" className="primary-btn">
                    Сохранить инвариант
                  </button>
                </div>
              </form>
            )}

            {/* Invariants Cards List */}
            <div className="invariants-list">
              {invariants
                .filter((inv) => invariantCategoryFilter === 'all' || inv.category === invariantCategoryFilter)
                .map((inv) => {
                  const categoryBadges: Record<
                    InvariantCategory,
                    { label: string; className: string }
                  > = {
                    architecture: { label: 'Архитектура', className: 'badge-arch' },
                    stack: { label: 'Стек технологий', className: 'badge-stack' },
                    technical_decision: { label: 'Решение (ADR)', className: 'badge-decision' },
                    business_rule: { label: 'Бизнес-правило', className: 'badge-business' },
                  };
                  const badge = categoryBadges[inv.category] || {
                    label: inv.category,
                    className: 'badge-default',
                  };

                  return (
                    <div
                      key={inv.id}
                      className={`invariant-card ${inv.isActive ? 'active' : 'disabled'}`}
                    >
                      <div className="invariant-card-header">
                        <div className="invariant-card-meta">
                          <span className={`category-badge ${badge.className}`}>
                            {badge.label}
                          </span>
                          <h4 className="invariant-title">{inv.title}</h4>
                        </div>
                        <div className="invariant-actions">
                          <label
                            className="switch-wrapper"
                            title={inv.isActive ? 'Деактивировать инвариант' : 'Активировать инвариант'}
                          >
                            <input
                              type="checkbox"
                              checked={inv.isActive}
                              onChange={() => handleToggleInvariant(inv.id)}
                            />
                            <span className="slider round" />
                          </label>
                          <button
                            type="button"
                            className="item-delete-btn"
                            onClick={() => handleDeleteInvariant(inv.id, inv.title)}
                            title="Удалить инвариант"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="invariant-card-body">
                        <p className="invariant-desc">{inv.description}</p>
                      </div>

                      <div className="invariant-card-footer">
                        <span className="enforcement-tag">
                          🛡️ Соблюдение: СТРОГОЕ (Исключения запрещены)
                        </span>
                        <span className={`status-pill ${inv.isActive ? 'active' : 'disabled'}`}>
                          {inv.isActive ? '● Активен' : '○ Отключен'}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Footer buttons */}
            <div className="layer-footer-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={handleResetInvariants}
                title="Сбросить все правила к 4 демонстрационным инвариантам Дня 14"
              >
                <RotateCcw size={13} />
                <span>Сбросить к демо-инвариантам (День 14)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* INSPECT EFFECTIVE CONTEXT MODAL (PORTAL TO DOCUMENT.BODY) */}
      {isContextModalOpen &&
        createPortal(
          <div
            className="context-modal-backdrop"
            onClick={() => setIsContextModalOpen(false)}
            role="presentation"
          >
            <div
              className="context-modal-container"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inspect-context-title"
            >
              <div className="modal-header">
                <div className="modal-title-group">
                  <Eye size={18} className="modal-icon" />
                  <h3 id="inspect-context-title">Inspect Effective LLM Context</h3>
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
                    aria-label="Закрыть модальное окно"
                    title="Закрыть (Esc)"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="context-modal-body">
                <p className="context-modal-hint">
                  Ниже показано буквальное содержимое запроса, которое передаётся в языковую модель при следующем обращении. Слои скомпонованы в строгом порядке: <strong>System Prompt → Invariants Guardrail → Long-Term Memory → Working Memory → Short-Term History</strong>.
                </p>

                <div className="context-messages-display">
                  {preparedContext.map((item, idx) => {
                    let layerBadge = 'Short-Term';
                    let layerClass = 'layer-short-term';
                    if (item.content.includes('[CRITICAL MANDATE: SYSTEM INVARIANTS')) {
                      layerBadge = '🛡️ Invariants Guardrail';
                      layerClass = 'layer-invariants';
                    } else if (item.content.includes('[LONG-TERM MEMORY')) {
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
          </div>,
          document.body
        )}
    </aside>
  );
};
