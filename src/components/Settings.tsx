import React, { useState } from 'react';
import { AgentConfig, AgentMode, CustomModel } from '../agent/types';
import { MODEL_CONTEXT_LIMITS, fetchModelInfo } from '../agent/tokenizer';
import { clearApiKey } from '../agent/storage';
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

export const MODEL_PRESETS = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)', defaultLimit: 128000 },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (Google)', defaultLimit: 1048576 },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (Meta)', defaultLimit: 131072 },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (Anthropic)', defaultLimit: 200000 },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (DeepSeek)', defaultLimit: 64000 },
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
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState(config.model);
  const [newModelInput, setNewModelInput] = useState('');
  const [isFetchingModel, setIsFetchingModel] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualContextInput, setManualContextInput] = useState('128000');
  const [fetchSuccessMsg, setFetchSuccessMsg] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState<string>(
    config.contextWindow !== null ? String(config.contextWindow) : ''
  );
  const [mode, setMode] = useState<AgentMode>(config.mode);
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt);
  const [showKey, setShowKey] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  if (!isOpen) return null;

  const handleSelectPreset = (presetId: string) => {
    setModel(presetId);
    const limit = MODEL_CONTEXT_LIMITS[presetId];
    if (limit) {
      setContextWindow(String(limit));
    }
  };

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newModelInput.trim();
    if (!trimmed || isFetchingModel) return;

    setIsFetchingModel(true);
    setFetchError(null);
    setFetchSuccessMsg(null);

    // Call OpenRouter API for model info (https://openrouter.ai/api/v1/model/<model_id>)
    const info = await fetchModelInfo(trimmed, apiKey);
    setIsFetchingModel(false);

    if (info) {
      const newModel: CustomModel = {
        id: trimmed,
        name: info.name,
        contextLength: info.contextLength,
      };
      onAddCustomModel(newModel);
      setModel(trimmed);
      if (info.contextLength !== null) {
        setContextWindow(String(info.contextLength));
      }
      setNewModelInput('');
      const limitText = info.contextLength ? `${info.contextLength.toLocaleString()} tokens` : 'unknown limit';
      setFetchSuccessMsg(`Added: ${info.name || trimmed} (${limitText})`);
      setTimeout(() => setFetchSuccessMsg(null), 4000);
    } else {
      // Model not found on OpenRouter or network error: offer manual fallback
      setFetchError(`Could not find "${trimmed}" on OpenRouter. Specify context window manually:`);
      setManualContextInput(contextWindow || '128000');
    }
  };

  const handleConfirmManualAdd = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed) return;
    const parsed = manualContextInput.trim() ? parseInt(manualContextInput.trim(), 10) : null;
    const newModel: CustomModel = {
      id: trimmed,
      contextLength: isNaN(parsed as number) ? null : parsed,
    };
    onAddCustomModel(newModel);
    setModel(trimmed);
    if (newModel.contextLength !== null) {
      setContextWindow(String(newModel.contextLength));
    }
    setNewModelInput('');
    setFetchError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLimit = contextWindow.trim() === '' ? null : parseInt(contextWindow.trim(), 10);
    const validatedLimit = isNaN(parsedLimit as number) ? null : parsedLimit;

    onSave({
      apiKey: apiKey.trim(),
      model: model.trim() || 'openai/gpt-4o-mini',
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
    onSave({
      ...config,
      apiKey: '',
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Sliders size={20} />
            <h2>Agent Settings</h2>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Security Alert */}
        <div className="security-alert-box">
          <ShieldAlert size={18} className="alert-icon" />
          <div className="alert-text">
            <strong>Educational Project Security Notice:</strong>
            <p>
              This is a frontend-only application. API keys stored in the browser are not secret.
              Anyone with access to your browser or DevTools can inspect them. Never expose sensitive production keys.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          {/* API Key */}
          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="apiKey">
                <Key size={14} /> OpenRouter API Key
              </label>
              {apiKey && (
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={handleClearKey}
                  title="Remove API key from localStorage"
                >
                  <Trash2 size={12} />
                  <span>Clear stored API key</span>
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
            <div className="field-hint">
              Stored locally in <code>localStorage</code> (key: <code>openrouter_api_key</code>).
            </div>
          </div>

          {/* Model Selection */}
          <div className="form-group">
            <label htmlFor="model">
              <Cpu size={14} /> Model Identifier
            </label>

            <div className="models-subheading">Built-in Presets:</div>
            <div className="preset-buttons">
              {MODEL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`preset-chip ${model === p.id ? 'selected' : ''}`}
                  onClick={() => handleSelectPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom Models List */}
            {customModels.length > 0 && (
              <div className="custom-models-section">
                <div className="models-subheading">Saved Custom Models:</div>
                <div className="custom-models-list">
                  {customModels.map((m) => (
                    <div
                      key={m.id}
                      className={`custom-model-chip ${model === m.id ? 'selected' : ''}`}
                      onClick={() => {
                        setModel(m.id);
                        if (m.contextLength !== null) {
                          setContextWindow(String(m.contextLength));
                        }
                      }}
                      title={`Select ${m.name || m.id}`}
                    >
                      <div className="custom-model-text">
                        <span className="custom-model-id">{m.name || m.id}</span>
                        {m.contextLength !== null ? (
                          <span className="custom-model-context-pill">
                            {m.contextLength >= 1000000
                              ? `${m.contextLength / 1000000}M`
                              : m.contextLength >= 1000
                              ? `${Math.round(m.contextLength / 1000)}k`
                              : m.contextLength} ctx
                          </span>
                        ) : (
                          <span className="custom-model-context-pill unknown">? ctx</span>
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
                          }
                        }}
                        title={`Delete ${m.id} from saved models`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add New Custom Model */}
            <div className="add-model-container">
              <div className="models-subheading">Add New Model:</div>
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
                      handleAddCustomModel(e);
                    }
                  }}
                />
                <button
                  type="button"
                  className="add-model-btn"
                  onClick={handleAddCustomModel}
                  disabled={!newModelInput.trim() || isFetchingModel}
                  title="Query OpenRouter and save model"
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
                      onClick={handleConfirmManualAdd}
                    >
                      Add with this limit
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

            <div className="active-model-display">
              <div className="models-subheading">Active Model:</div>
              <input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. openai/gpt-4o-mini"
                className="form-input"
              />
            </div>
            <div className="field-hint">
              Selected model used by the Agent. Custom models are saved in <code>localStorage</code>.
            </div>
          </div>

          {/* Context Window */}
          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="contextWindow">
                <Layers size={14} /> Context Window Limit (Tokens)
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
            <div className="field-hint">
              Leave blank if unknown. Set to a small value (e.g. 300 or 500) to easily test Demo Overflow and Production Trimming!
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
                    Sends full un-trimmed history. Demonstrates real context limits and shows explanatory API error when exceeded.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* System Prompt */}
          <div className="form-group">
            <label htmlFor="systemPrompt">
              System Prompt
            </label>
            <textarea
              id="systemPrompt"
              rows={2}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="System prompt instructions..."
              className="form-input"
            />
            <div className="field-hint">
              In Production mode, the system prompt is always preserved when trimming history.
            </div>
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
