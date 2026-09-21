/**
 * Automated test suite for Task State Machine (Day 13):
 * 1. Initial Task State (FSM) in Working Memory
 * 2. Stage transitions: idle -> planning -> execution -> validation -> done
 * 3. Step tracking and expected action updates
 * 4. Pause at any stage and resume without re-explaining
 * 5. Prompt injection of [TASK STATE MACHINE] section
 * 6. Autonomous model update tag parsing (<task_update ... />)
 * 7. Multi-chat FSM isolation & localStorage persistence
 */

import { strict as assert } from 'node:assert';

// Mock browser globals (localStorage, window) for Node environment
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
import { loadWorkingMemory } from '../src/agent/storage';

export async function runTaskFsmTests() {
  console.log('\n🔥 Starting Day 13: Task State Machine (FSM) Test Suite...\n');

  // Clear mock storage
  mockStorage.clear();

  // ----------------------------------------------------
  // Test F1: Initial Task State
  // ----------------------------------------------------
  console.log('Test F1: Initial task state defaults in Working Memory');
  const agent1 = new Agent('chat-fsm-1');
  const state1 = agent1.getTaskState();

  assert.equal(state1.stage, 'idle', 'Default stage must be idle');
  assert.equal(state1.currentStepIndex, 0, 'Default step index must be 0');
  assert.equal(state1.expectedAction, '', 'Default expected action must be empty');
  assert.equal(state1.isPaused, false, 'Default isPaused must be false');
  console.log('  ✓ Initial state verified: idle, step=0, isPaused=false');
  console.log('  PASSED: Test F1.\n');

  // ----------------------------------------------------
  // Test F2: Stage transitions
  // ----------------------------------------------------
  console.log('Test F2: Stage transitions (idle -> planning -> plan_approved -> execution -> validation -> done)');
  agent1.setTaskStage('planning', 'Декомпозировать требования к сервису');
  assert.equal(agent1.getTaskState().stage, 'planning');
  assert.equal(agent1.getTaskState().expectedAction, 'Декомпозировать требования к сервису');
  agent1.addPlanItem('Шаг 1: Подготовить архитектуру');

  agent1.approvePlan('План утвержден');
  assert.equal(agent1.getTaskState().stage, 'plan_approved');

  agent1.setTaskStage('execution', 'Написать хэндлер авторизации');
  assert.equal(agent1.getTaskState().stage, 'execution');
  assert.equal(agent1.getTaskState().expectedAction, 'Написать хэндлер авторизации');

  agent1.setTaskStage('validation', 'Проверить покрытие тестами и lint');
  assert.equal(agent1.getTaskState().stage, 'validation');

  agent1.setTaskStage('done', 'Задача завершена');
  assert.equal(agent1.getTaskState().stage, 'done');
  console.log('  ✓ All stages transitioned and verified successfully');
  console.log('  PASSED: Test F2.\n');

  // ----------------------------------------------------
  // Test F3: Step and Expected Action Tracking
  // ----------------------------------------------------
  console.log('Test F3: Step tracking and expected action synchronization with plan');
  agent1.clearWorkingMemory();
  agent1.setWorkingGoal('Создать сервис платежей');
  agent1.addPlanItem('Шаг 1: Описать схему БД транзакций');
  agent1.addPlanItem('Шаг 2: Реализовать интеграцию с платежным шлюзом');
  agent1.addPlanItem('Шаг 3: Написать тесты для идемпотентности');

  agent1.setTaskStage('execution', undefined, true);
  agent1.setTaskStep(1, 'Реализовать вызов POST /v1/charges');

  const updatedState = agent1.getTaskState();
  assert.equal(updatedState.currentStepIndex, 1);
  assert.equal(updatedState.currentStepTitle, 'Шаг 2: Реализовать интеграцию с платежным шлюзом');
  assert.equal(updatedState.expectedAction, 'Реализовать вызов POST /v1/charges');
  console.log('  ✓ Step index 1 linked to plan item and expected action');
  console.log('  PASSED: Test F3.\n');

  // ----------------------------------------------------
  // Test F4: Pause and Resume Mechanics (Без повторных объяснений)
  // ----------------------------------------------------
  console.log('Test F4: Pause at any stage and resume without re-explaining');
  // 1. Pause
  agent1.pauseTask();
  assert.equal(agent1.getTaskState().isPaused, true, 'Task must be paused');

  let promptWhilePaused = agent1.formatWorkingMemoryPrompt();
  assert.ok(promptWhilePaused.includes('[TASK STATE MACHINE]'), 'Context must contain TASK STATE MACHINE');
  assert.ok(promptWhilePaused.includes('PAUSED'), 'Prompt must indicate PAUSED status');
  assert.ok(
    promptWhilePaused.includes('The task is currently PAUSED'),
    'Prompt must instruct model to wait during pause'
  );

  // 2. Resume (manual trigger without auto-message)
  await agent1.resumeTask(false);
  assert.equal(agent1.getTaskState().isPaused, false, 'Task must be unpaused');

  let promptWhileActive = agent1.formatWorkingMemoryPrompt();
  assert.ok(promptWhileActive.includes('ACTIVE'), 'Prompt must indicate ACTIVE status');
  assert.ok(
    promptWhileActive.includes('NEVER restart or re-explain previous steps'),
    'Prompt must strictly mandate resuming directly without re-explaining'
  );
  assert.ok(
    promptWhileActive.includes('Expected Action: Реализовать вызов POST /v1/charges'),
    'Prompt must contain the expected action'
  );
  console.log('  ✓ Pause and resume directives accurately reflected in agent context');
  console.log('  PASSED: Test F4.\n');

  // ----------------------------------------------------
  // Test F5: Autonomous Model Tag Parsing (<task_update ... />)
  // ----------------------------------------------------
  console.log('Test F5: Autonomous model tag parsing (<task_update ... />)');
  const tag1 = '<task_update stage="validation" step="3" action="Запустить go test ./..." />';
  const parsed1 = agent1.parseTaskUpdateTags(tag1);
  assert.ok(parsed1, 'Tag must be successfully parsed');
  assert.equal(parsed1.stage, 'validation');
  assert.equal(parsed1.currentStepIndex, 2, 'Step 3 in 1-based format must map to index 2');
  assert.equal(parsed1.expectedAction, 'Запустить go test ./...');

  // Apply parsed tag
  agent1.updateTaskState(parsed1);
  assert.equal(agent1.getTaskState().stage, 'validation');
  assert.equal(agent1.getTaskState().currentStepIndex, 2);
  assert.equal(agent1.getTaskState().expectedAction, 'Запустить go test ./...');

  // Test tag with pause
  const tag2 = '<task_update paused="true" action="Ожидание ревью кода" />';
  const parsed2 = agent1.parseTaskUpdateTags(tag2);
  assert.ok(parsed2);
  assert.equal(parsed2.isPaused, true);
  assert.equal(parsed2.expectedAction, 'Ожидание ревью кода');
  console.log('  ✓ Autonomous <task_update> tags parsed and applied correctly');
  console.log('  PASSED: Test F5.\n');

  // ----------------------------------------------------
  // Test F6: Multi-Chat Isolation and Storage Persistence
  // ----------------------------------------------------
  console.log('Test F6: Multi-chat FSM isolation & localStorage persistence');
  const agentChatA = new Agent('chat-fsm-A');
  const agentChatB = new Agent('chat-fsm-B');

  agentChatA.setTaskStage('execution', 'Выполнить шаг А', true);
  agentChatA.setTaskStep(2);
  agentChatA.pauseTask();

  agentChatB.setTaskStage('planning', 'Составить план Б');
  agentChatB.setTaskStep(0);

  // Verify isolation in memory
  assert.equal(agentChatA.getTaskState().stage, 'execution');
  assert.equal(agentChatA.getTaskState().isPaused, true);
  assert.equal(agentChatA.getTaskState().currentStepIndex, 2);

  assert.equal(agentChatB.getTaskState().stage, 'planning');
  assert.equal(agentChatB.getTaskState().isPaused, false);
  assert.equal(agentChatB.getTaskState().currentStepIndex, 0);

  // Verify persistence across restart
  const restoredAgentA = new Agent('chat-fsm-A');
  const restoredStateA = restoredAgentA.getTaskState();
  assert.equal(restoredStateA.stage, 'execution');
  assert.equal(restoredStateA.isPaused, true);
  assert.equal(restoredStateA.currentStepIndex, 2);
  assert.equal(restoredStateA.expectedAction, 'Выполнить шаг А');

  const loadedMemA = loadWorkingMemory('chat-fsm-A');
  assert.equal(loadedMemA.taskState.stage, 'execution');
  assert.equal(loadedMemA.taskState.isPaused, true);

  console.log('  ✓ Full FSM isolation between chats and persistent restore verified');
  console.log('  PASSED: Test F6.\n');

  // ----------------------------------------------------
  // Test F7: Deterministic Fallback State Advancement
  // ----------------------------------------------------
  console.log('Test F7: Deterministic fallback state advancement (advanceTaskStateAutomatically)');
  const agentAuto = new Agent('chat-fsm-auto');
  agentAuto.setWorkingGoal('Автономная сборка микросервиса');
  agentAuto.addPlanItem('Шаг 1: Конфигурация');
  agentAuto.addPlanItem('Шаг 2: Хэндлеры');
  agentAuto.setTaskStage('planning');

  // Planning -> Plan Approved
  agentAuto.advanceTaskStateAutomatically();
  assert.equal(agentAuto.getTaskState().stage, 'plan_approved');

  // Plan Approved -> Execution step 0
  agentAuto.advanceTaskStateAutomatically();
  assert.equal(agentAuto.getTaskState().stage, 'execution');
  assert.equal(agentAuto.getTaskState().currentStepIndex, 0);

  // Execution step 0 -> step 1
  agentAuto.advanceTaskStateAutomatically();
  assert.equal(agentAuto.getTaskState().stage, 'execution');
  assert.equal(agentAuto.getTaskState().currentStepIndex, 1);
  assert.equal(agentAuto.getWorkingMemory().plan[0].done, true, 'Step 0 must be marked done');

  // Execution step 1 -> validation
  agentAuto.advanceTaskStateAutomatically();
  assert.equal(agentAuto.getTaskState().stage, 'validation');
  assert.equal(agentAuto.getWorkingMemory().plan[1].done, true, 'Step 1 must be marked done');

  // Validation -> done
  agentAuto.advanceTaskStateAutomatically();
  assert.equal(agentAuto.getTaskState().stage, 'done');
  console.log('  ✓ Deterministic FSM step-by-step advancement verified without tags');
  console.log('  PASSED: Test F7.\n');

  // ----------------------------------------------------
  // Test F8: Pause Interception and Instant Loop Halt
  // ----------------------------------------------------
  console.log('Test F8: Pause interception and instant auto-run loop halt');
  const agentLoop = new Agent('chat-fsm-loop');
  agentLoop.setWorkingGoal('Фоновый воркер');
  agentLoop.setTaskStage('execution', 'Выполнять тяжелую задачу', true);
  agentLoop.startAutoExecution();

  assert.equal(agentLoop.isTaskAutoRunning(), true, 'isAutoRunning must be true after start');
  assert.equal(agentLoop.getTaskState().isPaused, false, 'isPaused must be false');

  // Intercept with pause
  agentLoop.pauseTask();
  assert.equal(agentLoop.isTaskAutoRunning(), false, 'isAutoRunning must immediately become false on pause');
  assert.equal(agentLoop.getTaskState().isPaused, true, 'isPaused must be true on pause');
  console.log('  ✓ Pause successfully halted auto-run execution loop');
  console.log('  PASSED: Test F8.\n');

  // ----------------------------------------------------
  // Test F9: Resume and Auto-Run Restart Without Re-Explaining
  // ----------------------------------------------------
  console.log('Test F9: Resume and auto-run restart preserving exact step & expected action');
  agentLoop.setTaskStep(2, 'Валидировать кэш сессий');
  assert.equal(agentLoop.getTaskState().isPaused, true);

  await agentLoop.resumeTask(true);
  assert.equal(agentLoop.getTaskState().isPaused, false, 'Pause removed on resume');
  assert.equal(agentLoop.isTaskAutoRunning(), true, 'Auto-run restarted on resume');
  assert.equal(agentLoop.getTaskState().currentStepIndex, 2, 'Step index preserved exactly');
  assert.equal(agentLoop.getTaskState().expectedAction, 'Валидировать кэш сессий', 'Expected action preserved');

  agentLoop.stopAutoExecution();
  console.log('  ✓ Resumption successfully restarts auto-run without losing current step or re-explaining');
  console.log('  PASSED: Test F9.\n');

  console.log('🎉 ALL DAY 13 TASK STATE MACHINE TESTS PASSED SUCCESSFULLY!\n');
}

// Direct execution when invoked via tsx
runTaskFsmTests().catch((err) => {
  console.error('❌ Task FSM Test Suite Failed:', err);
  process.exit(1);
});
