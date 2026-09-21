import { TaskStage, TransitionResult } from './types';

/**
 * Strict Allowed Transitions Matrix for Task Lifecycle (Day 15):
 * idle -> planning -> plan_approved -> execution -> validation -> done
 *
 * Allowed backward loopbacks:
 * - validation -> execution (fix detected defects)
 * - execution -> planning (requirements or plan changed)
 * - plan_approved -> planning (refine plan before starting execution)
 * - done -> idle (reset / new task)
 */
export const ALLOWED_TRANSITIONS: Record<TaskStage, TaskStage[]> = {
  idle: ['planning'],
  planning: ['plan_approved', 'idle'],
  plan_approved: ['execution', 'planning'],
  execution: ['validation', 'planning'],
  validation: ['done', 'execution'],
  done: ['idle'],
};

export const STAGE_LABELS: Record<TaskStage, string> = {
  idle: 'Не активна',
  planning: '1. Планирование',
  plan_approved: '2. План утвержден',
  execution: '3. Выполнение',
  validation: '4. Валидация',
  done: '5. Завершено',
};

export const STAGE_ICONS: Record<TaskStage, string> = {
  idle: '⏸️',
  planning: '📝',
  plan_approved: '📋',
  execution: '⚙️',
  validation: '🔍',
  done: '✅',
};

export interface TransitionValidationContext {
  planLength?: number;
  isPaused?: boolean;
}

/**
 * Validates whether a state transition is permitted by the FSM lifecycle and guards.
 */
export function canTransition(
  from: TaskStage,
  to: TaskStage,
  context?: TransitionValidationContext
): TransitionResult {
  // 1. Same stage is idempotent
  if (from === to) {
    return { success: true, from, to };
  }

  // 2. Check transition matrix
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    // Generate helpful, specific refusal reasons
    let reason = `Переход из этапа "${STAGE_LABELS[from]}" в "${STAGE_LABELS[to]}" запрещён жизненным циклом задачи.`;

    if (from === 'idle' && (to === 'execution' || to === 'plan_approved')) {
      reason = 'Нельзя приступать к реализации без предварительного формирования плана (этап планирования).';
    } else if (from === 'planning' && to === 'execution') {
      reason = 'Нельзя начинать выполнение до утверждения плана (сначала требуется этап "2. План утвержден").';
    } else if ((from === 'idle' || from === 'planning' || from === 'plan_approved') && to === 'done') {
      reason = 'Нельзя завершать задачу в обход этапов реализации и обязательной валидации.';
    } else if (from === 'execution' && to === 'done') {
      reason = 'Нельзя завершать задачу напрямую без прохождения этапа валидации (тестирование и проверка качества).';
    }

    return {
      success: false,
      from,
      to,
      reason,
    };
  }

  // 3. Guard conditions
  // Guard: Cannot approve an empty plan
  if (from === 'planning' && to === 'plan_approved') {
    if (context?.planLength !== undefined && context.planLength <= 0) {
      return {
        success: false,
        from,
        to,
        reason: 'Нельзя утвердить пустой план: сначала сформируйте шаги реализации.',
      };
    }
  }

  return { success: true, from, to };
}

/**
 * Returns array of stages that can be transitioned to from current stage.
 */
export function getAvailableNextStages(currentStage: TaskStage): TaskStage[] {
  return [...(ALLOWED_TRANSITIONS[currentStage] || [])];
}
