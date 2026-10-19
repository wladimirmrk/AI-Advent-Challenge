import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container" style={{
          padding: '24px',
          margin: '16px',
          background: 'var(--bg-card, #1c1f26)',
          border: '1px solid var(--status-error, #f87171)',
          borderRadius: '12px',
          color: 'var(--text-primary, #f0f2f5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '12px'
        }}>
          <AlertTriangle size={36} color="var(--status-error, #f87171)" />
          <h3 style={{ margin: 0, fontSize: '16px' }}>
            {this.props.fallbackTitle || 'Произошла ошибка при отображении компонента'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', opacity: 0.8, maxWidth: '500px', wordBreak: 'break-word' }}>
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={this.handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '8px',
              padding: '6px 14px',
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} />
            <span>Попробовать снова</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
