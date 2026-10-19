import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Server,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Code2,
  HelpCircle,
  Power,
  RefreshCw,
  Terminal,
  Globe,
  MessageSquare,
} from 'lucide-react';
import { McpServerConfig, McpConnectionResult } from '../agent/mcp/types';
import {
  loadMcpServers,
  saveMcpServers,
  DEFAULT_MCP_SERVERS,
  loadGlobalMcpEnabled,
  saveGlobalMcpEnabled,
  loadChatMcpEnabled,
  saveChatMcpEnabled,
  loadChatMcpServers,
  saveChatMcpServers,
} from '../agent/mcp/storage';
import { testMcpConnection, callMcpTool } from '../agent/mcp/McpClient';
import { McpRouter } from '../agent/mcp/McpRouter';
import { Agent } from '../agent/Agent';
import { ErrorBoundary } from './ErrorBoundary';

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onServersChange?: (servers: McpServerConfig[]) => void;
  chatId?: string;
  chatTitle?: string;
  agent?: Agent;
}

interface TestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  result?: McpConnectionResult;
}

interface ToolExecutionState {
  isOpen: boolean;
  isLoading: boolean;
  argsRaw: string;
  result?: string;
  isError?: boolean;
}

export const McpModal: React.FC<McpModalProps> = ({
  isOpen,
  onClose,
  onServersChange,
  chatId,
  chatTitle,
  agent,
}) => {
  const [globalServers, setGlobalServers] = useState<McpServerConfig[]>(() => {
    try {
      return agent ? agent.getGlobalMcpServers() : loadMcpServers();
    } catch (e) {
      console.warn('Failed to initialize global servers:', e);
      return [];
    }
  });

  const [chatServers, setChatServers] = useState<McpServerConfig[]>(() => {
    try {
      return chatId ? (agent ? agent.getChatMcpServers() : loadChatMcpServers(chatId)) : [];
    } catch (e) {
      console.warn('Failed to initialize chat servers:', e);
      return [];
    }
  });

  const [globalEnabled, setGlobalEnabled] = useState<boolean>(() => {
    try {
      return agent ? agent.isGlobalMcpEnabled() : loadGlobalMcpEnabled();
    } catch (e) {
      return true;
    }
  });

  const [chatEnabledSetting, setChatEnabledSetting] = useState<boolean | null>(() => {
    try {
      return chatId ? (agent ? agent.getChatMcpEnabledSetting() : loadChatMcpEnabled(chatId)) : null;
    } catch (e) {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<'all' | 'global' | 'chat'>('all');
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, TestState>>(() => {
    try {
      const initialTests: Record<string, TestState> = {};
      const gServers = agent ? agent.getGlobalMcpServers() : loadMcpServers();
      const cServers = chatId ? (agent ? agent.getChatMcpServers() : loadChatMcpServers(chatId)) : [];
      for (const s of [...gServers, ...cServers]) {
        if (s.tools && Array.isArray(s.tools) && s.tools.length > 0) {
          initialTests[s.id] = {
            status: 'success',
            result: {
              success: true,
              serverName: s.name,
              tools: s.tools,
            },
          };
        }
      }
      return initialTests;
    } catch (e) {
      return {};
    }
  });
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [toolExecStates, setToolExecStates] = useState<Record<string, ToolExecutionState>>({});

  // Form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formTransport, setFormTransport] = useState<'sse' | 'http'>('sse');
  const [formHeadersRaw, setFormHeadersRaw] = useState('{}');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formScope, setFormScope] = useState<'global' | 'chat'>('global');
  const [formJsonError, setFormJsonError] = useState<string | null>(null);

  // Load servers and toggles on open
  useEffect(() => {
    if (isOpen) {
      const gServers = agent ? agent.getGlobalMcpServers() : loadMcpServers();
      const cServers = chatId
        ? agent
          ? agent.getChatMcpServers()
          : loadChatMcpServers(chatId)
        : [];
      const gEnabled = agent ? agent.isGlobalMcpEnabled() : loadGlobalMcpEnabled();
      const cSetting = chatId
        ? agent
          ? agent.getChatMcpEnabledSetting()
          : loadChatMcpEnabled(chatId)
        : null;

      setGlobalServers(gServers);
      setChatServers(cServers);
      setGlobalEnabled(gEnabled);
      setChatEnabledSetting(cSetting);

      const initialTests: Record<string, TestState> = {};
      for (const s of [...gServers, ...cServers]) {
        if (s.tools && Array.isArray(s.tools) && s.tools.length > 0) {
          initialTests[s.id] = {
            status: 'success',
            result: {
              success: true,
              serverName: s.name,
              tools: s.tools,
            },
          };
        }
      }
      setTestStates(initialTests);
    }
  }, [isOpen, chatId, agent]);

  if (!isOpen) return null;

  const persistGlobalServers = (updated: McpServerConfig[]) => {
    setGlobalServers(updated);
    if (agent) {
      agent.saveGlobalMcpServers(updated);
    } else {
      saveMcpServers(updated);
    }
    notifyParent();
  };

  const persistChatServers = (updated: McpServerConfig[]) => {
    setChatServers(updated);
    if (chatId) {
      if (agent) {
        agent.saveChatMcpServers(updated);
      } else {
        saveChatMcpServers(chatId, updated);
      }
    }
    notifyParent();
  };

  const notifyParent = () => {
    if (agent) {
      onServersChange?.(agent.getEffectiveMcpServers());
    } else {
      const g = loadMcpServers();
      const c = chatId ? loadChatMcpServers(chatId) : [];
      onServersChange?.([...g.filter((s) => s.enabled), ...c.filter((s) => s.enabled)]);
    }
  };

  const handleToggleGlobalEnabled = () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    if (agent) {
      agent.setGlobalMcpEnabled(next);
    } else {
      saveGlobalMcpEnabled(next);
    }
    notifyParent();
  };

  const handleSetChatEnabled = (val: boolean | null) => {
    setChatEnabledSetting(val);
    if (chatId) {
      if (agent) {
        agent.setChatMcpEnabled(val);
      } else {
        saveChatMcpEnabled(chatId, val);
      }
    }
    notifyParent();
  };

  const isEffectiveActiveForThisChat = agent
    ? agent.isMcpActive()
    : globalEnabled && chatEnabledSetting !== false;

  const handleStartAdd = (targetScope: 'global' | 'chat' = 'global') => {
    setEditingServer(null);
    setFormName(targetScope === 'chat' ? 'Локальный инструмент чата' : 'Локальный MCP сервер');
    setFormUrl('http://localhost:3001/sse');
    setFormTransport('sse');
    setFormHeadersRaw('{\n  "Authorization": ""\n}');
    setFormEnabled(true);
    setFormScope(targetScope);
    setFormJsonError(null);
    setIsAddingNew(true);
  };

  const handleStartEdit = (server: McpServerConfig) => {
    setIsAddingNew(false);
    setEditingServer(server);
    setFormName(server.name);
    setFormUrl(server.url);
    setFormTransport(server.transport);
    setFormHeadersRaw(
      server.headersRaw ||
        (server.headers && Object.keys(server.headers).length > 0
          ? JSON.stringify(server.headers, null, 2)
          : '{\n  "Authorization": ""\n}')
    );
    setFormEnabled(server.enabled);
    setFormScope(server.scope === 'chat' ? 'chat' : 'global');
    setFormJsonError(null);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();

    let parsedHeaders: Record<string, string> = {};
    if (formHeadersRaw.trim()) {
      try {
        const parsed = JSON.parse(formHeadersRaw);
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          setFormJsonError('Заголовки должны быть JSON объектом: {"Ключ": "Значение"}');
          return;
        }
        for (const [k, v] of Object.entries(parsed)) {
          parsedHeaders[k] = String(v);
        }
      } catch (err: any) {
        setFormJsonError(`Ошибка JSON синтаксиса: ${err.message}`);
        return;
      }
    }

    setFormJsonError(null);

    if (editingServer) {
      const origScope = editingServer.scope === 'chat' ? 'chat' : 'global';
      const newScope = formScope;

      const updatedItem: McpServerConfig = {
        ...editingServer,
        name: formName.trim() || 'MCP Server',
        url: formUrl.trim(),
        transport: formTransport,
        headers: parsedHeaders,
        headersRaw: formHeadersRaw,
        enabled: formEnabled,
        scope: newScope,
        chatId: newScope === 'chat' ? chatId : undefined,
      };

      if (origScope === newScope) {
        if (newScope === 'chat') {
          persistChatServers(chatServers.map((s) => (s.id === editingServer.id ? updatedItem : s)));
        } else {
          persistGlobalServers(globalServers.map((s) => (s.id === editingServer.id ? updatedItem : s)));
        }
      } else {
        // Scope changed: move item
        if (origScope === 'chat') {
          persistChatServers(chatServers.filter((s) => s.id !== editingServer.id));
          persistGlobalServers([...globalServers, updatedItem]);
        } else {
          persistGlobalServers(globalServers.filter((s) => s.id !== editingServer.id));
          persistChatServers([...chatServers, updatedItem]);
        }
      }
      setEditingServer(null);
    } else {
      const newServer: McpServerConfig = {
        id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: formName.trim() || 'MCP Server',
        url: formUrl.trim(),
        transport: formTransport,
        headers: parsedHeaders,
        headersRaw: formHeadersRaw,
        enabled: formEnabled,
        createdAt: Date.now(),
        scope: formScope,
        chatId: formScope === 'chat' ? chatId : undefined,
      };

      if (formScope === 'chat') {
        persistChatServers([...chatServers, newServer]);
      } else {
        persistGlobalServers([...globalServers, newServer]);
      }
      setIsAddingNew(false);
    }
  };

  const handleDeleteServer = (server: McpServerConfig) => {
    if (window.confirm(`Удалить MCP сервер "${server.name}"?`)) {
      if (server.scope === 'chat') {
        persistChatServers(chatServers.filter((s) => s.id !== server.id));
      } else {
        persistGlobalServers(globalServers.filter((s) => s.id !== server.id));
      }
      if (editingServer?.id === server.id) {
        setEditingServer(null);
      }
    }
  };

  const handleToggleEnabled = (server: McpServerConfig) => {
    if (server.scope === 'chat') {
      persistChatServers(
        chatServers.map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s))
      );
    } else {
      persistGlobalServers(
        globalServers.map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s))
      );
    }
  };

  const handleResetToDefaults = () => {
    if (window.confirm('Сбросить глобальный список серверов к настройкам по умолчанию?')) {
      persistGlobalServers(DEFAULT_MCP_SERVERS);
    }
  };

  const [isDiscoveringAll, setIsDiscoveringAll] = useState(false);

  const handleTestServer = async (server: McpServerConfig) => {
    setTestStates((prev) => ({
      ...prev,
      [server.id]: { status: 'testing' },
    }));

    try {
      const result = await testMcpConnection(server);
      setTestStates((prev) => ({
        ...prev,
        [server.id]: {
          status: result.success ? 'success' : 'error',
          result,
        },
      }));

      if (result.success && result.tools && result.tools.length > 0) {
        setExpandedTools((prev) => ({ ...prev, [server.id]: true }));

        const updatedServer: McpServerConfig = {
          ...server,
          tools: result.tools,
          lastDiscoveredAt: Date.now(),
        };

        const router = McpRouter.getInstance();
        for (const t of result.tools) {
          router.registerRoute(t.name, updatedServer, t);
        }

        if (server.scope === 'chat') {
          persistChatServers(
            chatServers.map((s) => (s.id === server.id ? updatedServer : s))
          );
        } else {
          persistGlobalServers(
            globalServers.map((s) => (s.id === server.id ? updatedServer : s))
          );
        }
      }
    } catch (err: any) {
      setTestStates((prev) => ({
        ...prev,
        [server.id]: {
          status: 'error',
          result: {
            success: false,
            serverName: server.name,
            tools: [],
            error: err?.message || String(err),
          },
        },
      }));
    }
  };

  const handleDiscoverAll = async () => {
    setIsDiscoveringAll(true);
    try {
      const active = displayedServers.filter((s) => s.enabled);
      await Promise.all(active.map((s) => handleTestServer(s)));
    } finally {
      setIsDiscoveringAll(false);
    }
  };

  const toggleToolsExpanded = (serverId: string) => {
    setExpandedTools((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

  const getSampleArgsForTool = (toolName: string): string => {
    switch (toolName) {
      case 'schedule_monitor':
        return JSON.stringify({ target: 'all', interval_seconds: 15, notes: 'Мониторинг цен и остатков' }, null, 2);
      case 'get_aggregated_summary':
        return JSON.stringify({ target: 'all' }, null, 2);
      case 'store_search_products':
        return JSON.stringify({ query: 'iPhone', category: 'smartphones', max_price: 150000 }, null, 2);
      case 'store_get_product':
        return JSON.stringify({ sku: 'PHONE-15-PRO' }, null, 2);
      case 'order_get_status':
        return JSON.stringify({ order_id: 'ORD-7741' }, null, 2);
      case 'delivery_calculate_cost':
        return JSON.stringify({ city: 'Москва', weight_kg: 2.5, express: true }, null, 2);
      case 'calculate':
        return JSON.stringify({ expression: '25 * 4 + 10' }, null, 2);
      case 'get_system_time':
        return JSON.stringify({ format: 'locale' }, null, 2);
      case 'echo':
        return JSON.stringify({ message: 'Привет от MCP агента!' }, null, 2);
      default:
        return '{}';
    }
  };

  const toggleToolExecOpen = (toolKey: string, toolName: string) => {
    setToolExecStates((prev) => {
      const current = prev[toolKey];
      if (current) {
        return {
          ...prev,
          [toolKey]: { ...current, isOpen: !current.isOpen },
        };
      }
      return {
        ...prev,
        [toolKey]: {
          isOpen: true,
          isLoading: false,
          argsRaw: getSampleArgsForTool(toolName),
        },
      };
    });
  };

  const handleUpdateToolArgs = (toolKey: string, val: string) => {
    setToolExecStates((prev) => ({
      ...prev,
      [toolKey]: {
        ...(prev[toolKey] || { isOpen: true, isLoading: false, argsRaw: '{}' }),
        argsRaw: val,
      },
    }));
  };

  const handleExecuteTool = async (server: McpServerConfig, toolName: string, toolKey: string) => {
    const current = toolExecStates[toolKey] || {
      isOpen: true,
      isLoading: false,
      argsRaw: getSampleArgsForTool(toolName),
    };

    let parsedArgs: Record<string, unknown> = {};
    if (current.argsRaw.trim()) {
      try {
        parsedArgs = JSON.parse(current.argsRaw);
      } catch (e: any) {
        setToolExecStates((prev) => ({
          ...prev,
          [toolKey]: {
            ...current,
            isError: true,
            result: `Ошибка парсинга JSON аргументов: ${e.message}`,
          },
        }));
        return;
      }
    }

    setToolExecStates((prev) => ({
      ...prev,
      [toolKey]: {
        ...current,
        isLoading: true,
        result: undefined,
        isError: undefined,
      },
    }));

    try {
      const res = await callMcpTool(server, toolName, parsedArgs);
      setToolExecStates((prev) => ({
        ...prev,
        [toolKey]: {
          ...current,
          isLoading: false,
          result: res.result || (res.isError ? res.error : 'Успешно выполнено без возврата текста.'),
          isError: res.isError,
        },
      }));
    } catch (e: any) {
      setToolExecStates((prev) => ({
        ...prev,
        [toolKey]: {
          ...current,
          isLoading: false,
          result: `Ошибка выполнения инструмента: ${e?.message || String(e)}`,
          isError: true,
        },
      }));
    }
  };

  // Determine list of servers according to active tab
  const allServers = [...globalServers, ...chatServers];
  const displayedServers =
    activeTab === 'global'
      ? globalServers
      : activeTab === 'chat'
      ? chatServers
      : allServers;

  const isFormOpen = isAddingNew || editingServer !== null;

  return (
    <div className="modal-backdrop mcp-modal-backdrop" onClick={onClose}>
      <div
        className="modal-container mcp-modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-modal-title"
      >
        <ErrorBoundary fallbackTitle="Ошибка отображения настроек MCP">
          {/* Header */}
        <div className="modal-header mcp-modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge mcp-icon-badge">
              <Server size={20} />
            </div>
            <div>
              <h2 id="mcp-modal-title" className="modal-title">
                Model Context Protocol (MCP)
              </h2>
              <p className="modal-subtitle">
                Глобальные и контекстные MCP-инструменты агента
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            <X size={18} />
          </button>
        </div>

        {/* Master Switch & Per-chat Controls */}
        <div className="mcp-modal-body">
          <div className="mcp-controls-panel">
            {/* Global Master Switch */}
            <div className="mcp-switch-row">
              <div className="mcp-switch-info">
                <div className="mcp-switch-title">
                  <Server size={16} />
                  <span>Глобальный MCP (Master Switch)</span>
                  <span className={`mcp-badge ${globalEnabled ? 'mcp-badge-sse' : 'mcp-badge-inactive'}`}>
                    {globalEnabled ? 'Включен' : 'Отключен'}
                  </span>
                </div>
                <div className="mcp-switch-desc">
                  {globalEnabled
                    ? 'MCP активен во всем приложении. Серверы и инструменты подключаются в диалогах.'
                    : 'MCP отключен глобально. Никакие внешние инструменты не подключаются ни в одном диалоге.'}
                </div>
              </div>
              <div className="mcp-switch-actions">
                <button
                  type="button"
                  className={`mcp-toggle-btn ${globalEnabled ? 'active' : 'inactive'}`}
                  onClick={handleToggleGlobalEnabled}
                >
                  <Power size={14} />
                  <span>{globalEnabled ? 'Включено' : 'Выключено'}</span>
                </button>
              </div>
            </div>

            {/* Per-Chat Switch (if chatId is available) */}
            {chatId && (
              <div
                className="mcp-switch-row"
                style={{
                  borderTop: '1px solid var(--border-color, rgba(255,255,255,0.06))',
                  paddingTop: 10,
                }}
              >
                <div className="mcp-switch-info">
                  <div className="mcp-switch-title">
                    <MessageSquare size={15} />
                    <span>Для чата «{chatTitle || 'Текущий диалог'}»</span>
                    <span
                      className={`mcp-badge ${
                        isEffectiveActiveForThisChat ? 'mcp-badge-sse' : 'mcp-badge-inactive'
                      }`}
                    >
                      {isEffectiveActiveForThisChat ? 'Активен в чате' : 'Отключен в чате'}
                    </span>
                  </div>
                  <div className="mcp-switch-desc">
                    Индивидуальная настройка MCP для текущего чата
                  </div>
                </div>
                <div className="mcp-switch-actions">
                  <div className="mcp-segmented-control">
                    <button
                      type="button"
                      className={`mcp-segmented-btn ${chatEnabledSetting === null ? 'active' : ''}`}
                      onClick={() => handleSetChatEnabled(null)}
                      title="Использовать статус глобального переключателя"
                    >
                      Как глобально
                    </button>
                    <button
                      type="button"
                      className={`mcp-segmented-btn ${chatEnabledSetting === true ? 'active' : ''}`}
                      onClick={() => handleSetChatEnabled(true)}
                      title="Принудительно включить для этого чата"
                    >
                      Вкл
                    </button>
                    <button
                      type="button"
                      className={`mcp-segmented-btn ${chatEnabledSetting === false ? 'active' : ''}`}
                      onClick={() => handleSetChatEnabled(false)}
                      title="Принудительно отключить только для этого чата"
                    >
                      Выкл
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Local server reminder / helper box */}
          <div className="mcp-local-hint">
            <div className="mcp-local-hint-icon">
              <HelpCircle size={16} />
            </div>
            <div className="mcp-local-hint-content">
              <strong>Тестирование серверов:</strong>
              <span>
                {' '}
                Запустите в терминале <code>npm run mcp:servers</code> для поднятия экосистемы 3 серверов (каталог: 3001, логистика: 3002, аналитика: 3003).
              </span>
            </div>
          </div>

          {/* Scope Tabs */}
          <div className="mcp-tabs">
            <button
              type="button"
              className={`mcp-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <span>Все серверы ({allServers.length})</span>
            </button>
            <button
              type="button"
              className={`mcp-tab-btn ${activeTab === 'global' ? 'active' : ''}`}
              onClick={() => setActiveTab('global')}
            >
              <Globe size={13} />
              <span>Глобальные ({globalServers.length})</span>
            </button>
            {chatId && (
              <button
                type="button"
                className={`mcp-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                <MessageSquare size={13} />
                <span>Серверы этого чата ({chatServers.length})</span>
              </button>
            )}
          </div>

          {/* Action bar */}
          <div className="mcp-action-bar">
            {!isFormOpen && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary mcp-add-btn"
                  onClick={() => handleStartAdd(activeTab === 'chat' ? 'chat' : 'global')}
                >
                  <Plus size={16} />
                  <span>
                    {activeTab === 'chat' ? 'Добавить сервер в этот чат' : 'Добавить MCP-сервер'}
                  </span>
                </button>
                {chatId && activeTab !== 'chat' && (
                  <button
                    type="button"
                    className="btn btn-secondary mcp-add-btn"
                    onClick={() => handleStartAdd('chat')}
                    title="Добавить сервер, доступный только в этом чате"
                  >
                    <MessageSquare size={15} />
                    <span>Добавить в этот чат</span>
                  </button>
                )}
              </div>
            )}

            <div className="mcp-status-summary">
              <span className="mcp-summary-item">
                Всего серверов: <strong>{allServers.length}</strong>
              </span>
              <span className="mcp-summary-item">
                Активных:{' '}
                <strong className="text-success">
                  {displayedServers.filter((s) => s.enabled).length}
                </strong>
              </span>
            </div>

            {!isFormOpen && displayedServers.some((s) => s.enabled) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDiscoverAll}
                disabled={isDiscoveringAll}
                title="Опросить активные серверы и актуализировать список доступных инструментов"
              >
                {isDiscoveringAll ? (
                  <>
                    <Loader2 size={13} className="spin-animation" />
                    <span>Синхронизация...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    <span>Опросить инструменты</span>
                  </>
                )}
              </button>
            )}

            {globalServers.length === 0 && !isFormOpen && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetToDefaults}
                title="Восстановить тестовые глобальные серверы"
              >
                <RefreshCw size={14} />
                <span>Сбросить к умолчанию</span>
              </button>
            )}
          </div>

          {/* Form for Add / Edit */}
          {isFormOpen && (
            <form className="mcp-form-card" onSubmit={handleSaveForm}>
              <div className="mcp-form-header">
                <h3>
                  {editingServer
                    ? 'Редактировать MCP-сервер'
                    : formScope === 'chat'
                    ? 'Новый MCP-сервер для этого чата'
                    : 'Новое глобальное подключение к MCP'}
                </h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingServer(null);
                    setFormJsonError(null);
                  }}
                >
                  <X size={15} />
                </button>
              </div>

              {/* Scope Selection */}
              {chatId && (
                <div className="form-group">
                  <label className="form-label">Область действия сервера (Scope)</label>
                  <div className="mcp-scope-selector-group">
                    <div
                      className={`mcp-scope-option ${formScope === 'global' ? 'selected' : ''}`}
                      onClick={() => setFormScope('global')}
                    >
                      <Globe size={16} />
                      <div>
                        <div style={{ fontWeight: 500 }}>Глобальный сервер</div>
                        <div style={{ fontSize: '11px', opacity: 0.8 }}>Доступен во всех чатах</div>
                      </div>
                    </div>
                    <div
                      className={`mcp-scope-option ${formScope === 'chat' ? 'selected' : ''}`}
                      onClick={() => setFormScope('chat')}
                    >
                      <MessageSquare size={16} />
                      <div>
                        <div style={{ fontWeight: 500 }}>Только для этого чата</div>
                        <div style={{ fontSize: '11px', opacity: 0.8 }}>
                          «{chatTitle || 'Текущий диалог'}»
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="mcp-name">
                  Название сервера
                </label>
                <input
                  id="mcp-name"
                  type="text"
                  className="form-input"
                  placeholder="Например: Локальный MCP или Погодный сервис"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label className="form-label" htmlFor="mcp-url">
                    URL конечной точки
                  </label>
                  <input
                    id="mcp-url"
                    type="url"
                    className="form-input code-font"
                    placeholder="http://localhost:3001/sse"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group flex-1">
                  <label className="form-label" htmlFor="mcp-transport">
                    Транспорт
                  </label>
                  <select
                    id="mcp-transport"
                    className="form-select"
                    value={formTransport}
                    onChange={(e) => setFormTransport(e.target.value as 'sse' | 'http')}
                  >
                    <option value="sse">SSE (Server-Sent Events)</option>
                    <option value="http">Streamable HTTP (POST)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label className="form-label" htmlFor="mcp-headers">
                    HTTP Заголовки (JSON)
                  </label>
                  <span className="form-hint">Авторизация, Bearer-токены, ключи API</span>
                </div>
                <textarea
                  id="mcp-headers"
                  className="form-textarea code-font"
                  rows={3}
                  value={formHeadersRaw}
                  onChange={(e) => {
                    setFormHeadersRaw(e.target.value);
                    setFormJsonError(null);
                  }}
                  placeholder={'{\n  "Authorization": "Bearer secret_token"\n}'}
                />
                {formJsonError && (
                  <div className="form-error-banner">
                    <AlertCircle size={14} />
                    <span>{formJsonError}</span>
                  </div>
                )}
              </div>

              <div className="form-checkbox-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formEnabled}
                    onChange={(e) => setFormEnabled(e.target.checked)}
                  />
                  <span>Включить сервер сразу после сохранения</span>
                </label>
              </div>

              <div className="mcp-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingServer(null);
                    setFormJsonError(null);
                  }}
                >
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingServer ? 'Сохранить изменения' : 'Добавить сервер'}
                </button>
              </div>
            </form>
          )}

          {/* Server List */}
          <div className="mcp-server-list">
            {displayedServers.length === 0 && !isFormOpen && (
              <div className="mcp-empty-state">
                <Server size={36} className="mcp-empty-icon" />
                <p>
                  {activeTab === 'chat'
                    ? 'У этого чата пока нет собственных MCP-серверов.'
                    : 'Нет доступных MCP серверов в выбранной категории.'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleStartAdd(activeTab === 'chat' ? 'chat' : 'global')}
                >
                  <Plus size={14} />
                  <span>
                    {activeTab === 'chat'
                      ? 'Добавить сервер в этот чат'
                      : 'Добавить первый сервер'}
                  </span>
                </button>
              </div>
            )}

            {displayedServers.map((server) => {
              const testState = testStates[server.id] || { status: 'idle' };
              const isToolsExpanded = Boolean(expandedTools[server.id]);
              const tools = Array.isArray(testState.result?.tools)
                ? testState.result.tools
                : Array.isArray(server.tools)
                ? server.tools
                : [];
              const isChatScoped = server.scope === 'chat';
              const serverTransport = server.transport || 'sse';

              return (
                <div
                  key={server.id}
                  className={`mcp-server-card ${!server.enabled ? 'disabled-server' : ''} ${
                    testState.status === 'success' ? 'status-success-border' : ''
                  } ${testState.status === 'error' ? 'status-error-border' : ''}`}
                >
                  {/* Card Main Info */}
                  <div className="mcp-card-main">
                    <div className="mcp-card-left">
                      <button
                        type="button"
                        className={`mcp-power-btn ${server.enabled ? 'active' : ''}`}
                        onClick={() => handleToggleEnabled(server)}
                        title={server.enabled ? 'Отключить сервер' : 'Включить сервер'}
                      >
                        <Power size={14} />
                      </button>

                      <div className="mcp-server-details">
                        <div className="mcp-server-title-row">
                          <span className="mcp-server-name">{server.name || 'MCP Server'}</span>
                          <span
                            className={`mcp-badge ${
                              isChatScoped ? 'mcp-badge-chat' : 'mcp-badge-global'
                            }`}
                            title={
                              isChatScoped
                                ? `Привязан к чату "${chatTitle || server.chatId || ''}"`
                                : 'Доступен во всех чатах'
                            }
                          >
                            {isChatScoped ? '💬 Этот чат' : '🌐 Глобальный'}
                          </span>
                          <span className={`mcp-badge mcp-badge-${serverTransport}`}>
                            {serverTransport.toUpperCase()}
                          </span>
                          {!server.enabled && (
                            <span className="mcp-badge mcp-badge-inactive">Выключен</span>
                          )}
                        </div>

                        <div className="mcp-server-url" title={server.url}>
                          <code>{server.url || ''}</code>
                        </div>

                        {server.headers &&
                          typeof server.headers === 'object' &&
                          !Array.isArray(server.headers) &&
                          Object.keys(server.headers).length > 0 && (
                            <div className="mcp-headers-count">
                              <span>
                                Заголовков: {Object.keys(server.headers).length} (
                                {Object.keys(server.headers).join(', ')})
                              </span>
                            </div>
                          )}
                      </div>
                    </div>

                    <div className="mcp-card-right">
                      {/* Test Connection Button */}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm mcp-test-btn"
                        onClick={() => handleTestServer(server)}
                        disabled={testState.status === 'testing'}
                        title="Проверить доступность и запросить список инструментов"
                      >
                        {testState.status === 'testing' ? (
                          <>
                            <Loader2 size={13} className="spin-animation" />
                            <span>Тест...</span>
                          </>
                        ) : (
                          <>
                            <Play size={13} />
                            <span>Тест</span>
                          </>
                        )}
                      </button>

                      {/* Edit Button */}
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleStartEdit(server)}
                        title="Редактировать конфигурацию"
                      >
                        <Edit2 size={15} />
                      </button>

                      {/* Delete Button */}
                      <button
                        type="button"
                        className="btn-icon btn-icon-danger"
                        onClick={() => handleDeleteServer(server)}
                        title="Удалить сервер"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Test Feedback Area */}
                  {testState.status !== 'idle' && testState.result && (
                    <div
                      className={`mcp-test-feedback ${
                        testState.status === 'success' ? 'success' : 'error'
                      }`}
                    >
                      <div className="mcp-feedback-header">
                        {testState.status === 'success' ? (
                          <>
                            <CheckCircle2 size={16} className="text-success" />
                            <span className="mcp-feedback-title">
                              Сервер доступен. Найдено инструментов: {tools.length}
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={16} className="text-danger" />
                            <span className="mcp-feedback-title">Ошибка подключения</span>
                          </>
                        )}

                        {testState.result.latencyMs !== undefined && (
                          <span className="mcp-latency">
                            {testState.result.latencyMs} мс
                          </span>
                        )}
                      </div>

                      {testState.status === 'error' && testState.result.error && (
                        <p className="mcp-feedback-error-text">
                          {testState.result.error}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Discovered Tools List (Collapsible) */}
                  {tools.length > 0 && (
                    <div className="mcp-tools-collapsible">
                      <button
                        type="button"
                        className="mcp-tools-toggle-btn"
                        onClick={() => toggleToolsExpanded(server.id)}
                      >
                        {isToolsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span>
                          {isToolsExpanded ? 'Скрыть инструменты' : 'Показать инструменты'} ({tools.length})
                        </span>
                      </button>

                      {isToolsExpanded && (
                        <div className="mcp-tools-list">
                          {tools.map((tool) => {
                            if (!tool || typeof tool !== 'object') return null;
                            const toolName = typeof tool.name === 'string' ? tool.name : 'unknown_tool';
                            const toolKey = `${server.id}_${toolName}`;
                            const execState = toolExecStates[toolKey] || {
                              isOpen: false,
                              isLoading: false,
                              argsRaw: getSampleArgsForTool(toolName),
                            };

                            const inputSchema =
                              tool.inputSchema &&
                              typeof tool.inputSchema === 'object' &&
                              !Array.isArray(tool.inputSchema)
                                ? tool.inputSchema
                                : null;
                            const properties =
                              inputSchema?.properties &&
                              typeof inputSchema.properties === 'object' &&
                              !Array.isArray(inputSchema.properties)
                                ? inputSchema.properties
                                : null;
                            const hasParams = properties !== null && Object.keys(properties).length > 0;
                            const requiredParams = Array.isArray(inputSchema?.required)
                              ? inputSchema.required
                              : [];
                            const toolDesc =
                              typeof tool.description === 'string'
                                ? tool.description
                                : tool.description
                                ? JSON.stringify(tool.description)
                                : null;

                            return (
                              <div key={toolName} className="mcp-tool-item">
                                <div className="mcp-tool-header">
                                  <div className="mcp-tool-title-row">
                                    <Code2 size={14} className="mcp-tool-icon" />
                                    <code className="mcp-tool-name">{toolName}</code>
                                  </div>

                                  {/* Interactive Run Tool Button */}
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${
                                      execState.isOpen ? 'btn-primary' : 'btn-secondary'
                                    }`}
                                    onClick={() => toggleToolExecOpen(toolKey, toolName)}
                                    title="Выполнить инструмент с параметрами в реальном времени"
                                  >
                                    <Terminal size={12} />
                                    <span>{execState.isOpen ? 'Скрыть запуск' : 'Запустить'}</span>
                                  </button>
                                </div>

                                {toolDesc && <p className="mcp-tool-desc">{toolDesc}</p>}

                                {hasParams && properties && (
                                  <div className="mcp-tool-params">
                                    <span className="mcp-params-label">Параметры:</span>
                                    {Object.entries(properties).map(
                                      ([pName, pSchema]: [string, any]) => {
                                        const isReq = requiredParams.includes(pName);
                                        const paramType =
                                          pSchema && typeof pSchema === 'object' && pSchema.type
                                            ? String(pSchema.type)
                                            : '';
                                        const paramDesc =
                                          pSchema &&
                                          typeof pSchema === 'object' &&
                                          typeof pSchema.description === 'string'
                                            ? pSchema.description
                                            : '';
                                        return (
                                          <span
                                            key={pName}
                                            className={`mcp-param-tag ${isReq ? 'required' : ''}`}
                                            title={paramDesc}
                                          >
                                            {pName}
                                            {paramType && ` (${paramType})`}
                                            {isReq && <span className="required-star">*</span>}
                                          </span>
                                        );
                                      }
                                    )}
                                  </div>
                                )}

                                {/* Interactive Run Card */}
                                {execState.isOpen && (
                                  <div className="mcp-tool-exec-box">
                                    <div className="mcp-tool-exec-header">
                                      <span>JSON Аргументы для вызова:</span>
                                    </div>
                                    <textarea
                                      className="form-textarea code-font"
                                      rows={2}
                                      value={execState.argsRaw}
                                      onChange={(e) =>
                                        handleUpdateToolArgs(toolKey, e.target.value)
                                      }
                                      placeholder="{}"
                                    />

                                    <div className="mcp-tool-exec-actions">
                                      <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() =>
                                          handleExecuteTool(server, tool.name, toolKey)
                                        }
                                        disabled={execState.isLoading}
                                      >
                                        {execState.isLoading ? (
                                          <>
                                            <Loader2 size={13} className="spin-animation" />
                                            <span>Выполняется...</span>
                                          </>
                                        ) : (
                                          <>
                                            <Play size={13} />
                                            <span>Выполнить вызов</span>
                                          </>
                                        )}
                                      </button>
                                    </div>

                                    {/* Tool Call Output Result */}
                                    {execState.result !== undefined && (
                                      <div
                                        className={`mcp-tool-result ${
                                          execState.isError ? 'error' : 'success'
                                        }`}
                                      >
                                        <div className="mcp-tool-result-header">
                                          <span>
                                            {execState.isError
                                              ? 'Ошибка выполнения:'
                                              : 'Результат вызова инструмента:'}
                                          </span>
                                        </div>
                                        <pre className="mcp-tool-result-body">
                                          {execState.result}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer mcp-modal-footer">
          <div className="mcp-footer-note">
            <span>
              Глобальные и контекстные серверы оркестрируются через <code>McpRouter</code>.
            </span>
          </div>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};
