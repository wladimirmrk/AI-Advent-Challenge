import React, { useState, useEffect } from 'react';
import { agentInstance } from '../agent/Agent';
import { AgentState, AgentConfig, ContextStrategy } from '../agent/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TokenStats } from './TokenStats';
import { Settings, OPENROUTER_PRESETS, OLLAMA_PRESETS } from './Settings';
import { StrategySelector } from './StrategySelector';
import { BranchBar } from './BranchBar';
import { StickyFactsPanel } from './StickyFactsPanel';
import { Bot, Settings as SettingsIcon, Trash2, Cpu } from 'lucide-react';

export const Chat: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(() => agentInstance.getState());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFactsDrawerOpen, setIsFactsDrawerOpen] = useState(false);

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
    if (window.confirm('Clear all conversation history for the active branch?')) {
      agentInstance.clearHistory();
    }
  };

  const handleStrategyChange = (newStrategy: ContextStrategy) => {
    agentInstance.setStrategy(newStrategy);
    if (newStrategy === 'sticky_facts') {
      setIsFactsDrawerOpen(true);
    }
  };

  const handleSaveSettings = (newConfig: AgentConfig) => {
    agentInstance.setApiKey(newConfig.apiKey);
    agentInstance.setOllamaUrl(newConfig.ollamaUrl);
    agentInstance.setProvider(newConfig.provider);
    agentInstance.setModel(newConfig.model, newConfig.contextWindow, newConfig.provider);
    agentInstance.setStrategy(newConfig.strategy);
    agentInstance.setSystemPrompt(newConfig.systemPrompt);
    agentInstance.setRecentMessagesCount(newConfig.recentMessagesCount);
    agentInstance.setSummaryThreshold(newConfig.summaryThreshold);
  };

  const handleBranchFromMessage = (messageId: string) => {
    const branchName = `Ветка ${agentState.branches.length + 1}`;
    agentInstance.createBranch(branchName, messageId);
    agentInstance.setStrategy('branching');
  };

  const handleSelectModel = (val: string) => {
    if (OPENROUTER_PRESETS.some((p) => p.id === val)) {
      agentInstance.setModel(val, undefined, 'openrouter');
    } else if (OLLAMA_PRESETS.some((p) => p.id === val)) {
      agentInstance.setModel(val, undefined, 'ollama');
    } else {
      const custom = agentState.customModels.find((m) => m.id === val);
      const prov = custom?.provider || agentState.config.provider;
      agentInstance.setModel(val, custom?.contextLength, prov);
    }
  };

  const isOllama = agentState.config.provider === 'ollama';
  const hasApiKey = Boolean(agentState.config.apiKey && agentState.config.apiKey.trim().length > 0);
  const isReady = isOllama || hasApiKey;

  const openrouterCustom = agentState.customModels.filter(
    (m) => !m.provider || m.provider === 'openrouter'
  );
  const ollamaCustom = agentState.customModels.filter((m) => m.provider === 'ollama');

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
              onChange={(e) => handleSelectModel(e.target.value)}
              disabled={agentState.isLoading}
              title="Select active model"
            >
              <optgroup label="🌐 OpenRouter Models">
                {OPENROUTER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {openrouterCustom.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                    {m.contextLength
                      ? ` (${m.contextLength >= 1000000 ? `${m.contextLength / 1000000}M` : `${Math.round(m.contextLength / 1000)}k`})`
                      : ''}
                  </option>
                ))}
              </optgroup>

              <optgroup label="💻 Local Ollama Models">
                {OLLAMA_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {ollamaCustom.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                    {m.contextLength
                      ? ` (${m.contextLength >= 1000 ? `${Math.round(m.contextLength / 1000)}k` : m.contextLength})`
                      : ''}
                  </option>
                ))}
              </optgroup>

              {!OPENROUTER_PRESETS.some((p) => p.id === agentState.config.model) &&
                !OLLAMA_PRESETS.some((p) => p.id === agentState.config.model) &&
                !agentState.customModels.some((m) => m.id === agentState.config.model) && (
                  <optgroup label="Active Custom">
                    <option value={agentState.config.model}>{agentState.config.model}</option>
                  </optgroup>
                )}
            </select>
          </div>
        </div>

        <div className="header-center">
          <StrategySelector
            strategy={agentState.config.strategy}
            onStrategyChange={handleStrategyChange}
            recentMessagesCount={agentState.config.recentMessagesCount}
            onRecentMessagesCountChange={(n) => agentInstance.setRecentMessagesCount(n)}
            factsCount={agentState.facts.length}
            isFactsOpen={isFactsDrawerOpen}
            onToggleFacts={() => setIsFactsDrawerOpen(!isFactsDrawerOpen)}
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
            className={`action-btn settings-btn ${!isReady ? 'needs-attention' : ''}`}
            onClick={() => setIsSettingsOpen(true)}
            title="Open Settings"
          >
            <SettingsIcon size={18} />
            <span className="btn-text">Settings</span>
            {!isReady && <span className="notification-dot" title="Configuration required" />}
          </button>
        </div>
      </header>

      {/* Main Conversation Canvas */}
      <main className="chat-main-content">
        {(agentState.config.strategy === 'branching' || agentState.branches.length > 1) && (
          <BranchBar
            branches={agentState.branches}
            activeBranchId={agentState.activeBranchId}
            onSwitchBranch={(id) => agentInstance.switchBranch(id)}
            onCreateBranch={(name) => agentInstance.createBranch(name)}
            onRenameBranch={(id, name) => agentInstance.renameBranch(id, name)}
            onDeleteBranch={(id) => agentInstance.deleteBranch(id)}
            disabled={agentState.isLoading}
          />
        )}

        <div className="chat-body-container">
          <MessageList
            messages={agentState.messages}
            isLoading={agentState.isLoading}
            error={agentState.error}
            lastTrimInfo={agentState.lastTrimInfo}
            strategy={agentState.config.strategy}
            recentMessagesCount={agentState.config.recentMessagesCount}
            onClearError={() => agentInstance.clearError()}
            onSuggestionClick={(prompt) => handleSendMessage(prompt)}
            onBranchFromMessage={handleBranchFromMessage}
          />

          <StickyFactsPanel
            isOpen={isFactsDrawerOpen}
            onClose={() => setIsFactsDrawerOpen(false)}
            facts={agentState.facts}
            isExtracting={agentState.isExtractingFacts}
            onAddFact={(k, v, cat) => agentInstance.addFact(k, v, cat)}
            onUpdateFact={(id, upd) => agentInstance.updateFact(id, upd)}
            onRemoveFact={(id) => agentInstance.removeFact(id)}
            onClearFacts={() => agentInstance.clearFacts()}
          />
        </div>
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
          hasApiKey={isReady}
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
        onAddCustomModel={(model) => agentInstance.addCustomModel(model)}
        onRemoveCustomModel={(modelId) => agentInstance.removeCustomModel(modelId)}
      />
    </div>
  );
};
