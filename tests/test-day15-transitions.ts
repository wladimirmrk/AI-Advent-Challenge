/**
 * Automated Test Suite for Controlled State Transitions (Day 15):
 * 1. Valid forward lifecycle: idle -> planning -> plan_approved -> execution -> validation -> done
 * 2. Strict rejection of forbidden leaps (cannot execute before plan approved, cannot finalize before validation)
 * 3. Guardrail validation (cannot approve an empty plan)
 * 4. Permitted loopbacks (validation -> execution, execution -> planning)
 * 5. Pause & resume lifecycle preservation (no state jumps after unpause)
 * 6. Model <task_update> tag transition filtering (illegal leaps blocked)
 * 7. Model <state_check> parsing (INVALID_TRANSITION vs VALID)
 */

import { strict as assert } from 'node:assert';

// Mock browser globals (localStorage, window) for Node test environment
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, String(val)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};
(globalThis as any).window = {
  location: { origin: 'http://localhost:5173' },
};

import { Agent } from '../src/agent/Agent';
import { canTransition } from '../src/agent/transitions';

export async function runDay15TransitionsTests() {
  console.log('\n🔥 Starting Day 15: Controlled State Transitions Test Suite...\n');
  mockStorage.clear();

  // ----------------------------------------------------
  // Test T1: Valid Forward Lifecycle
  // ----------------------------------------------------
  console.log('Test T1: Valid forward lifecycle (idle -> planning -> plan_approved -> execution -> validation -> done)');
  const agent1 = new Agent('chat-day15-t1');

  // Step 1: idle -> planning
  let res = agent1.setTaskStage('planning', 'Составить план реализации');
  assert.equal(res.success, true, 'idle -> planning must be allowed');
  assert.equal(agent1.getTaskState().stage, 'planning');

  // Add plan item for guardrail
  agent1.addPlanItem('1. Создать схему таблиц');
  agent1.addPlanItem('2. Написать эндпоинт');

  // Step 2: planning -> plan_approved
  res = agent1.approvePlan('План согласован заказчиком');
  assert.equal(res.success, true, 'planning -> plan_approved must be allowed when plan is not empty');
  assert.equal(agent1.getTaskState().stage, 'plan_approved');

  // Step 3: plan_approved -> execution
  res = agent1.setTaskStage('execution', 'Выполнить первый шаг плана');
  assert.equal(res.success, true, 'plan_approved -> execution must be allowed');
  assert.equal(agent1.getTaskState().stage, 'execution');

  // Step 4: execution -> validation
  res = agent1.setTaskStage('validation', 'Запустить интеграционные тесты');
  assert.equal(res.success, true, 'execution -> validation must be allowed');
  assert.equal(agent1.getTaskState().stage, 'validation');

  // Step 5: validation -> done
  res = agent1.setTaskStage('done', 'Задача полностью выполнена и верифицирована');
  assert.equal(res.success, true, 'validation -> done must be allowed');
  assert.equal(agent1.getTaskState().stage, 'done');

  console.log('  ✓ Full valid 5-stage lifecycle completed successfully');
  console.log('  PASSED: Test T1.\n');

  // ----------------------------------------------------
  // Test T2: Rejection of Forbidden Leaps
  // ----------------------------------------------------
  console.log('Test T2: Strict rejection of forbidden state jumps');
  const agent2 = new Agent('chat-day15-t2');
  assert.equal(agent2.getTaskState().stage, 'idle');

  // 1. Cannot jump idle -> execution
  let forbidden = agent2.setTaskStage('execution');
  assert.equal(forbidden.success, false, 'idle -> execution must be rejected');
  assert.equal(agent2.getTaskState().stage, 'idle', 'State must remain idle');
  assert.ok(forbidden.reason?.includes('планирования'), 'Reason must explain planning requirement');

  // 2. Cannot jump idle -> done
  forbidden = agent2.setTaskStage('done');
  assert.equal(forbidden.success, false, 'idle -> done must be rejected');
  assert.equal(agent2.getTaskState().stage, 'idle');

  // Move to planning
  agent2.setTaskStage('planning');
  agent2.addPlanItem('Шаг 1: Архитектура');

  // 3. Cannot jump planning -> execution (MUST be approved first!)
  forbidden = agent2.setTaskStage('execution');
  assert.equal(forbidden.success, false, 'planning -> execution must be rejected without approval');
  assert.equal(agent2.getTaskState().stage, 'planning', 'State must remain planning');
  assert.ok(forbidden.reason?.includes('утверждения плана'), 'Reason must specify plan approval requirement');

  // 4. Cannot jump planning -> done
  forbidden = agent2.setTaskStage('done');
  assert.equal(forbidden.success, false, 'planning -> done must be rejected');
  assert.equal(agent2.getTaskState().stage, 'planning');

  // Approve plan and enter execution
  agent2.approvePlan();
  agent2.setTaskStage('execution');
  assert.equal(agent2.getTaskState().stage, 'execution');

  // 5. Cannot jump execution -> done (CANNOT finalize without validation!)
  forbidden = agent2.setTaskStage('done');
  assert.equal(forbidden.success, false, 'execution -> done must be rejected without validation');
  assert.equal(agent2.getTaskState().stage, 'execution', 'State must remain execution');
  assert.ok(forbidden.reason?.includes('валидации'), 'Reason must specify validation requirement');

  console.log('  ✓ All 5 illegal state leaps strictly blocked by Guardrail');
  console.log('  PASSED: Test T2.\n');

  // ----------------------------------------------------
  // Test T3: Guardrail Conditions (Empty plan guard)
  // ----------------------------------------------------
  console.log('Test T3: Guardrail condition (Cannot approve an empty plan)');
  const agent3 = new Agent('chat-day15-t3');
  agent3.setTaskStage('planning');
  assert.equal(agent3.getWorkingMemory().plan.length, 0, 'Plan is empty');

  // Attempt to approve empty plan
  const emptyApprove = agent3.approvePlan();
  assert.equal(emptyApprove.success, false, 'Approving empty plan must be rejected');
  assert.equal(agent3.getTaskState().stage, 'planning', 'Must stay in planning');
  assert.ok(emptyApprove.reason?.includes('пустой план'), 'Reason must mention empty plan');

  // Add plan item and try again
  agent3.addPlanItem('Пункт 1 плана');
  const validApprove = agent3.approvePlan();
  assert.equal(validApprove.success, true, 'Approving non-empty plan must succeed');
  assert.equal(agent3.getTaskState().stage, 'plan_approved');

  console.log('  ✓ Empty plan guardrail verified successfully');
  console.log('  PASSED: Test T3.\n');

  // ----------------------------------------------------
  // Test T4: Permitted Return Loops (Loopbacks)
  // ----------------------------------------------------
  console.log('Test T4: Permitted return loopbacks (validation -> execution, execution -> planning)');
  const agent4 = new Agent('chat-day15-t4');
  agent4.setTaskStage('planning');
  agent4.addPlanItem('Шаг 1');
  agent4.approvePlan();
  agent4.setTaskStage('execution');
  agent4.setTaskStage('validation');
  assert.equal(agent4.getTaskState().stage, 'validation');

  // Loopback 1: validation -> execution (fix defects)
  const reworkRes = agent4.rejectToExecution('Обнаружена ошибка в обработчике ошибок');
  assert.equal(reworkRes.success, true, 'validation -> execution must be allowed for rework');
  assert.equal(agent4.getTaskState().stage, 'execution');
  assert.ok(agent4.getTaskState().expectedAction.includes('Исправить замечания'));

  // Loopback 2: execution -> planning (re-planning)
  const replanRes = agent4.rejectToPlanning('Требования изменились');
  assert.equal(replanRes.success, true, 'execution -> planning must be allowed');
  assert.equal(agent4.getTaskState().stage, 'planning');

  // Loopback 3: plan_approved -> planning (refining before start)
  agent4.approvePlan();
  assert.equal(agent4.getTaskState().stage, 'plan_approved');
  const refineRes = agent4.rejectToPlanning('Уточнить детали');
  assert.equal(refineRes.success, true, 'plan_approved -> planning must be allowed');
  assert.equal(agent4.getTaskState().stage, 'planning');

  console.log('  ✓ All 3 allowed loopbacks verified');
  console.log('  PASSED: Test T4.\n');

  // ----------------------------------------------------
  // Test T5: Pause & Resume Lifecycle Preservation
  // ----------------------------------------------------
  console.log('Test T5: Pause & resume lifecycle preservation');
  const agent5 = new Agent('chat-day15-t5');
  agent5.setTaskStage('planning');
  agent5.addPlanItem('Шаг 1: Конфигурация');
  agent5.addPlanItem('Шаг 2: Обработчики');
  agent5.approvePlan();
  agent5.setTaskStage('execution');
  agent5.setTaskStep(1, 'Реализовать обработчик POST /api/payment');

  // Pause
  agent5.pauseTask();
  assert.equal(agent5.getTaskState().isPaused, true);
  assert.equal(agent5.getTaskState().stage, 'execution');
  assert.equal(agent5.getTaskState().currentStepIndex, 1);

  // While paused, illegal transition is still blocked
  const blockedDuringPause = agent5.setTaskStage('done');
  assert.equal(blockedDuringPause.success, false);
  assert.equal(agent5.getTaskState().stage, 'execution');

  // Prompt includes controlled lifecycle instructions
  const prompt = agent5.formatWorkingMemoryPrompt();
  assert.ok(prompt.includes('[TASK STATE MACHINE]'));
  assert.ok(prompt.includes('CONTROLLED LIFECYCLE (DAY 15)'));
  assert.ok(prompt.includes('PAUSED'));
  assert.ok(prompt.includes('NEVER write code or execute implementation tasks during PLANNING'));

  // Resume without jump
  await agent5.resumeTask(false);
  assert.equal(agent5.getTaskState().isPaused, false);
  assert.equal(agent5.getTaskState().stage, 'execution', 'Stage must remain execution upon resume');
  assert.equal(agent5.getTaskState().currentStepIndex, 1, 'Step index must remain 1');
  assert.equal(agent5.getTaskState().expectedAction, 'Реализовать обработчик POST /api/payment');

  console.log('  ✓ Exact state and step preserved across pause and resume');
  console.log('  PASSED: Test T5.\n');

  // ----------------------------------------------------
  // Test T6: Model Tag <task_update> Transition Filtering
  // ----------------------------------------------------
  console.log('Test T6: Model <task_update> tag transition filtering');
  const agent6 = new Agent('chat-day15-t6');
  agent6.setTaskStage('planning');
  agent6.addPlanItem('Пункт плана 1');

  // 1. Model attempts illegal jump <task_update stage="execution" /> directly from planning
  const illegalTag = '<task_update stage="execution" step="1" action="Пишу код" />';
  const parsedIllegal = agent6.parseTaskUpdateTags(illegalTag);
  assert.ok(parsedIllegal);
  assert.equal(parsedIllegal.stage, 'execution');

  // Apply through updateTaskState -> Guardrail must intercept!
  const blockResult = agent6.updateTaskState(parsedIllegal);
  assert.ok(blockResult);
  assert.equal((blockResult as any).success, false, 'updateTaskState must reject illegal tag transition');
  assert.equal(agent6.getTaskState().stage, 'planning', 'Stage must remain planning');
  assert.ok(agent6.getTaskState().lastTransitionError?.includes('утверждения плана'));

  // 2. Model sends legal transition <task_update stage="plan_approved" />
  const legalTag = '<task_update stage="plan_approved" action="План согласован" />';
  const parsedLegal = agent6.parseTaskUpdateTags(legalTag);
  assert.ok(parsedLegal);
  agent6.updateTaskState(parsedLegal);
  assert.equal(agent6.getTaskState().stage, 'plan_approved', 'Legal tag must transition stage');

  console.log('  ✓ Model <task_update> filtered: illegal leaps blocked, valid updates applied');
  console.log('  PASSED: Test T6.\n');

  // ----------------------------------------------------
  // Test T7: Model <state_check> Cognitive Guardrail Parsing
  // ----------------------------------------------------
  console.log('Test T7: Model <state_check> cognitive guardrail parsing');
  const agent7 = new Agent('chat-day15-t7');

  // 1. Parse INVALID_TRANSITION refusal block
  const refusalResponse = `
<state_check>
status: INVALID_TRANSITION
current_stage: planning
requested_stage: execution
reason: Нельзя приступать к написанию кода до утверждения плана реализации.
</state_check>

🛑 **Отказ в переходе к реализации:**
В текущий момент задача находится на этапе планирования. Сначала требуется сформировать и утвердить план шагов.
`;

  const parsedRefusal = agent7.parseStateCheckTags(refusalResponse);
  assert.ok(parsedRefusal);
  assert.equal(parsedRefusal.status, 'INVALID_TRANSITION');
  assert.equal(parsedRefusal.currentStage, 'planning');
  assert.equal(parsedRefusal.requestedStage, 'execution');
  assert.ok(parsedRefusal.reason?.includes('до утверждения плана'));

  // 2. Parse VALID check block
  const validResponse = `
<state_check>
status: VALID
current_stage: execution
</state_check>

Приступаю к выполнению утвержденного шага плана.
`;

  const parsedValid = agent7.parseStateCheckTags(validResponse);
  assert.ok(parsedValid);
  assert.equal(parsedValid.status, 'VALID');
  assert.equal(parsedValid.currentStage, 'execution');

  console.log('  ✓ <state_check> tags parsed with accuracy for both VALID and INVALID_TRANSITION');
  console.log('  PASSED: Test T7.\n');

  console.log('🎉 ALL DAY 15 CONTROLLED STATE TRANSITIONS TESTS PASSED SUCCESSFULLY!\n');
}

// Direct execution when invoked via tsx
runDay15TransitionsTests().catch((err) => {
  console.error('❌ Day 15 Transitions Test Suite Failed:', err);
  process.exit(1);
});
