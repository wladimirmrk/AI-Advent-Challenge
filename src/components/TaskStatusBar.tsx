import React from 'react';
import { Agent } from '../agent/Agent';
import { TaskState, TaskStage, WorkingMemory } from '../agent/types';
import { Play, Pause, FastForward, CheckCircle2, ListChecks } from 'lucide-react';

interface TaskStatusBarProps {
  agent: Agent;
  taskState: TaskState;
  workingMemory: WorkingMemory;
  isAutoRunning?: boolean;
  onOpenMemoryHub?: () => void;
}

const STAGES: Array<{ id: TaskStage; label: string; icon: string }> = [
  { id: 'planning', label: '1. Планирование', icon: '📝' },
  { id: 'execution', label: '2. Выполнение', icon: '⚙️' },
  { id: 'validation', label: '3. Валидация', icon: '🔍' },
  { id: 'done', label: '4. Завершено', icon: '✅' },
];

export const TaskStatusBar: React.FC<TaskStatusBarProps> = ({
  agent,
  taskState,
  workingMemory,
  isAutoRunning = false,
  onOpenMemoryHub,
}) => {
  const { stage, currentStepIndex, expectedAction, isPaused } = taskState;
  const currentPlanItem = workingMemory.plan[currentStepIndex];
  const stepTitle = currentPlanItem ? currentPlanItem.text : taskState.currentStepTitle || `Шаг ${currentStepIndex + 1}`;
  const totalSteps = workingMemory.plan.length;

  const handleStartTask = () => {
    agent.setTaskStage('planning', 'Сформировать и согласовать план действий');
    agent.startAutoExecution();
  };

  const handleStartAutoRun = () => {
    agent.startAutoExecution();
  };

  const handlePause = () => {
    agent.pauseTask();
  };

  const handleResume = async () => {
    await agent.resumeTask(true);
  };

  const handleNextStage = () => {
    const stageOrder: TaskStage[] = ['planning', 'execution', 'validation', 'done'];
    const currentIdx = stageOrder.indexOf(stage);
    if (currentIdx >= 0 && currentIdx < stageOrder.length - 1) {
      const nextStage = stageOrder[currentIdx + 1];
      agent.setTaskStage(nextStage);
    }
  };

  const handleNextStep = () => {
    if (currentStepIndex + 1 < totalSteps) {
      agent.setTaskStep(currentStepIndex + 1);
    } else {
      agent.setTaskStage('validation', 'Проверить соответствие результата критериям');
    }
  };

  if (stage === 'idle') {
    return (
      <div className="task-status-bar idle">
        <div className="task-status-left">
          <span className="task-fsm-badge idle">FSM: Не активна</span>
          <span className="task-idle-hint">
            {workingMemory.goal ? `Цель: "${workingMemory.goal}"` : 'Конечный автомат задачи не запущен'}
          </span>
        </div>
        <div className="task-status-actions">
          <button className="task-btn-primary" onClick={handleStartTask} title="Начать этап планирования и запустить авто-цикл">
            🚀 Начать задачу (Auto-run)
          </button>
          {onOpenMemoryHub && (
            <button className="task-btn-ghost" onClick={onOpenMemoryHub} title="Настроить в памяти">
              Настроить
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`task-status-bar active ${isPaused ? 'paused' : isAutoRunning ? 'auto-running' : 'running'}`}>
      {/* Stages Stepper */}
      <div className="task-stepper">
        {STAGES.map((s, idx) => {
          const isCurrent = stage === s.id;
          const stageIndex = STAGES.findIndex((st) => st.id === stage);
          const isCompleted = stageIndex > idx || stage === 'done';

          return (
            <div
              key={s.id}
              className={`task-step-item ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => agent.setTaskStage(s.id)}
              title={`Переключить на этап: ${s.label}`}
            >
              <div className="task-step-indicator">
                {isCompleted ? <CheckCircle2 size={13} /> : <span>{s.icon}</span>}
              </div>
              <span className="task-step-label">{s.label}</span>
              {idx < STAGES.length - 1 && <div className="task-step-divider" />}
            </div>
          );
        })}
      </div>

      {/* Details Row: Step, Expected Action, Pause/Resume button */}
      <div className="task-detail-row">
        <div className="task-detail-left">
          <div className={`task-state-pill ${isPaused ? 'pill-paused' : isAutoRunning ? 'pill-autorun' : 'pill-active'}`}>
            <span className="pulse-dot" />
            {isPaused ? 'ПАУЗА ⏸' : isAutoRunning ? 'АВТО-ЦИКЛ ⚡' : 'АКТИВНА ▶'}
          </div>

          <div className="task-current-info">
            <span className="task-step-number">
              Шаг {totalSteps > 0 ? `${currentStepIndex + 1}/${totalSteps}` : `#${currentStepIndex + 1}`}:
            </span>
            <span className="task-step-title" title={stepTitle}>
              {stepTitle}
            </span>
          </div>

          {expectedAction && (
            <div className="task-expected-badge" title={expectedAction}>
              <span className="expected-label">Ожидание:</span>
              <span className="expected-val">{expectedAction}</span>
            </div>
          )}
        </div>

        <div className="task-status-actions">
          {isPaused ? (
            <button
              className="task-btn-resume"
              onClick={handleResume}
              title="Продолжить выполнение авто-цикла без повторных объяснений"
            >
              <Play size={13} />
              Продолжить
            </button>
          ) : isAutoRunning ? (
            <button className="task-btn-pause" onClick={handlePause} title="Поставить авто-цикл на паузу">
              <Pause size={13} />
              Пауза
            </button>
          ) : stage !== 'done' ? (
            <button className="task-btn-autorun" onClick={handleStartAutoRun} title="Запустить непрерывный цикл выполнения шагов">
              ⚡ Авто-цикл
            </button>
          ) : null}

          {!isPaused && !isAutoRunning && (
            <button className="task-btn-pause" onClick={handlePause} title="Поставить задачу на паузу">
              <Pause size={13} />
              Пауза
            </button>
          )}

          {stage !== 'done' && totalSteps > 0 && currentStepIndex + 1 < totalSteps && (
            <button className="task-btn-ghost" onClick={handleNextStep} title="Перейти к следующему шагу вручную">
              <FastForward size={13} />
              Шаг +1
            </button>
          )}

          {stage !== 'done' && (
            <button className="task-btn-ghost" onClick={handleNextStage} title="Перейти к следующему этапу вручную">
              Этап →
            </button>
          )}

          {onOpenMemoryHub && (
            <button className="task-btn-icon" onClick={onOpenMemoryHub} title="Открыть детальное управление FSM">
              <ListChecks size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
