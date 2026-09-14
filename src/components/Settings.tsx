import React, { useState } from 'react';
import { AgentConfig, AgentMode, CustomModel, ModelProvider } from '../agent/types';
import { MODEL_CONTEXT_LIMITS, fetchModelInfo } from '../agent/tokenizer';
import { clearApiKey } from '../agent/storage';
import {
  checkOllamaConnection,
  fetchOllamaModels,
  fetchOllamaModelInfo,
} from '../agent/ollama';
import {
  X,
  Key,
  Cpu,
  Layers,
  ShieldAlert,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Sliders,
  Sparkles,
  Plus,
  Loader2,
  AlertCircle,
  Server,
  RefreshCw,
  Globe,
  HardDrive,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: AgentConfig;
  customModels: CustomModel[];
  onSave: (newConfig: AgentConfig) => void;
  onAddCustomModel: (model: CustomModel) => void;
  onRemoveCustomModel: (modelId: string) => void;
}

export const OPENROUTER_PRESETS = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)', defaultLimit: 128000 },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (Google)', defaultLimit: 1048576 },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (Meta)', defaultLimit: 131072 },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (Anthropic)', defaultLimit: 200000 },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (DeepSeek)', defaultLimit: 64000 },
];

export const OLLAMA_PRESETS = [
  { id: 'llama3.2:latest', label: 'Llama 3.2 (Meta)', defaultLimit: 131072 },
  { id: 'llama3.1:8b', label: 'Llama 3.1 8B (Meta)', defaultLimit: 131072 },
  { id: 'mistral:latest', label: 'Mistral 7B (Mistral AI)', defaultLimit: 32768 },
  { id: 'qwen2.5:latest', label: 'Qwen 2.5 (Alibaba)', defaultLimit: 32768 },
  { id: 'phi3:latest', label: 'Phi 3 Mini (Microsoft)', defaultLimit: 128000 },
];

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  config,
  customModels,
  onSave,
  onAddCustomModel,
  onRemoveCustomModel,
}) => {
  const [provider, setProvider] = useState<ModelProvider>(config.provider || 'openrouter');
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [ollamaUrl, setOllamaUrl] = useState(config.ollamaUrl || 'http://localhost:11434');
  const [model, setModel] = useState(config.model);
  const [contextWindow, setContextWindow] = useState<string>(
    config.contextWindow !== null ? String(config.contextWindow) : ''
  );
  const [mode, setMode] = useState<AgentMode>(config.mode);
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt);
  const [showKey, setShowKey] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // OpenRouter custom model addition state
  const [newModelInput, setNewModelInput] = useState('');
  const [isFetchingModel, setIsFetchingModel] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualContextInput, setManualContextInput] = useState('128000');
  const [fetchSuccessMsg, setFetchSuccessMsg] = useState<string | null>(null);

  // Ollama custom model addition and status state
  const [newOllamaModelInput, setNewOllamaModelInput] = useState('');
  const [isFetchingOllamaModel, setIsFetchingOllamaModel] = useState(false);
  const [ollamaFetchError, setOllamaFetchError] = useState<string | null>(null);
  const [ollamaFetchSuccessMsg, setOllamaFetchSuccessMsg] = useState<string | null>(null);

  const [ollamaStatus, setOllamaStatus] = useState<{
    checked: boolean;
    ok: boolean;
    version?: string;
    error?: string;
  }>({ checked: false, ok: false });
  const [isCheckingOllama, setIsCheckingOllama] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filter models by provider
  const openrouterCustomModels = customModels.filter(
    (m) => !m.provider || m.provider === 'openrouter'
  );
  const ollamaCustomModels = customModels.filter((m) => m.provider === 'ollama');

  const handleSelectOpenRouterPreset = (preset: (typeof OPENROUTER_PRESETS)[0]) => {
    setModel(preset.id);
    setProvider('openrouter');
    const limit = MODEL_CONTEXT_LIMITS[preset.id] ?? preset.defaultLimit;
    setContextWindow(String(limit));
  };

  const handleSelectOllamaPreset = (preset: (typeof OLLAMA_PRESETS)[0]) => {
    setModel(preset.id);
    setProvider('ollama');
    setContextWindow(String(preset.defaultLimit));
  };

  const handleCheckOllamaConnection = async () => {
    setIsCheckingOllama(true);
    setOllamaStatus({ checked: false, ok: false });
    const res = await checkOllamaConnection(ollamaUrl);
    setIsCheckingOllama(false);
    setOllamaStatus({
      checked: true,
      ok: res.ok,
      version: res.version,
      error: res.error,
    });
  };

  const handleRefreshOllamaModels = async () => {
    setIsRefreshingModels(true);
    setRefreshMessage(null);
    setOllamaFetchError(null);

    try {
      const conn = await checkOllamaConnection(ollamaUrl);
      setOllamaStatus({
        checked: true,
        ok: conn.ok,
        version: conn.version,
        error: conn.error,
      });

      if (!conn.ok) {
        setRefreshMessage(`Could not connect to Ollama at ${ollamaUrl}`);
        setIsRefreshingModels(false);
        return;
      }

      const models = await fetchOllamaModels(ollamaUrl);
      if (models.length === 0) {
        setRefreshMessage('Connected to Ollama, but no installed models were found (pull models via "ollama run <name>")');
      } else {
        // Resolve context for each model
        for (const m of models) {
          const info = await fetchOllamaModelInfo(ollamaUrl, m.id);
          onAddCustomModel({
            id: m.id,
            name: m.id,
            contextLength: info.contextLength,
            provider: 'ollama',
          });
        }
        setRefreshMessage(`Successfully loaded ${models.length} model(s) from Ollama`);
      }
    } catch (err) {
      setRefreshMessage('Failed to fetch models from Ollama.');
    } finally {
      setIsRefreshingModels(false);
      setTimeout(() => setRefreshMessage(null), 5000);
    }
  };

  const handleAddOpenRouterModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newModelInput.trim();
    if (!trimmed || isFetchingModel) return;

    setIsFetchingModel(true);
    setFetchError(null);
    setFetchSuccessMsg(null);

    const info = await fetchModelInfo(trimmed, apiKey);
    setIsFetchingModel(false);

    if (info) {
      const newModel: CustomModel = {
        id: trimmed,
        name: info.name,
        contextLength: info.contextLength,
        provider: 'openrouter',
      };
      onAddCustomModel(newModel);
      setModel(trimmed);
      setProvider('openrouter');
      if (info.contextLength !== null) {
        setContextWindow(String(info.contextLength));
      }
      setNewModelInput('');
      const limitText = info.contextLength ? `${info.contextLength.toLocaleString()} tokens` : 'unknown limit';
      setFetchSuccessMsg(`Added: ${info.name || trimmed} (${limitText})`);
      setTimeout(() => setFetchSuccessMsg(null), 4000);
    } else {
      setFetchError(`Could not find "${trimmed}" on OpenRouter. Specify context window manually:`);
      setManualContextInput(contextWindow || '128000');
    }
  };

  const handleConfirmManualOpenRouterAdd = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed) return;
    const parsed = manualContextInput.trim() ? parseInt(manualContextInput.trim(), 10) : null;
    const newModel: CustomModel = {
      id: trimmed,
      contextLength: isNaN(parsed as number) ? null : parsed,
      provider: 'openrouter',
    };
    onAddCustomModel(newModel);
    setModel(trimmed);
    setProvider('openrouter');
    if (newModel.contextLength !== null) {
      setContextWindow(String(newModel.contextLength));
    }
    setNewModelInput('');
    setFetchError(null);
  };

  const handleAddOllamaModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newOllamaModelInput.trim();
    if (!trimmed || isFetchingOllamaModel) return;

    setIsFetchingOllamaModel(true);
    setOllamaFetchError(null);
    setOllamaFetchSuccessMsg(null);

    const info = await fetchOllamaModelInfo(ollamaUrl, trimmed);
    setIsFetchingOllamaModel(false);

    const newModel: CustomModel = {
      id: trimmed,
      name: trimmed,
      contextLength: info.contextLength,
      provider: 'ollama',
    };

    onAddCustomModel(newModel);
    setModel(trimmed);
    setProvider('ollama');
    if (info.contextLength !== null) {
      setContextWindow(String(info.contextLength));
    }
    setNewOllamaModelInput('');
    const limitText = info.contextLength ? `${info.contextLength.toLocaleString()} tokens` : 'default limit';
    setOllamaFetchSuccessMsg(`Added Ollama model: ${trimmed} (${limitText})`);
    setTimeout(() => setOllamaFetchSuccessMsg(null), 4000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLimit = contextWindow.trim() === '' ? null : parseInt(contextWindow.trim(), 10);
    const validatedLimit = isNaN(parsedLimit as number) ? null : parsedLimit;

    onSave({
      provider,
      apiKey: apiKey.trim(),
      ollamaUrl: ollamaUrl.trim() || 'http://localhost:11434',
      model: model.trim() || (provider === 'ollama' ? 'llama3.2:latest' : 'openai/gpt-4o-mini'),
      contextWindow: validatedLimit,
      mode,
      systemPrompt: systemPrompt.trim(),
    });

    setSavedFeedback(true);
    setTimeout(() => {
      setSavedFeedback(false);
      onClose();
    }, 600);
  };

  const handleClearKey = () => {
    clearApiKey();
    setApiKey('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content settings-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Sliders size={20} />
            <h2>Agent Settings & Providers</h2>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Security Alert */}
        <div className="security-alert-box">
          <ShieldAlert size={18} className="alert-icon" />
          <div className="alert-text">
            <strong>Security & Privacy Notice:</strong>
            <p>
              OpenRouter requests go to cloud APIs with your stored API key. Local Ollama models run 100% locally on your machine at the configured Ollama URL without sending data to external servers.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          {/* PROVIDER BLOCKS */}
          <div className="providers-container">
            {/* 1. OpenRouter Provider Block */}
            <div className={`provider-card ${provider === 'openrouter' ? 'active-provider-card' : ''}`}>
              <div className="provider-card-header">
                <div className="provider-title-wrap">
                  <Globe size={18} className="provider-icon openrouter" />
                  <div>
                    <h3 className="provider-heading">OpenRouter (Cloud)</h3>
                    <p className="provider-desc">Hosted commercial & open-weights models via API</p>
                  </div>
                </div>
                {provider === 'openrouter' && (
                  <span className="provider-status-badge active">Active Provider</span>
                )}
              </div>

              {/* OpenRouter API Key */}
              <div className="provider-body">
                <div className="form-group compact">
                  <div className="form-label-row">
                    <label htmlFor="apiKey">
                      <Key size={14} /> API Key
                    </label>
                    {apiKey && (
                      <button
                        type="button"
                        className="text-btn danger"
                        onClick={handleClearKey}
                        title="Remove API key from localStorage"
                      >
                        <Trash2 size={12} />
                        <span>Clear key</span>
                      </button>
                    )}
                  </div>
                  <div className="input-with-action">
                    <input
                      id="apiKey"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="form-input"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="action-inside-input"
                      onClick={() => setShowKey(!showKey)}
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Built-in OpenRouter Presets */}
                <div className="form-group compact">
                  <div className="models-subheading">OpenRouter Presets:</div>
                  <div className="preset-buttons">
                    {OPENROUTER_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-chip ${model === p.id && provider === 'openrouter' ? 'selected' : ''}`}
                        onClick={() => handleSelectOpenRouterPreset(p)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Saved OpenRouter Models */}
                {openrouterCustomModels.length > 0 && (
                  <div className="form-group compact">
                    <div className="models-subheading">Saved OpenRouter Models:</div>
                    <div className="custom-models-list">
                      {openrouterCustomModels.map((m) => (
                        <div
                          key={m.id}
                          className={`custom-model-chip ${model === m.id && provider === 'openrouter' ? 'selected' : ''}`}
                          onClick={() => {
                            setModel(m.id);
                            setProvider('openrouter');
                            if (m.contextLength !== null) {
                              setContextWindow(String(m.contextLength));
                            }
                          }}
                        >
                          <div className="custom-model-text">
                            <span className="custom-model-id">{m.name || m.id}</span>
                            {m.contextLength !== null && (
                              <span className="custom-model-context-pill">
                                {m.contextLength >= 1000000
                                  ? `${m.contextLength / 1000000}M`
                                  : m.contextLength >= 1000
                                  ? `${Math.round(m.contextLength / 1000)}k`
                                  : m.contextLength}{' '}
                                ctx
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="delete-model-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveCustomModel(m.id);
                              if (model === m.id) {
                                setModel('openai/gpt-4o-mini');
                                setProvider('openrouter');
                              }
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Custom OpenRouter Model */}
                <div className="add-model-container">
                  <div className="models-subheading">Add OpenRouter Model:</div>
                  <div className="add-model-row">
                    <input
                      type="text"
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      placeholder="e.g. anthropic/claude-sonnet-4"
                      className="form-input add-model-input"
                      disabled={isFetchingModel}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOpenRouterModel(e);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="add-model-btn"
                      onClick={handleAddOpenRouterModel}
                      disabled={!newModelInput.trim() || isFetchingModel}
                    >
                      {isFetchingModel ? (
                        <>
                          <Loader2 size={14} className="spin-icon" />
                          <span>Checking...</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          <span>Add</span>
                        </>
                      )}
                    </button>
                  </div>

                  {fetchSuccessMsg && (
                    <div className="fetch-success-banner">
                      <Check size={14} />
                      <span>{fetchSuccessMsg}</span>
                    </div>
                  )}

                  {fetchError && (
                    <div className="manual-fallback-card">
                      <div className="fallback-header">
                        <AlertCircle size={14} />
                        <span>{fetchError}</span>
                      </div>
                      <div className="fallback-inputs">
                        <input
                          type="number"
                          value={manualContextInput}
                          onChange={(e) => setManualContextInput(e.target.value)}
                          placeholder="Context window tokens"
                          className="form-input fallback-num-input"
                        />
                        <button
                          type="button"
                          className="btn-primary-small"
                          onClick={handleConfirmManualOpenRouterAdd}
                        >
                          Add with limit
                        </button>
                        <button
                          type="button"
                          className="btn-secondary-small"
                          onClick={() => setFetchError(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Ollama Provider Block */}
            <div className={`provider-card ${provider === 'ollama' ? 'active-provider-card' : ''}`}>
              <div className="provider-card-header">
                <div className="provider-title-wrap">
                  <HardDrive size={18} className="provider-icon ollama" />
                  <div>
                    <h3 className="provider-heading">Ollama (Local)</h3>
                    <p className="provider-desc">Local inference on your hardware (free, offline, private)</p>
                  </div>
                </div>
                {provider === 'ollama' && (
                  <span className="provider-status-badge active">Active Provider</span>
                )}
              </div>

              <div className="provider-body">
                {/* Server URL and Connection Status */}
                <div className="form-group compact">
                  <label htmlFor="ollamaUrl">
                    <Server size={14} /> Ollama Server URL
                  </label>
                  <div className="ollama-url-row">
                    <input
                      id="ollamaUrl"
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="form-input"
                    />
                    <button
                      type="button"
                      className="btn-secondary-small"
                      onClick={handleCheckOllamaConnection}
                      disabled={isCheckingOllama}
                      title="Test connection to Ollama server"
                    >
                      {isCheckingOllama ? (
                        <Loader2 size={13} className="spin-icon" />
                      ) : (
                        'Test'
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-small refresh-models-btn"
                      onClick={handleRefreshOllamaModels}
                      disabled={isRefreshingModels}
                      title="Query GET /api/tags to load installed models"
                    >
                      {isRefreshingModels ? (
                        <Loader2 size={13} className="spin-icon" />
                      ) : (
                        <>
                          <RefreshCw size={13} />
                          <span>Load Models</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Status Indicator */}
                  <div className="ollama-status-row">
                    {ollamaStatus.checked ? (
                      ollamaStatus.ok ? (
                        <div className="status-indicator online">
                          <CheckCircle size={14} />
                          <span>Connected to Ollama (v{ollamaStatus.version})</span>
                        </div>
                      ) : (
                        <div className="status-indicator offline">
                          <XCircle size={14} />
                          <span>Offline: {ollamaStatus.error}</span>
                        </div>
                      )
                    ) : (
                      <div className="status-indicator neutral">
                        <span>Click "Test" or "Load Models" to check connection</span>
                      </div>
                    )}
                  </div>

                  {refreshMessage && (
                    <div className="refresh-banner">
                      <span>{refreshMessage}</span>
                    </div>
                  )}
                </div>

                {/* Popular Ollama Presets */}
                <div className="form-group compact">
                  <div className="models-subheading">Popular Presets:</div>
                  <div className="preset-buttons">
                    {OLLAMA_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-chip ${model === p.id && provider === 'ollama' ? 'selected' : ''}`}
                        onClick={() => handleSelectOllamaPreset(p)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detected / Custom Ollama Models */}
                {ollamaCustomModels.length > 0 && (
                  <div className="form-group compact">
                    <div className="models-subheading">Installed / Added Ollama Models:</div>
                    <div className="custom-models-list">
                      {ollamaCustomModels.map((m) => (
                        <div
                          key={m.id}
                          className={`custom-model-chip ${model === m.id && provider === 'ollama' ? 'selected' : ''}`}
                          onClick={() => {
                            setModel(m.id);
                            setProvider('ollama');
                            if (m.contextLength !== null) {
                              setContextWindow(String(m.contextLength));
                            }
                          }}
                        >
                          <div className="custom-model-text">
                            <span className="custom-model-id">{m.name || m.id}</span>
                            {m.contextLength !== null && (
                              <span className="custom-model-context-pill local">
                                {m.contextLength >= 1000
                                  ? `${Math.round(m.contextLength / 1000)}k`
                                  : m.contextLength}{' '}
                                ctx
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="delete-model-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveCustomModel(m.id);
                              if (model === m.id) {
                                setModel('llama3.2:latest');
                                setProvider('ollama');
                              }
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Custom Ollama Model */}
                <div className="add-model-container">
                  <div className="models-subheading">Add Local Model Manually:</div>
                  <div className="add-model-row">
                    <input
                      type="text"
                      value={newOllamaModelInput}
                      onChange={(e) => setNewOllamaModelInput(e.target.value)}
                      placeholder="e.g. mistral-nemo:12b or deepseek-r1:8b"
                      className="form-input add-model-input"
                      disabled={isFetchingOllamaModel}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOllamaModel(e);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="add-model-btn"
                      onClick={handleAddOllamaModel}
                      disabled={!newOllamaModelInput.trim() || isFetchingOllamaModel}
                    >
                      {isFetchingOllamaModel ? (
                        <>
                          <Loader2 size={14} className="spin-icon" />
                          <span>Resolving...</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          <span>Add</span>
                        </>
                      )}
                    </button>
                  </div>

                  {ollamaFetchSuccessMsg && (
                    <div className="fetch-success-banner">
                      <Check size={14} />
                      <span>{ollamaFetchSuccessMsg}</span>
                    </div>
                  )}
                  {ollamaFetchError && (
                    <div className="fetch-error-banner">
                      <AlertCircle size={14} />
                      <span>{ollamaFetchError}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ACTIVE MODEL & CONTEXT CONFIGURATION */}
          <div className="active-config-panel">
            <div className="active-config-header">
              <Cpu size={16} />
              <span>Active Model Selection</span>
              <span className={`active-provider-pill ${provider}`}>
                {provider === 'ollama' ? 'Local Ollama' : 'OpenRouter Cloud'}
              </span>
            </div>

            <div className="active-config-fields">
              <div className="form-group compact">
                <label htmlFor="model">Model Name / Tag</label>
                <input
                  id="model"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. openai/gpt-4o-mini or llama3.2:latest"
                  className="form-input"
                />
              </div>

              <div className="form-group compact">
                <div className="form-label-row">
                  <label htmlFor="contextWindow">
                    <Layers size={14} /> Context Window (Tokens)
                  </label>
                  <div className="quick-limits">
                    <button
                      type="button"
                      className="micro-pill"
                      onClick={() => setContextWindow('300')}
                      title="Set small limit to test Demo Overflow and Trimming quickly"
                    >
                      Test: 300
                    </button>
                    <button
                      type="button"
                      className="micro-pill"
                      onClick={() => setContextWindow('8192')}
                    >
                      8,192
                    </button>
                    <button
                      type="button"
                      className="micro-pill"
                      onClick={() => setContextWindow('128000')}
                    >
                      128k
                    </button>
                  </div>
                </div>
                <input
                  id="contextWindow"
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(e.target.value)}
                  placeholder="Leave empty if model limit is unknown"
                  className="form-input"
                  min="50"
                />
              </div>
            </div>
          </div>

          {/* Context Mode */}
          <div className="form-group">
            <label>
              <Sparkles size={14} /> Context Management Mode
            </label>
            <div className="radio-cards">
              <label className={`radio-card ${mode === 'production' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  value="production"
                  checked={mode === 'production'}
                  onChange={() => setMode('production')}
                />
                <div className="radio-card-body">
                  <div className="radio-card-title">Production Mode (Auto-trim)</div>
                  <div className="radio-card-desc">
                    Keeps system message and newest messages. Trims oldest messages when context limit is approached.
                  </div>
                </div>
              </label>

              <label className={`radio-card ${mode === 'demo' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  value="demo"
                  checked={mode === 'demo'}
                  onChange={() => setMode('demo')}
                />
                <div className="radio-card-body">
                  <div className="radio-card-title">Demo Overflow Mode</div>
                  <div className="radio-card-desc">
                    Sends full un-trimmed history. Demonstrates real context limits and shows explanatory error when exceeded.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* System Prompt */}
          <div className="form-group">
            <label htmlFor="systemPrompt">System Prompt</label>
            <textarea
              id="systemPrompt"
              rows={2}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="System prompt instructions..."
              className="form-input"
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {savedFeedback ? (
                <>
                  <Check size={16} /> Saved!
                </>
              ) : (
                'Save settings'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
