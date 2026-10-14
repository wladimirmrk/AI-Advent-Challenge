import React, { useState, useEffect } from 'react';
import { X, Sliders, Sparkles, RotateCcw, Check, Info, CheckCircle } from 'lucide-react';
import { Agent } from '../agent/Agent';

interface ModelParamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: Agent;
}

export const ModelParamsModal: React.FC<ModelParamsModalProps> = ({
  isOpen,
  onClose,
  agent,
}) => {
  const agentState = agent.getState();
  const config = agentState.config;

  const [enabled, setEnabled] = useState<boolean>(config.customParamsEnabled ?? false);
  const [temperature, setTemperature] = useState<number>(config.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState<string>(
    config.maxTokens !== undefined && config.maxTokens !== null ? String(config.maxTokens) : '2048'
  );
  const [contextWindow, setContextWindow] = useState<string>(
    config.contextWindow !== undefined && config.contextWindow !== null ? String(config.contextWindow) : '4096'
  );
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const currentConfig = agent.getState().config;
      setEnabled(currentConfig.customParamsEnabled ?? false);
      setTemperature(currentConfig.temperature ?? 0.7);
      setMaxTokens(
        currentConfig.maxTokens !== undefined && currentConfig.maxTokens !== null
          ? String(currentConfig.maxTokens)
          : '2048'
      );
      setContextWindow(
        currentConfig.contextWindow !== undefined && currentConfig.contextWindow !== null
          ? String(currentConfig.contextWindow)
          : '4096'
      );
      setSavedFeedback(false);
    }
  }, [isOpen, agent]);

  if (!isOpen) return null;

  const handleApplyPreset = (temp: number, tokens: number, ctx: number) => {
    setEnabled(true);
    setTemperature(temp);
    setMaxTokens(String(tokens));
    setContextWindow(String(ctx));
  };

  const handleResetToDefaults = () => {
    setEnabled(false);
    setTemperature(0.7);
    setMaxTokens('2048');
    setContextWindow('4096');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedTokens = parseInt(maxTokens.trim(), 10);
    const validatedTokens = isNaN(parsedTokens) || parsedTokens <= 0 ? null : parsedTokens;
    const parsedCtx = parseInt(contextWindow.trim(), 10);
    const validatedCtx = isNaN(parsedCtx) || parsedCtx <= 0 ? null : parsedCtx;

    agent.setCustomModelParams({
      enabled,
      temperature: Number(temperature.toFixed(2)),
      maxTokens: validatedTokens,
      contextWindow: validatedCtx,
    });

    setSavedFeedback(true);
    setTimeout(() => {
      setSavedFeedback(false);
      onClose();
    }, 450);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content model-params-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Sliders size={20} className="primary-icon" />
            <div>
              <h2>Параметры модели для этого чата</h2>
              <span className="modal-subtitle">
                Активная модель: <strong>{config.model}</strong> ({config.provider})
              </span>
            </div>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose} title="Закрыть">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="model-params-form">
          {/* Main Toggle Checkbox */}
          <div className={`params-toggle-banner ${enabled ? 'active' : ''}`}>
            <label className="checkbox-control-label">
              <input
                type="checkbox"
                className="custom-checkbox-input"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="checkbox-text-wrapper">
                <span className="checkbox-title">Настроить параметры модели для этого чата</span>
                <span className="checkbox-description">
                  {enabled
                    ? 'Включено: используются индивидуальные настройки (температура, лимит токенов, контекст)'
                    : 'По умолчанию выключено: действуют стандартные системные параметры выбранной модели'}
                </span>
              </span>
            </label>
          </div>

          {!enabled ? (
            <div className="params-disabled-notice">
              <Info size={18} className="notice-icon" />
              <div className="notice-text">
                <p>
                  Индивидуальная настройка параметров для текущего чата отключена. Запросы отправляются со стандартными
                  параметрами модели.
                </p>
                <p className="notice-hint">
                  Поставьте галочку выше, чтобы настроить температуру, длину генерации и контекстное окно под вашу
                  задачу (например, строгий режим кодинга).
                </p>
              </div>
            </div>
          ) : (
            <div className="params-active-container">
              {/* Quick Presets Bar */}
              <div className="quick-presets-section">
                <span className="presets-label">
                  <Sparkles size={14} /> Готовые профили:
                </span>
                <div className="preset-buttons-group">
                  <button
                    type="button"
                    className="preset-chip-btn coding-preset"
                    onClick={() => handleApplyPreset(0.15, 512, 4096)}
                    title="Минимальная температура для строгого кода без лишних рассуждений"
                  >
                    🎯 Точный кодинг (T: 0.15, 512 токенов, Ctx: 4K)
                  </button>
                  <button
                    type="button"
                    className="preset-chip-btn balance-preset"
                    onClick={() => handleApplyPreset(0.7, 2048, 8192)}
                    title="Стандартный сбалансированный режим"
                  >
                    ⚖️ Баланс (T: 0.7, 2048 токенов, Ctx: 8K)
                  </button>
                  <button
                    type="button"
                    className="preset-chip-btn creative-preset"
                    onClick={() => handleApplyPreset(1.1, 4096, 16384)}
                    title="Повышенная вариативность для генерации идей"
                  >
                    💡 Креативный (T: 1.1, 4096 токенов)
                  </button>
                </div>
              </div>

              {/* Temperature */}
              <div className="param-field-group">
                <div className="param-label-row">
                  <label htmlFor="temp-range">
                    Температура генерации (Temperature): <strong>{temperature.toFixed(2)}</strong>
                  </label>
                  <span className="param-value-tag">
                    {temperature <= 0.3 ? '🎯 Строгий / Кодинг' : temperature <= 0.8 ? '⚖️ Сбалансированный' : '💡 Креативный'}
                  </span>
                </div>
                <div className="slider-control-row">
                  <input
                    id="temp-range"
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="param-slider"
                  />
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 2) {
                        setTemperature(val);
                      }
                    }}
                    className="param-number-input"
                  />
                </div>
                <p className="field-hint">
                  Низкая (0.1–0.3) идеальна для кода, фактов и RAG. Высокая (0.8–1.5) повышает разнообразие ответов.
                </p>
              </div>

              {/* Max Tokens */}
              <div className="param-field-group">
                <div className="param-label-row">
                  <label htmlFor="max-tokens-input">
                    Максимум токенов ответа (Max Tokens / <code>num_predict</code>):
                  </label>
                  <span className="param-chips">
                    {[256, 512, 1024, 2048, 4096].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        className={`chip-selector ${maxTokens === String(tok) ? 'active' : ''}`}
                        onClick={() => setMaxTokens(String(tok))}
                      >
                        {tok}
                      </button>
                    ))}
                  </span>
                </div>
                <input
                  id="max-tokens-input"
                  type="number"
                  min="32"
                  max="16384"
                  step="64"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                  className="param-text-input"
                  placeholder="Например: 512 или 2048"
                />
                <p className="field-hint">
                  Ограничение максимальной длины ответа модели. Для локальной LLM на CPU (Ollama) ограничение в 512 токенов резко снижает время ожидания!
                </p>
              </div>

              {/* Context Window */}
              <div className="param-field-group">
                <div className="param-label-row">
                  <label htmlFor="ctx-window-input">
                    Размер контекстного окна (Context Window / <code>num_ctx</code>):
                  </label>
                  <span className="param-chips">
                    {[2048, 4096, 8192, 16384, 32768, 65536].map((ctx) => (
                      <button
                        key={ctx}
                        type="button"
                        className={`chip-selector ${contextWindow === String(ctx) ? 'active' : ''}`}
                        onClick={() => setContextWindow(String(ctx))}
                      >
                        {ctx >= 1000 ? `${Math.round(ctx / 1024)}k` : ctx}
                      </button>
                    ))}
                  </span>
                </div>
                <input
                  id="ctx-window-input"
                  type="number"
                  min="512"
                  max="1048576"
                  step="512"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(e.target.value)}
                  className="param-text-input"
                  placeholder="Например: 4096"
                />
                <p className="field-hint">
                  Объем оперативной памяти, выделяемой под KV-кэш контекста в Ollama. Значение 4096 (4K) экономит гигабайты RAM по сравнению с дефолтными 40K.
                </p>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="modal-footer-actions">
            <button
              type="button"
              className="reset-defaults-btn"
              onClick={handleResetToDefaults}
              title="Сбросить к значениям по умолчанию"
            >
              <RotateCcw size={15} /> Сбросить настройки
            </button>
            <div className="modal-right-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn-primary" disabled={savedFeedback}>
                {savedFeedback ? (
                  <>
                    <CheckCircle size={16} /> Сохранено!
                  </>
                ) : (
                  <>
                    <Check size={16} /> Применить для этого чата
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
