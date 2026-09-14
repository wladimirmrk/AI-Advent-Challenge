import React from 'react';
import { AgentMode } from '../agent/types';
import { ShieldCheck, AlertOctagon } from 'lucide-react';

interface ModeToggleProps {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export const ModeToggle: React.FC<ModeToggleProps> = ({ mode, onChange, disabled }) => {
  return (
    <div className="mode-toggle-container" title="Context Management Strategy">
      <div className="mode-toggle-group">
        <button
          type="button"
          className={`mode-btn ${mode === 'production' ? 'active' : ''}`}
          onClick={() => onChange('production')}
          disabled={disabled}
          title="Production Mode: Automatically trims older messages to stay within the model context limit."
        >
          <ShieldCheck size={14} />
          <span>Production</span>
        </button>

        <button
          type="button"
          className={`mode-btn ${mode === 'demo' ? 'active demo' : ''}`}
          onClick={() => onChange('demo')}
          disabled={disabled}
          title="Demo Overflow Mode: Keeps full history without trimming to demonstrate context window limits and real API errors."
        >
          <AlertOctagon size={14} />
          <span>Demo Overflow</span>
        </button>
      </div>
    </div>
  );
};
