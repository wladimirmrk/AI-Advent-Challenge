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
} from 'lucide-react';
import { McpServerConfig, McpConnectionResult } from '../agent/mcp/types';
import { loadMcpServers, saveMcpServers, DEFAULT_MCP_SERVERS } from '../agent/mcp/storage';
import { testMcpConnection } from '../agent/mcp/McpClient';

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onServersChange?: (servers: McpServerConfig[]) => void;
}

interface TestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  result?: McpConnectionResult;
}

export const McpModal: React.FC<McpModalProps> = ({ isOpen, onClose, onServersChange }) => {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  // Form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formTransport, setFormTransport] = useState<'sse' | 'http'>('sse');
  const [formHeadersRaw, setFormHeadersRaw] = useState('{}');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formJsonError, setFormJsonError] = useState<string | null>(null);

  // Load servers on open
  useEffect(() => {
    if (isOpen) {
      const loaded = loadMcpServers();
      setServers(loaded);
      onServersChange?.(loaded);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const persistServers = (updated: McpServerConfig[]) => {
    setServers(updated);
    saveMcpServers(updated);
    onServersChange?.(updated);
  };

  const handleStartAdd = () => {
    setEditingServer(null);
    setFormName('Локальный MCP сервер');
    setFormUrl('http://localhost:3001/sse');
    setFormTransport('sse');
    setFormHeadersRaw('{\n  "Authorization": ""\n}');
    setFormEnabled(true);
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
      const updated = servers.map((s) =>
        s.id === editingServer.id
          ? {
              ...s,
              name: formName.trim() || 'MCP Server',
              url: formUrl.trim(),
              transport: formTransport,
              headers: parsedHeaders,
              headersRaw: formHeadersRaw,
              enabled: formEnabled,
            }
          : s
      );
      persistServers(updated);
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
      };
      persistServers([...servers, newServer]);
      setIsAddingNew(false);
    }
  };

  const handleDeleteServer = (id: string) => {
    if (window.confirm('Удалить данный MCP сервер?')) {
      const updated = servers.filter((s) => s.id !== id);
      persistServers(updated);
      if (editingServer?.id === id) {
        setEditingServer(null);
      }
    }
  };

  const handleToggleEnabled = (id: string) => {
    const updated = servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    persistServers(updated);
  };

  const handleResetToDefaults = () => {
    if (window.confirm('Сбросить список серверов к настройкам по умолчанию?')) {
      persistServers(DEFAULT_MCP_SERVERS);
    }
  };

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
      if (result.success && result.tools.length > 0) {
        setExpandedTools((prev) => ({ ...prev, [server.id]: true }));
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

  const toggleToolsExpanded = (serverId: string) => {
    setExpandedTools((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

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
                Подключение серверов инструментов через протокол MCP (День 16)
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

        {/* Local server reminder / helper box */}
        <div className="mcp-local-hint">
          <div className="mcp-local-hint-icon">
            <HelpCircle size={16} />
          </div>
          <div className="mcp-local-hint-content">
            <strong>Локальный сервер для тестирования:</strong>
            <span>
              {' '}
              Запустите в терминале <code>npm run mcp:server</code> для поднятия SSE-сервера на порту 3001 с инструментами{' '}
              <code>calculate</code>, <code>get_system_time</code> и <code>echo</code>.
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body mcp-modal-body">
          {/* Action bar */}
          <div className="mcp-action-bar">
            {!isFormOpen && (
              <button
                type="button"
                className="btn btn-primary mcp-add-btn"
                onClick={handleStartAdd}
              >
                <Plus size={16} />
                <span>Добавить MCP-сервер</span>
              </button>
            )}

            <div className="mcp-status-summary">
              <span className="mcp-summary-item">
                Серверов: <strong>{servers.length}</strong>
              </span>
              <span className="mcp-summary-item">
                Активных:{' '}
                <strong className="text-success">
                  {servers.filter((s) => s.enabled).length}
                </strong>
              </span>
            </div>

            {servers.length === 0 && !isFormOpen && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetToDefaults}
                title="Восстановить тестовый локальный сервер"
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
                <h3>{editingServer ? 'Редактировать MCP-сервер' : 'Новое подключение к MCP'}</h3>
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
                <div className="form-group flex-1">
                  <label className="form-label" htmlFor="mcp-url">
                    URL эндпоинта
                  </label>
                  <input
                    id="mcp-url"
                    type="url"
                    className="form-input"
                    placeholder="http://localhost:3001/sse"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ width: '220px' }}>
                  <label className="form-label" htmlFor="mcp-transport">
                    Способ подключения
                  </label>
                  <select
                    id="mcp-transport"
                    className="form-select"
                    value={formTransport}
                    onChange={(e) => setFormTransport(e.target.value as 'sse' | 'http')}
                  >
                    <option value="sse">SSE (Server-Sent Events)</option>
                    <option value="http">Streamable HTTP</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label className="form-label" htmlFor="mcp-headers">
                    HTTP Заголовки (JSON)
                  </label>
                  <span className="form-hint">Формат: {`{"Header-Name": "value"}`}</span>
                </div>
                <textarea
                  id="mcp-headers"
                  className={`form-textarea code-font ${formJsonError ? 'input-error' : ''}`}
                  rows={4}
                  placeholder={`{\n  "Authorization": "Bearer YOUR_TOKEN",\n  "X-Custom-Header": "value"\n}`}
                  value={formHeadersRaw}
                  onChange={(e) => {
                    setFormHeadersRaw(e.target.value);
                    if (formJsonError) setFormJsonError(null);
                  }}
                />
                {formJsonError && (
                  <div className="form-error-message">
                    <AlertCircle size={14} />
                    <span>{formJsonError}</span>
                  </div>
                )}
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formEnabled}
                    onChange={(e) => setFormEnabled(e.target.checked)}
                  />
                  <span>Включить сервер (активен)</span>
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
            {servers.length === 0 && !isFormOpen && (
              <div className="mcp-empty-state">
                <Server size={36} className="mcp-empty-icon" />
                <p>Нет добавленных MCP серверов.</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleStartAdd}
                >
                  <Plus size={14} /> Добавить первый сервер
                </button>
              </div>
            )}

            {servers.map((server) => {
              const testState = testStates[server.id] || { status: 'idle' };
              const isToolsExpanded = Boolean(expandedTools[server.id]);
              const tools = testState.result?.tools || [];

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
                        onClick={() => handleToggleEnabled(server.id)}
                        title={server.enabled ? 'Отключить сервер' : 'Включить сервер'}
                      >
                        <Power size={14} />
                      </button>

                      <div className="mcp-server-details">
                        <div className="mcp-server-title-row">
                          <span className="mcp-server-name">{server.name}</span>
                          <span className={`mcp-badge mcp-badge-${server.transport}`}>
                            {server.transport.toUpperCase()}
                          </span>
                          {!server.enabled && (
                            <span className="mcp-badge mcp-badge-inactive">Выключен</span>
                          )}
                        </div>

                        <div className="mcp-server-url" title={server.url}>
                          <code>{server.url}</code>
                        </div>

                        {server.headers && Object.keys(server.headers).length > 0 && (
                          <div className="mcp-headers-count">
                            <span>Заголовков: {Object.keys(server.headers).length}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions and Status */}
                    <div className="mcp-card-right">
                      {/* Connection Test Button */}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm mcp-test-btn"
                        onClick={() => handleTestServer(server)}
                        disabled={testState.status === 'testing'}
                        title="Установить MCP-соединение и запросить инструменты"
                      >
                        {testState.status === 'testing' ? (
                          <>
                            <Loader2 size={14} className="spin-icon" />
                            <span>Проверка...</span>
                          </>
                        ) : (
                          <>
                            <Play size={13} />
                            <span>Проверить</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => handleStartEdit(server)}
                        title="Редактировать"
                      >
                        <Edit2 size={14} />
                      </button>

                      <button
                        type="button"
                        className="icon-action-btn text-danger"
                        onClick={() => handleDeleteServer(server.id)}
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Test Result Feedback */}
                  {testState.status === 'success' && testState.result && (
                    <div className="mcp-test-feedback success">
                      <div className="mcp-feedback-header">
                        <div className="mcp-feedback-title">
                          <CheckCircle2 size={16} className="text-success" />
                          <span>
                            Соединение установлено! Найдено инструментов: <strong>{tools.length}</strong>
                          </span>
                        </div>
                        {testState.result.latencyMs !== undefined && (
                          <span className="mcp-latency">
                            {testState.result.latencyMs}ms
                          </span>
                        )}
                      </div>

                      {tools.length > 0 && (
                        <div className="mcp-tools-collapsible">
                          <button
                            type="button"
                            className="mcp-tools-toggle-btn"
                            onClick={() => toggleToolsExpanded(server.id)}
                          >
                            {isToolsExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                            <span>Список инструментов ({tools.length})</span>
                          </button>

                          {isToolsExpanded && (
                            <div className="mcp-tools-list">
                              {tools.map((tool) => (
                                <div key={tool.name} className="mcp-tool-item">
                                  <div className="mcp-tool-header">
                                    <Code2 size={14} className="mcp-tool-icon" />
                                    <span className="mcp-tool-name">{tool.name}</span>
                                  </div>
                                  {tool.description && (
                                    <p className="mcp-tool-desc">{tool.description}</p>
                                  )}
                                  {tool.inputSchema?.properties && (
                                    <div className="mcp-tool-params">
                                      <span className="mcp-params-label">Параметры:</span>
                                      {Object.entries(tool.inputSchema.properties).map(
                                        ([pName, pVal]: [string, any]) => (
                                          <span key={pName} className="mcp-param-tag">
                                            {pName}
                                            {tool.inputSchema?.required?.includes(pName) && (
                                              <span className="required-star">*</span>
                                            )}
                                            {pVal?.type ? `: ${pVal.type}` : ''}
                                          </span>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {testState.status === 'error' && testState.result && (
                    <div className="mcp-test-feedback error">
                      <div className="mcp-feedback-header">
                        <div className="mcp-feedback-title">
                          <AlertCircle size={16} className="text-danger" />
                          <span>Ошибка подключения к MCP-серверу</span>
                        </div>
                      </div>
                      <p className="mcp-feedback-error-text">{testState.result.error}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer mcp-modal-footer">
          <div className="mcp-footer-note">
            <span>Протокол MCP: стандарт расширения возможностей ИИ-агентов внешними инструментами.</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
