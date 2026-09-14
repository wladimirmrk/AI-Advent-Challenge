import React, { useState, useEffect } from 'react';
import { agentInstance } from '../agent/Agent';
import { AgentState, AgentConfig, AgentMode } from '../agent/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TokenStats } from './TokenStats';
import { Settings, MODEL_PRESETS } from './Settings';
import { ModeToggle } from './ModeToggle';
import { Bot, Settings as SettingsIcon, Trash2, Cpu } from 'lucide-react';

export const Chat: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(() => agentInstance.getState());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Subscribe to Agent state changes (Agent -> React state -> UI)
  useEffect(() => {
    const unsubscribe = agentInstance.subscribe((newState) => {
      setAgentState(newState);
    });
    return unsubscribe;
  }, []);

  const handleSendMessage = async (text: string) => {
    await agentInstance.sendMessage(text);
  };

  const handleClearHistory = () => {
    if (agentState.messages.length === 0) return;
    if (window.confirm('Clear all conversation history from Agent and localStorage?')) {
      agentInstance.clearHistory();
    }
  };

  const handleModeChange = (newMode: AgentMode) => {
    agentInstance.setMode(newMode);
  };

  const handleSaveSettings = (newConfig: AgentConfig) => {
    agentInstance.setApiKey(newConfig.apiKey);
    agentInstance.setModel(newConfig.model, newConfig.contextWindow);
    agentInstance.setMode(newConfig.mode);
    agentInstance.setSystemPrompt(newConfig.systemPrompt);
  };

  const hasApiKey = Boolean(agentState.config.apiKey && agentState.config.apiKey.trim().length > 0);

  return (
    <div className="chat-app-layout">
      {/* Top Navigation Bar */}
      <header className="chat-header">
        <div className="header-left">
          <div className="logo-badge">
            <Bot size={22} className="brand-icon" />
            <div className="brand-info">
              <span className="brand-name">AI Agent</span>
              <span className="brand-tag">Educational</span>
            </div>
          </div>

          <div className="model-selector-wrapper" title="Switch active model">
            <Cpu size={14} className="model-select-icon" />
            <select
              className="model-select-dropdown"
              value={agentState.config.model}
              onChange={(e) => agentInstance.setModel(e.target.value)}
              disabled={agentState.isLoading}
              title="Select active model"
            >
              <optgroup label="Default Presets">
                {MODEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              {agentState.customModels.length > 0 && (
                <optgroup label="Saved Custom Models">
                  {agentState.customModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              )}
              {!MODEL_PRESETS.some((p) => p.id === agentState.config.model) &&
                !agentState.customModels.includes(agentState.config.model) && (
                  <optgroup label="Active Custom">
                    <option value={agentState.config.model}>{agentState.config.model}</option>
                  </optgroup>
                )}
            </select>
          </div>
        </div>

        <div className="header-center">
          <ModeToggle
            mode={agentState.config.mode}
            onChange={handleModeChange}
            disabled={agentState.isLoading}
          />
        </div>

        <div className="header-right">
          {agentState.messages.length > 0 && (
            <button
              type="button"
              className="action-btn clear-btn"
              onClick={handleClearHistory}
              title="Clear conversation and localStorage"
              disabled={agentState.isLoading}
            >
              <Trash2 size={16} />
              <span className="btn-text">Clear</span>
            </button>
          )}

          <button
            type="button"
            className={`action-btn settings-btn ${!hasApiKey ? 'needs-attention' : ''}`}
            onClick={() => setIsSettingsOpen(true)}
            title="Open Settings"
          >
            <SettingsIcon size={18} />
            <span className="btn-text">Settings</span>
            {!hasApiKey && <span className="notification-dot" title="API Key required" />}
          </button>
        </div>
      </header>

      {/* Main Conversation Canvas */}
      <main className="chat-main-content">
        <MessageList
          messages={agentState.messages}
          isLoading={agentState.isLoading}
          error={agentState.error}
          lastTrimInfo={agentState.lastTrimInfo}
          onClearError={() => agentInstance.clearError()}
          onSuggestionClick={(prompt) => handleSendMessage(prompt)}
        />
      </main>

      {/* Token Usage Stats Bar */}
      <section className="stats-section">
        <TokenStats stats={agentState.tokenStats} />
      </section>

      {/* Input Field Section */}
      <footer className="chat-footer">
        <MessageInput
          onSendMessage={handleSendMessage}
          disabled={agentState.isLoading}
          hasApiKey={hasApiKey}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      </footer>

      {/* Settings Modal */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={agentState.config}
        customModels={agentState.customModels}
        onSave={handleSaveSettings}
        onAddCustomModel={(modelId) => agentInstance.addCustomModel(modelId)}
        onRemoveCustomModel={(modelId) => agentInstance.removeCustomModel(modelId)}
      />
    </div>
  );
};
