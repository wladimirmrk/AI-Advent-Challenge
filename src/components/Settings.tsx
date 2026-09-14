import React, { useState } from 'react';
import { AgentConfig, AgentMode } from '../agent/types';
import { MODEL_CONTEXT_LIMITS } from '../agent/tokenizer';
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
} from 'lucide-react';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: AgentConfig;
  onSave: (newConfig: AgentConfig) => void;
}

const MODEL_PRESETS = [
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
  onSave,
}) => {
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState(config.model);
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
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. openai/gpt-4o-mini"
              className="form-input"
            />
            <div className="field-hint">
              Any valid OpenRouter model slug (e.g. <code>openai/gpt-4o-mini</code>, <code>anthropic/claude-3.5-sonnet</code>).
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
