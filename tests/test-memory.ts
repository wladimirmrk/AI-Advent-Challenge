/**
 * Automated test suite for Agent Memory Layers (Week 3):
 * 1. Layer Isolation & Storage Scopes (Working memory per-chat vs Long-Term global)
 * 2. Explicit Memory Routing (routeMemoryItem)
 * 3. Layered LLM Context Construction (System -> Long-Term -> Working -> Short-Term)
 * 4. Token Breakdown by Memory Layer
 * 5. Influence on Prompt & Agent Responses
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
import {
  loadWorkingMemory,
  saveWorkingMemory,
  clearWorkingMemory,
  loadLongTermMemory,
  saveLongTermMemory,
  clearLongTermMemory,
  loadMessages,
  saveMessages,
} from '../src/agent/storage';

export async function runMemoryTests() {
  console.log('\n🧠 Starting Agent Memory Layers Test Suite (Week 3)...\n');

  // Clear mock storage
  mockStorage.clear();

  // ----------------------------------------------------
  // Test M1: Storage Isolation (Working Memory per-chat)
  // ----------------------------------------------------
  console.log('Test M1: Working Memory chat isolation');
  const agentChat1 = new Agent('chat-1');
  const agentChat2 = new Agent('chat-2');

  agentChat1.setWorkingGoal('Task 1: Implement OAuth2 login');
  agentChat1.addPlanItem('Design DB schema');
  agentChat1.addPlanItem('Implement token verification');
  agentChat1.updateScratchpad('Use JWT RS256 algorithm');

  agentChat2.setWorkingGoal('Task 2: Optimize SQL queries');
  agentChat2.addPlanItem('Add indexes to users table');
  agentChat2.updateScratchpad('Check slow query log');

  const wm1 = agentChat1.getWorkingMemory();
  const wm2 = agentChat2.getWorkingMemory();

  assert.equal(wm1.goal, 'Task 1: Implement OAuth2 login');
  assert.equal(wm1.plan.length, 2);
  assert.equal(wm1.scratchpad, 'Use JWT RS256 algorithm');

  assert.equal(wm2.goal, 'Task 2: Optimize SQL queries');
  assert.equal(wm2.plan.length, 1);
  assert.equal(wm2.scratchpad, 'Check slow query log');

  // Verify direct storage persistence under isolated keys
  const directWM1 = loadWorkingMemory('chat-1');
  const directWM2 = loadWorkingMemory('chat-2');
  assert.equal(directWM1.goal, 'Task 1: Implement OAuth2 login');
  assert.equal(directWM2.goal, 'Task 2: Optimize SQL queries');

  console.log('  ✓ Chat 1 and Chat 2 maintain strictly isolated Working Memories');
  console.log('  PASSED: Test M1.\n');

  // ----------------------------------------------------
  // Test M2: Global Scope of Long-Term Memory
  // ----------------------------------------------------
  console.log('Test M2: Long-Term Memory global sharing across chats');
  agentChat1.updateUserProfile({
    name: 'Алексей Архитектор',
    role: 'Staff Engineer',
    preferences: ['concise code', 'TypeScript strict', 'microservices'],
    customNotes: 'Prefers hexagonal architecture',
  });

  agentChat1.addDecision(
    'Architecture: Microservices with gRPC',
    'High throughput and type-safe RPC contracts across polyglot services'
  );

  agentChat1.addKnowledge('AuthServicePort', 'Internal port is 50051', ['backend', 'networking']);

  // Check from agentChat2 (which is in a completely different chat 'chat-2')
  const ltmFromChat2 = agentChat2.getLongTermMemory();
  assert.equal(ltmFromChat2.profile.name, 'Алексей Архитектор');
  assert.equal(ltmFromChat2.profile.role, 'Staff Engineer');
  assert.deepEqual(ltmFromChat2.profile.preferences, ['concise code', 'TypeScript strict', 'microservices']);
  assert.equal(ltmFromChat2.decisions.length, 1);
  assert.equal(ltmFromChat2.decisions[0].title, 'Architecture: Microservices with gRPC');
  assert.equal(ltmFromChat2.knowledge.length, 1);
  assert.equal(ltmFromChat2.knowledge[0].key, 'AuthServicePort');

  console.log('  ✓ Long-Term Memory updated in Chat 1 is immediately accessible in Chat 2');
  console.log('  PASSED: Test M2.\n');

  // ----------------------------------------------------
  // Test M3: Explicit Memory Routing (routeMemoryItem)
  // ----------------------------------------------------
  console.log('Test M3: Explicit Memory Routing (routeMemoryItem)');
  const routingAgent = new Agent('routing-chat');

  // Route to Working Memory (Plan item)
  routingAgent.routeMemoryItem('working', {
    text: 'Write integration tests for payments',
    category: 'plan',
  });
  const routedWM = routingAgent.getWorkingMemory();
  assert(
    routedWM.plan.some((p) => p.text === 'Write integration tests for payments'),
    'Plan item should be added to working memory'
  );

  // Route to Long-Term Memory (Decision)
  routingAgent.routeMemoryItem('long_term', {
    title: 'Database choice: PostgreSQL',
    rationale: 'ACID compliance and JSONB flexibility',
    category: 'decision',
    text: 'PostgreSQL for primary store',
  });
  const routedLTM = routingAgent.getLongTermMemory();
  assert(
    routedLTM.decisions.some((d) => d.title === 'Database choice: PostgreSQL'),
    'Decision should be added to long-term memory'
  );

  // Route to Long-Term Memory (Knowledge)
  routingAgent.routeMemoryItem('long_term', {
    key: 'StripeWebhookSecret',
    text: 'Stored in AWS Secrets Manager as /prod/stripe/key',
    category: 'knowledge',
    tags: ['stripe', 'payments'],
  });
  const updatedLTM = routingAgent.getLongTermMemory();
  assert(
    updatedLTM.knowledge.some((k) => k.key === 'StripeWebhookSecret'),
    'Knowledge item should be added to long-term memory'
  );

  console.log('  ✓ Explicit routing correctly distributed items to working and long-term memory');
  console.log('  PASSED: Test M3.\n');

  // ----------------------------------------------------
  // Test M4: Layered Context Construction (Prompt Composition)
  // ----------------------------------------------------
  console.log('Test M4: Layered Context Construction');
  const agent = new Agent('context-chat', {
    systemPrompt: 'You are an elite software assistant.',
    apiKey: 'sk-test-key',
  });

  agent.setWorkingGoal('Refactor billing ledger');
  agent.addPlanItem('Step 1: Audit double entry consistency');
  agent.updateScratchpad('Do not drop production tables!');

  // Add dummy short-term messages
  const dummyMessages = [
    { id: '1', role: 'user' as const, content: 'Привет, давай начнем работу.', timestamp: 1000 },
    { id: '2', role: 'assistant' as const, content: 'Привет! Я готов. Каков наш план?', timestamp: 2000 },
  ];
  saveMessages(dummyMessages, 'context-chat');
  agent.loadHistory();

  const prepared = agent.getPreparedMessages(
    agent.getHistory(),
    { role: 'user', content: 'Какой у нас текущий шаг?' }
  );

  // 1. First message must be System Prompt
  assert.equal(prepared[0].role, 'system');
  assert.equal(prepared[0].content, 'You are an elite software assistant.');

  // 2. Second message must be Long-Term Memory section
  assert.equal(prepared[1].role, 'system');
  assert(
    prepared[1].content.includes('[LONG-TERM MEMORY: USER PROFILE & ESTABLISHED KNOWLEDGE]'),
    'Should include Long-Term Memory header'
  );
  assert(prepared[1].content.includes('Алексей Архитектор'), 'Should include user profile name');
  assert(prepared[1].content.includes('Architecture: Microservices with gRPC'), 'Should include decisions');

  // 3. Third message must be Working Memory section
  assert.equal(prepared[2].role, 'system');
  assert(
    prepared[2].content.includes('[WORKING MEMORY: CURRENT TASK CONTEXT]'),
    'Should include Working Memory header'
  );
  assert(prepared[2].content.includes('Current Task Goal: Refactor billing ledger'));
  assert(prepared[2].content.includes('Step 1: Audit double entry consistency'));
  assert(prepared[2].content.includes('Do not drop production tables!'));

  // 4. Following messages must be Short-Term dialogue messages
  assert.equal(prepared[3].role, 'user');
  assert.equal(prepared[3].content, 'Привет, давай начнем работу.');
  assert.equal(prepared[4].role, 'assistant');
  assert.equal(prepared[4].content, 'Привет! Я готов. Каков наш план?');
  assert.equal(prepared[5].role, 'user');
  assert.equal(prepared[5].content, 'Какой у нас текущий шаг?');

  console.log('  ✓ System -> Long-Term -> Working -> Short-Term sequence strictly maintained in LLM context');
  console.log('  PASSED: Test M4.\n');

  // ----------------------------------------------------
  // Test M5: Token Breakdown by Memory Layer
  // ----------------------------------------------------
  console.log('Test M5: Token breakdown by memory layer');
  const breakdown = agent.getMemoryTokensBreakdown();

  assert(breakdown.systemTokens > 0, 'System tokens should be > 0');
  assert(breakdown.longTermTokens > 0, 'Long-term tokens should be > 0');
  assert(breakdown.workingTokens > 0, 'Working tokens should be > 0');
  assert(breakdown.shortTermTokens > 0, 'Short-term tokens should be > 0');
  assert.equal(
    breakdown.totalContextTokens,
    breakdown.systemTokens + breakdown.longTermTokens + breakdown.workingTokens + breakdown.shortTermTokens,
    'Total tokens should equal sum of all 4 layers'
  );

  console.log(`  ✓ Breakdown: System=${breakdown.systemTokens}, LongTerm=${breakdown.longTermTokens}, Working=${breakdown.workingTokens}, ShortTerm=${breakdown.shortTermTokens}, Total=${breakdown.totalContextTokens}`);
  console.log('  PASSED: Test M5.\n');

  // ----------------------------------------------------
  // Test M6: Selective layer clearing
  // ----------------------------------------------------
  console.log('Test M6: Selective layer clearing');
  // Clear only working memory of context-chat
  agent.clearWorkingMemory();
  const wmAfterClear = agent.getWorkingMemory();
  assert.equal(wmAfterClear.goal, '');
  assert.equal(wmAfterClear.plan.length, 0);

  // Long-Term memory must remain intact!
  const ltmAfterWmClear = agent.getLongTermMemory();
  assert.equal(ltmAfterWmClear.profile.name, 'Алексей Архитектор');
  assert(ltmAfterWmClear.decisions.length > 0);

  // Short-Term messages must remain intact!
  assert.equal(agent.getHistory().length, 2);

  console.log('  ✓ Clearing Working Memory did not affect Long-Term or Short-Term memories');
  console.log('  PASSED: Test M6.\n');

  console.log('🎉 ALL MEMORY LAYER TESTS PASSED SUCCESSFULLY!\n');
}

// Run standalone if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('test-memory.ts')) {
  runMemoryTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}
