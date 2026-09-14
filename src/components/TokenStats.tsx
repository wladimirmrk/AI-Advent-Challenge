import React from 'react';
import { TokenStats as TokenStatsType } from '../agent/types';
import { formatTokenCount } from '../agent/tokenizer';
import { Cpu, DollarSign } from 'lucide-react';

interface TokenStatsProps {
  stats: TokenStatsType;
}

export const TokenStats: React.FC<TokenStatsProps> = ({ stats }) => {
  const {
    currentRequest,
    conversation,
    response,
    total,
    contextWindow,
    isEstimated,
    estimatedCost,
  } = stats;

  const percentage = contextWindow && contextWindow > 0
    ? Math.min(100, Math.round((conversation / contextWindow) * 100))
    : null;

  const isNearLimit = percentage !== null && percentage > 85;
  const isOverLimit = percentage !== null && percentage >= 100;

  return (
    <div className="token-stats-bar">
      <div className="stats-header">
        <div className="stats-title">
          <Cpu size={14} className="stats-icon" />
          <span>Token Usage</span>
          {isEstimated && (
            <span className="estimate-badge" title="Values prefixed with ~ are pre-request BPE estimates until confirmed by OpenRouter API usage.">
              ~ estimated
            </span>
          )}
        </div>

        {stats.isLocal ? (
          <div className="cost-tag local" title="Local Ollama model runs on your machine for free">
            <span>$0.00 (Local)</span>
          </div>
        ) : estimatedCost !== null ? (
          <div className="cost-tag" title="Estimated cost based on model token pricing">
            <DollarSign size={12} />
            <span>~${estimatedCost < 0.0001 ? '<0.0001' : estimatedCost.toFixed(4)}</span>
          </div>
        ) : null}
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Current request</div>
          <div className="stat-value">{formatTokenCount(currentRequest, isEstimated)}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Conversation</div>
          <div className="stat-value">{formatTokenCount(conversation, isEstimated)}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Response</div>
          <div className="stat-value">{formatTokenCount(response, isEstimated && response > 0)}</div>
        </div>

        <div className="stat-card total">
          <div className="stat-label">Total</div>
          <div className="stat-value">{formatTokenCount(total, isEstimated)}</div>
        </div>
      </div>

      {/* Context window progress bar */}
      <div className="context-progress-container">
        <div className="context-progress-info">
          <span className="context-label">Context window:</span>
          {contextWindow ? (
            <span className={`context-numbers ${isOverLimit ? 'over-limit' : isNearLimit ? 'near-limit' : ''}`}>
              <strong>{formatTokenCount(conversation, isEstimated)}</strong> / {contextWindow.toLocaleString()} tokens ({percentage}%)
            </span>
          ) : (
            <span className="context-numbers">
              <strong>{formatTokenCount(conversation, isEstimated)}</strong> tokens (Limit: unknown)
            </span>
          )}
        </div>

        {percentage !== null && (
          <div className="progress-track" title={`${percentage}% of context window used`}>
            <div
              className={`progress-fill ${isOverLimit ? 'danger' : isNearLimit ? 'warning' : 'normal'}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
