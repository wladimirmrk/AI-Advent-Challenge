import React, { useState, useEffect } from 'react';
import { Agent, agentInstance } from '../agent/Agent';
import { AgentState, AgentConfig, ContextStrategy } from '../agent/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TokenStats } from './TokenStats';
import { Settings, OPENROUTER_PRESETS, OLLAMA_PRESETS } from './Settings';
import { StrategySelector } from './StrategySelector';
import { BranchBar } from './BranchBar';
import { StickyFactsPanel } from './StickyFactsPanel';
import { MemoryHub } from './MemoryHub';
import { Bot, Settings as SettingsIcon, Trash2, Cpu, PanelLeft, Brain } from 'lucide-react';

interface ChatProps {
  agent?: Agent;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const Chat: React.FC<ChatProps> = ({
  agent = agentInstance,
  onToggleSidebar,
  isSidebarOpen = false,
}) => {
  const [agentState, setAgentState] = useState<AgentState>(() => agent.getState());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFactsDrawerOpen, setIsFactsDrawerOpen] = useState(false);
  const [isMemoryHubOpen, setIsMemoryHubOpen] = useState(false);

  // Subscribe to Agent state changes (Agent -> React state -> UI)
  useEffect(() => {
    setAgentState(agent.getState());
    const unsubscribe = agent.subscribe((newState) => {
      setAgentState(newState);
    });
    return unsubscribe;
  }, [agent]);

  const handleSendMessage = async (text: string) => {
    await agent.sendMessage(text);
  };

  const handleClearHistory = () => {
    if (agentState.messages.length === 0) return;
    if (window.confirm('Clear all conversation history for the active branch?')) {
      agent.clearHistory();
    }
  };

  const handleStrategyChange = (newStrategy: ContextStrategy) => {
    agent.setStrategy(newStrategy);
    if (newStrategy === 'sticky_facts') {
      setIsFactsDrawerOpen(true);
    }
  };

  const handleSaveSettings = (newConfig: AgentConfig) => {
    agent.setApiKey(newConfig.apiKey);
    agent.setOllamaUrl(newConfig.ollamaUrl);
    agent.setProvider(newConfig.provider);
    agent.setModel(newConfig.model, newConfig.contextWindow, newConfig.provider);
    agent.setStrategy(newConfig.strategy);
    agent.setSystemPrompt(newConfig.systemPrompt);
    agent.setRecentMessagesCount(newConfig.recentMessagesCount);
    agent.setSummaryThreshold(newConfig.summaryThreshold);
  };

  const handleBranchFromMessage = (messageId: string) => {
    const branchName = `Ветка ${agentState.branches.length + 1}`;
    agent.createBranch(branchName, messageId);
    agent.setStrategy('branching');
  };

  const handleSelectModel = (val: string) => {
    if (OPENROUTER_PRESETS.some((p) => p.id === val)) {
      agent.setModel(val, undefined, 'openrouter');
    } else if (OLLAMA_PRESETS.some((p) => p.id === val)) {
      agent.setModel(val, undefined, 'ollama');
    } else {
      const custom = agentState.customModels.find((m) => m.id === val);
      const prov = custom?.provider || agentState.config.provider;
      agent.setModel(val, custom?.contextLength, prov);
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
          {onToggleSidebar && (
            <button
              type="button"
              className="sidebar-toggle-btn header-sidebar-toggle"
              onClick={onToggleSidebar}
              title={isSidebarOpen ? 'Свернуть панель' : 'Развернуть панель'}
            >
              <PanelLeft size={18} />
            </button>
          )}

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
            onRecentMessagesCountChange={(n) => agent.setRecentMessagesCount(n)}
            factsCount={agentState.facts.length}
            isFactsOpen={isFactsDrawerOpen}
            onToggleFacts={() => setIsFactsDrawerOpen(!isFactsDrawerOpen)}
            disabled={agentState.isLoading}
          />
        </div>

        <div className="header-right">
          <button
            type="button"
            className={`action-btn memory-hub-btn ${isMemoryHubOpen ? 'active' : ''}`}
            onClick={() => setIsMemoryHubOpen(!isMemoryHubOpen)}
            title="Memory Hub: 3 явных слоя памяти (Short-Term, Working, Long-Term)"
          >
            <Brain size={16} />
            <span className="btn-text">Memory Hub</span>
            <span className="memory-badge-count">
              {(agentState.workingMemory.goal ? 1 : 0) +
                agentState.workingMemory.plan.length +
                agentState.longTermMemory.decisions.length +
                agentState.longTermMemory.knowledge.length}
            </span>
          </button>

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
            onSwitchBranch={(id) => agent.switchBranch(id)}
            onCreateBranch={(name) => agent.createBranch(name)}
            onRenameBranch={(id, name) => agent.renameBranch(id, name)}
            onDeleteBranch={(id) => agent.deleteBranch(id)}
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
            onClearError={() => agent.clearError()}
            onSuggestionClick={(prompt) => handleSendMessage(prompt)}
            onBranchFromMessage={handleBranchFromMessage}
          />

          <StickyFactsPanel
            isOpen={isFactsDrawerOpen}
            onClose={() => setIsFactsDrawerOpen(false)}
            facts={agentState.facts}
            isExtracting={agentState.isExtractingFacts}
            onAddFact={(k, v, cat) => agent.addFact(k, v, cat)}
            onUpdateFact={(id, upd) => agent.updateFact(id, upd)}
            onRemoveFact={(id) => agent.removeFact(id)}
            onClearFacts={() => agent.clearFacts()}
          />

          <MemoryHub
            isOpen={isMemoryHubOpen}
            onClose={() => setIsMemoryHubOpen(false)}
            workingMemory={agentState.workingMemory}
            longTermMemory={agentState.longTermMemory}
            memoryTokensBreakdown={agentState.memoryTokensBreakdown}
            recentMessagesCount={agentState.config.recentMessagesCount}
            messages={agentState.messages}
            agent={agent}
          />
        </div>
      </main>

      {/* Token Usage Stats Bar */}
      <section className="stats-section">
        <TokenStats
          stats={agentState.tokenStats}
          breakdown={agentState.memoryTokensBreakdown}
          onOpenMemoryHub={() => setIsMemoryHubOpen(true)}
        />
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
        onAddCustomModel={(model) => agent.addCustomModel(model)}
        onRemoveCustomModel={(modelId) => agent.removeCustomModel(modelId)}
      />
    </div>
  );
};
