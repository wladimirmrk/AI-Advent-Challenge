import React, { useState } from 'react';
import {
  X,
  Code2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  FolderGit2,
  Layers,
  Search,
  CheckCircle2,
  AlertCircle,
  FileCode,
} from 'lucide-react';
import { Agent } from '../../../agent/Agent';
import { generateComposeFromStitch } from '../pipeline';
import { StitchToComposePipelineResult } from '../types';
import { DEFAULT_PROJECT_PATH } from '../rag/indexer';

interface StitchToComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: Agent;
}

const SAMPLE_STITCH_HTML = `<div class="screen w-full bg-slate-950 text-white min-h-screen p-4 flex flex-col gap-4">
  <div class="flex items-center justify-between pb-2 border-b border-slate-800">
    <h1 class="text-xl font-bold">Crypto Portfolio</h1>
    <span class="text-sm text-slate-400">Live Balance</span>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2 shadow-lg">
    <span class="text-xs uppercase text-slate-400">Total Portfolio Value</span>
    <h2 class="text-2xl font-bold text-emerald-400">$24,530.80</h2>
    <span class="text-xs text-emerald-500 font-medium">+5.4% last 24h</span>
  </div>

  <div class="card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
    <h3 class="text-base font-semibold">Quick Actions</h3>
    <div class="flex gap-2">
      <button class="btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm w-full">
        Deposit
      </button>
      <button class="btn px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl text-sm w-full">
        Transfer
      </button>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium text-slate-300">Search Assets</span>
    <input
      type="text"
      placeholder="Search coins (BTC, ETH)..."
      class="input w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500"
    />
  </div>
</div>`;

export const StitchToComposeModal: React.FC<StitchToComposeModalProps> = ({
  isOpen,
  onClose,
  agent,
}) => {
  const [htmlInput, setHtmlInput] = useState<string>(SAMPLE_STITCH_HTML);
  const [projectPath, setProjectPath] = useState<string>(DEFAULT_PROJECT_PATH);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<StitchToComposePipelineResult | null>(null);

  // Accordion open states
  const [isIrOpen, setIsIrOpen] = useState<boolean>(true);
  const [isRagOpen, setIsRagOpen] = useState<boolean>(true);
  const [isPlanOpen, setIsPlanOpen] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!htmlInput.trim()) {
      setError('Пожалуйста, вставьте HTML разметку экрана Google Stitch.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgressMsg('Инициализация пайплайна...');

    try {
      const res = await generateComposeFromStitch(
        {
          html: htmlInput,
          projectPath: projectPath.trim() || undefined,
          onProgress: (_stage, msg) => {
            if (msg) setProgressMsg(msg);
          },
        },
        agent
      );

      setPipelineResult(res);
      setProgressMsg('');
    } catch (err: any) {
      console.error('Pipeline error:', err);
      setError(err.message || 'Произошла ошибка при выполнении пайплайна Stitch-to-Compose.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!pipelineResult?.result.code) return;
    try {
      await navigator.clipboard.writeText(pipelineResult.result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="stitch-modal-overlay" onClick={onClose}>
      <div
        className="stitch-modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stitch-modal-title"
      >
        {/* Header */}
        <div className="stitch-modal-header">
          <div className="stitch-header-title-box">
            <div className="stitch-header-badge">
              <Sparkles size={18} className="stitch-sparkle-icon" />
              <span className="stitch-badge-text">MVP Feature</span>
            </div>
            <h2 id="stitch-modal-title" className="stitch-title">
              Google Stitch → Jetpack Compose
            </h2>
            <p className="stitch-subtitle">
              Детерминированный Design IR + Контекстный RAG по Android проекту + Compose Planning
            </p>
          </div>
          <button
            type="button"
            className="stitch-close-btn"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Content */}
        <div className="stitch-modal-body">
          {/* Top Form Section */}
          <div className="stitch-form-grid">
            <div className="stitch-field-group">
              <div className="stitch-field-header">
                <label className="stitch-field-label">
                  <Code2 size={15} /> Stitch Screen HTML
                </label>
                <button
                  type="button"
                  className="stitch-btn-secondary"
                  onClick={() => setHtmlInput(SAMPLE_STITCH_HTML)}
                  title="Загрузить тестовый образец Stitch"
                >
                  Вставить тестовый HTML
                </button>
              </div>
              <textarea
                className="stitch-textarea"
                rows={8}
                value={htmlInput}
                onChange={(e) => setHtmlInput(e.target.value)}
                placeholder="Вставьте сюда HTML код экрана из Google Stitch..."
                disabled={isLoading}
              />
            </div>

            <div className="stitch-field-group">
              <label className="stitch-field-label">
                <FolderGit2 size={15} /> Целевой Android Проект (RAG индекс)
              </label>
              <div className="stitch-project-input-row">
                <input
                  type="text"
                  className="stitch-text-input"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="Путь к репозиторию Android (например: C:/Users/W/Projects/CryptoTrack)"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="stitch-btn-generate"
                  onClick={handleGenerate}
                  disabled={isLoading || !htmlInput.trim()}
                >
                  {isLoading ? (
                    <>
                      <span className="stitch-spinner" />
                      <span>{progressMsg || 'Генерация...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Сгенерировать Compose UI</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="stitch-error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Results Section */}
          {pipelineResult && (
            <div className="stitch-results-wrapper">
              {/* Summary Stats Row */}
              <div className="stitch-summary-bar">
                <div className="stitch-summary-item">
                  <span className="summary-label">Экран:</span>
                  <span className="summary-val">{pipelineResult.designScreen.name}</span>
                </div>
                <div className="stitch-summary-item">
                  <span className="summary-label">Узлов в IR:</span>
                  <span className="summary-val">{pipelineResult.designScreen.metadata?.nodeCount}</span>
                </div>
                <div className="stitch-summary-item">
                  <span className="summary-label">RAG чанков:</span>
                  <span className="summary-val">{pipelineResult.ragContext.chunks.length}</span>
                </div>
                <div className="stitch-summary-item">
                  <span className="summary-label">Переиспользовано:</span>
                  <span className="summary-val accent-green">
                    {pipelineResult.result.reusedComponents.length} комп.
                  </span>
                </div>
                <div className="stitch-summary-item">
                  <span className="summary-label">Время:</span>
                  <span className="summary-val">{pipelineResult.timingMs.total} мс</span>
                </div>
              </div>

              {/* 1. Design IR Accordion */}
              <div className="stitch-accordion">
                <button
                  type="button"
                  className="stitch-accordion-header"
                  onClick={() => setIsIrOpen((v) => !v)}
                >
                  <div className="accordion-title-row">
                    <Layers size={16} className="accordion-icon" />
                    <span className="accordion-title">1. Design IR & Дизайн-токены</span>
                    <span className="accordion-badge">
                      {pipelineResult.designScreen.metadata?.nodeCount} узлов / глубина {pipelineResult.designScreen.metadata?.depth}
                    </span>
                  </div>
                  {isIrOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>

                {isIrOpen && (
                  <div className="stitch-accordion-content">
                    {pipelineResult.designScreen.tokens && (
                      <div className="stitch-tokens-preview">
                        <div className="tokens-col">
                          <strong>Цвета:</strong>{' '}
                          {Object.entries(pipelineResult.designScreen.tokens.colors).map(([k, v]) => (
                            <span key={k} className="token-pill" style={{ borderColor: v }}>
                              {k}: {v}
                            </span>
                          ))}
                        </div>
                        <div className="tokens-col">
                          <strong>Отступы:</strong>{' '}
                          {Object.entries(pipelineResult.designScreen.tokens.spacing).map(([k, v]) => (
                            <span key={k} className="token-pill">
                              {k}: {v}dp
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <pre className="stitch-code-block json-view">
                      <code>{JSON.stringify(pipelineResult.designScreen, null, 2)}</code>
                    </pre>
                  </div>
                )}
              </div>

              {/* 2. Retrieved Context Accordion */}
              <div className="stitch-accordion">
                <button
                  type="button"
                  className="stitch-accordion-header"
                  onClick={() => setIsRagOpen((v) => !v)}
                >
                  <div className="accordion-title-row">
                    <Search size={16} className="accordion-icon" />
                    <span className="accordion-title">2. Контекст Android-проекта (RAG)</span>
                    <span className="accordion-badge">
                      {pipelineResult.ragContext.chunks.length} найдено {pipelineResult.ragContext.fromCache ? '(из кэша)' : ''}
                    </span>
                  </div>
                  {isRagOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>

                {isRagOpen && (
                  <div className="stitch-accordion-content">
                    <div className="stitch-rag-query-box">
                      <strong>Сформированный запрос:</strong> {pipelineResult.ragContext.query}
                    </div>
                    <div className="stitch-chunks-list">
                      {pipelineResult.ragContext.chunks.map((chunk, i) => (
                        <div key={i} className="stitch-chunk-card">
                          <div className="chunk-header">
                            <span className="chunk-symbol">{chunk.symbol}</span>
                            <span className="chunk-file">{chunk.file}</span>
                            <span className="chunk-score">score: {chunk.score}</span>
                          </div>
                          <pre className="stitch-code-block small">
                            <code>{chunk.content}</code>
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Compose Plan Accordion */}
              <div className="stitch-accordion">
                <button
                  type="button"
                  className="stitch-accordion-header"
                  onClick={() => setIsPlanOpen((v) => !v)}
                >
                  <div className="accordion-title-row">
                    <FileCode size={16} className="accordion-icon" />
                    <span className="accordion-title">3. Compose Plan (Архитектурный план)</span>
                    <span className="accordion-badge">Root: {pipelineResult.plan.root}</span>
                  </div>
                  {isPlanOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>

                {isPlanOpen && (
                  <div className="stitch-accordion-content">
                    <table className="stitch-plan-table">
                      <thead>
                        <tr>
                          <th>Node ID</th>
                          <th>Тип IR</th>
                          <th>Реализация Compose</th>
                          <th>Переиспользование</th>
                          <th>Обоснование</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pipelineResult.plan.components.map((comp, idx) => (
                          <tr key={idx}>
                            <td><code>{comp.designNodeId}</code></td>
                            <td>{comp.nodeType}</td>
                            <td><strong>{comp.implementation}</strong></td>
                            <td>
                              {comp.isReused ? (
                                <span className="status-badge reused">✓ REUSED</span>
                              ) : (
                                <span className="status-badge new">+ NEW</span>
                              )}
                            </td>
                            <td className="reason-col">{comp.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 4. Generated Kotlin Output */}
              <div className="stitch-output-card">
                <div className="stitch-output-header">
                  <div className="output-info">
                    <CheckCircle2 size={18} className="output-check-icon" />
                    <span className="output-filename">
                      {pipelineResult.result.screen.file} ({pipelineResult.result.screen.name})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="stitch-btn-copy"
                    onClick={handleCopyCode}
                    title="Скопировать Kotlin код"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                  </button>
                </div>

                {pipelineResult.result.reusedComponents.length > 0 && (
                  <div className="reused-badges-row">
                    <span className="reused-label">Переиспользованные компоненты:</span>
                    {pipelineResult.result.reusedComponents.map((c, i) => (
                      <span key={i} className="reused-pill">
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                <pre className="stitch-code-block full-kotlin">
                  <code>{pipelineResult.result.code}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
