import React from 'react';
import { Agent } from '../agent/Agent';
import { TaskState, TaskStage, WorkingMemory } from '../agent/types';
import {
  Play,
  Pause,
  FastForward,
  CheckCircle2,
  ListChecks,
  RotateCcw,
  Check,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface TaskStatusBarProps {
  agent: Agent;
  taskState: TaskState;
  workingMemory: WorkingMemory;
  isAutoRunning?: boolean;
  onOpenMemoryHub?: () => void;
}

const STAGES: Array<{ id: TaskStage; label: string; icon: string }> = [
  { id: 'planning', label: '1. Планирование', icon: '📝' },
  { id: 'plan_approved', label: '2. План утвержден', icon: '📋' },
  { id: 'execution', label: '3. Выполнение', icon: '⚙️' },
  { id: 'validation', label: '4. Валидация', icon: '🔍' },
  { id: 'done', label: '5. Завершено', icon: '✅' },
];

export const TaskStatusBar: React.FC<TaskStatusBarProps> = ({
  agent,
  taskState,
  workingMemory,
  isAutoRunning = false,
  onOpenMemoryHub,
}) => {
  const { stage, currentStepIndex, expectedAction, isPaused, lastTransitionError } = taskState;
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

  const handleNextStep = () => {
    if (currentStepIndex + 1 < totalSteps) {
      agent.setTaskStep(currentStepIndex + 1);
    } else {
      agent.setTaskStage('validation', 'Проверить соответствие результата критериям');
    }
  };

  const handleDismissError = () => {
    agent.updateTaskState({ lastTransitionError: undefined });
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

  const stageOrder: TaskStage[] = ['planning', 'plan_approved', 'execution', 'validation', 'done'];
  const currentStageIndex = stageOrder.indexOf(stage);

  return (
    <div className={`task-status-bar active ${isPaused ? 'paused' : isAutoRunning ? 'auto-running' : 'running'}`}>
      {/* Alert banner if illegal transition was blocked */}
      {lastTransitionError && (
        <div className="task-transition-error-banner">
          <div className="error-banner-text">
            <ShieldAlert size={14} />
            <span>
              <strong>Переход заблокирован:</strong> {lastTransitionError}
            </span>
          </div>
          <button className="error-banner-dismiss" onClick={handleDismissError} title="Скрыть предупреждение">
            ✕
          </button>
        </div>
      )}

      {/* Stages Stepper */}
      <div className="task-stepper">
        {STAGES.map((s, idx) => {
          const isCurrent = stage === s.id;
          const isCompleted = currentStageIndex > idx || stage === 'done';
          const transitionCheck = agent.canTransitionTo(s.id);
          const isAllowedTransition = transitionCheck.success && !isCurrent;
          const isForbidden = !isCurrent && !transitionCheck.success;

          const tooltip = isCurrent
            ? `Текущий этап: ${s.label}`
            : isAllowedTransition
            ? `Разрешённый переход на этап: ${s.label}`
            : `Запрещённый перескок: ${transitionCheck.reason || 'недопустимо'}`;

          return (
            <div
              key={s.id}
              className={`task-step-item ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''} ${
                isAllowedTransition ? 'allowed' : ''
              } ${isForbidden ? 'disabled' : ''}`}
              onClick={() => {
                if (isCurrent) return;
                agent.setTaskStage(s.id);
              }}
              title={tooltip}
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

      {/* Details Row: Step, Expected Action, Pause/Resume button, and Contextual Lifecycle Actions */}
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
          {/* Pause / Resume Controls */}
          {isPaused ? (
            <button
              className="task-btn-resume"
              onClick={handleResume}
              title="Продолжить выполнение авто-цикла строго с текущего шага"
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

          {!isPaused && !isAutoRunning && stage !== 'done' && (
            <button className="task-btn-pause" onClick={handlePause} title="Поставить задачу на паузу">
              <Pause size={13} />
              Пауза
            </button>
          )}

          {/* Contextual Lifecycle State Transition Buttons */}
          {stage === 'planning' && (
            <button
              className="task-btn-contextual plan-approve"
              onClick={() => agent.approvePlan()}
              disabled={totalSteps === 0}
              title={totalSteps === 0 ? 'Сначала сформируйте план шагов' : 'Утвердить сформированный план и перейти к исполнению'}
            >
              <Check size={13} />
              Утвердить план 👍
            </button>
          )}

          {stage === 'plan_approved' && (
            <>
              <button
                className="task-btn-contextual execute-start"
                onClick={() => agent.setTaskStage('execution')}
                title="Начать практическое выполнение шагов"
              >
                <Play size={13} />
                Начать выполнение ⚙️
              </button>
              <button
                className="task-btn-ghost"
                onClick={() => agent.rejectToPlanning('Требуется уточнение')}
                title="Вернуть на этап планирования для доработки"
              >
                <RotateCcw size={12} />
                Править план
              </button>
            </>
          )}

          {stage === 'execution' && (
            <>
              {totalSteps > 0 && currentStepIndex + 1 < totalSteps && (
                <button className="task-btn-ghost" onClick={handleNextStep} title="Перейти к следующему шагу вручную">
                  <FastForward size={13} />
                  Шаг +1
                </button>
              )}
              <button
                className="task-btn-contextual validate-start"
                onClick={() => agent.setTaskStage('validation', 'Провести верификацию и проверку')}
                title="Перейти к этапу валидации результатов"
              >
                <ArrowRight size={13} />
                На валидацию 🔍
              </button>
              <button
                className="task-btn-ghost"
                onClick={() => agent.rejectToPlanning('Изменение требований')}
                title="Вернуть на перепланирование"
              >
                <RotateCcw size={12} />
                План
              </button>
            </>
          )}

          {stage === 'validation' && (
            <>
              <button
                className="task-btn-contextual finish-done"
                onClick={() => agent.setTaskStage('done', 'Задача верифицирована и успешно закрыта')}
                title="Подтвердить успешное завершение задачи"
              >
                <CheckCircle2 size={13} />
                Завершить ✅
              </button>
              <button
                className="task-btn-contextual rework"
                onClick={() => agent.rejectToExecution('Обнаружены дефекты при валидации')}
                title="Вернуть в execution для исправления найденных замечаний"
              >
                <RotateCcw size={12} />
                На доработку 🔁
              </button>
            </>
          )}

          {stage === 'done' && (
            <button
              className="task-btn-ghost"
              onClick={() => agent.setTaskStage('idle', '', true)}
              title="Сбросить состояние для новой задачи"
            >
              <RotateCcw size={13} />
              Новая задача 🔄
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
