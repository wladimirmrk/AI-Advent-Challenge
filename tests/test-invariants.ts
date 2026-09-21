/**
 * Automated test suite for Assistant Invariants & State Constraints (Day 14):
 * 1. Storage isolation from dialogue & initial Day 14 preset
 * 2. Invariants CRUD operations & activation toggling
 * 3. System prompt compilation & context injection
 * 4. Token breakdown tracking for invariants layer
 * 5. Parsing of explicit reasoning tag <invariant_check>
 * 6. Conflict simulation & structured refusal verification
 * 7. Cross-chat persistence & isolation
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
import { DEFAULT_INVARIANTS } from '../src/agent/storage';

export async function runInvariantsTests() {
  console.log('\n🔥 Starting Day 14: Invariants & State Constraints Test Suite...\n');

  // Clear mock storage
  mockStorage.clear();

  // ----------------------------------------------------
  // Test INV-1: Initial Preset & Storage Isolation
  // ----------------------------------------------------
  console.log('Test INV-1: Storage isolation from dialogue & default Day 14 preset');
  const agent1 = new Agent('chat-inv-1');
  agent1.resetInvariantsToDefault();
  const invariants1 = agent1.getInvariants();

  assert.equal(invariants1.length, 4, 'Must initialize with 4 default invariants');
  assert.ok(invariants1.some((i) => i.category === 'architecture'), 'Must have Architecture invariant');
  assert.ok(invariants1.some((i) => i.category === 'stack'), 'Must have Tech Stack invariant');
  assert.ok(invariants1.some((i) => i.category === 'technical_decision'), 'Must have Technical Decision (ADR) invariant');
  assert.ok(invariants1.some((i) => i.category === 'business_rule'), 'Must have Business Rule invariant');

  // Verify stored in independent key
  const rawStorage = mockStorage.get('agent_invariants');
  assert.ok(rawStorage, 'Invariants must be persisted under agent_invariants key');

  // Clear messages in chat-inv-1 and ensure invariants are untouched
  agent1.clearHistory();
  const invariantsAfterClear = agent1.getInvariants();
  assert.equal(invariantsAfterClear.length, 4, 'Clearing chat messages must NOT affect invariants');
  console.log('  ✓ Invariants are stored independently from dialogue history and persist after chat clearing');
  console.log('  PASSED: Test INV-1.\n');

  // ----------------------------------------------------
  // Test INV-2: CRUD & Activation Toggling
  // ----------------------------------------------------
  console.log('Test INV-2: Invariants CRUD operations & activation toggling');
  const customInv = agent1.addInvariant({
    category: 'business_rule',
    title: 'GDPR: Право на забвение',
    description: 'Все персональные данные пользователя должны полностью удаляться по первому требованию.',
    isActive: true,
  });

  assert.equal(agent1.getInvariants().length, 5, 'Must have 5 invariants after addition');
  assert.equal(customInv.title, 'GDPR: Право на забвение');

  // Toggle inactive
  const toggled = agent1.toggleInvariant(customInv.id);
  assert.ok(toggled, 'toggleInvariant must return true');
  const updatedInv = agent1.getInvariants().find((i) => i.id === customInv.id);
  assert.equal(updatedInv?.isActive, false, 'Invariant must be inactive after toggle');

  // Update invariant
  agent1.updateInvariant(customInv.id, {
    description: 'Обновленное описание GDPR правила',
  });
  const updatedInv2 = agent1.getInvariants().find((i) => i.id === customInv.id);
  assert.equal(updatedInv2?.description, 'Обновленное описание GDPR правила');

  // Delete invariant
  const deleted = agent1.deleteInvariant(customInv.id);
  assert.ok(deleted, 'deleteInvariant must return true');
  assert.equal(agent1.getInvariants().length, 4, 'Must return to 4 invariants after delete');

  // Reset to default
  agent1.resetInvariantsToDefault();
  assert.equal(agent1.getInvariants().length, DEFAULT_INVARIANTS.length);
  console.log('  ✓ Add, update, toggle, delete and resetToDefault work correctly');
  console.log('  PASSED: Test INV-2.\n');

  // ----------------------------------------------------
  // Test INV-3: Context Assembly & System Prompt Injection
  // ----------------------------------------------------
  console.log('Test INV-3: Context assembly & prompt injection');
  const prompt = agent1.formatInvariantsPrompt();

  assert.ok(prompt.includes('[CRITICAL MANDATE: SYSTEM INVARIANTS & HARD CONSTRAINTS (DAY 14)]'), 'Prompt must contain mandate header');
  assert.ok(prompt.includes('Гексагональная архитектура'), 'Prompt must list Hexagonal Architecture');
  assert.ok(prompt.includes('Go 1.22 + gRPC/Protobuf + PostgreSQL'), 'Prompt must list Stack');
  assert.ok(prompt.includes('ADR-004'), 'Prompt must list ADR-004');
  assert.ok(prompt.includes('Argon2id'), 'Prompt must list Argon2id');
  assert.ok(prompt.includes('<invariant_check>'), 'Prompt must specify <invariant_check> reasoning format');
  assert.ok(prompt.includes('status: PASS | CONFLICT'), 'Prompt must require PASS/CONFLICT status');

  // Check prepared messages
  const prepared = agent1.getPreparedMessages([]);
  const invariantSysMsg = prepared.find((m) => m.content.includes('[CRITICAL MANDATE: SYSTEM INVARIANTS'));
  assert.ok(invariantSysMsg, 'Prepared messages must include invariants system message');

  // Token breakdown
  const breakdown = agent1.getMemoryTokensBreakdown();
  assert.ok(breakdown.invariantsTokens > 0, 'Invariants layer must contribute to token breakdown');
  assert.ok(breakdown.totalContextTokens >= breakdown.invariantsTokens, 'Total tokens must include invariantsTokens');
  console.log(`  ✓ Prompt generated correctly, invariantsTokens = ~${breakdown.invariantsTokens}`);
  console.log('  PASSED: Test INV-3.\n');

  // ----------------------------------------------------
  // Test INV-4: Inactive Invariants Exclusion
  // ----------------------------------------------------
  console.log('Test INV-4: Inactive invariants are excluded from prompt injection');
  const stackInv = agent1.getInvariants().find((i) => i.category === 'stack')!;
  agent1.toggleInvariant(stackInv.id); // disable stack invariant

  const promptWithDisabled = agent1.formatInvariantsPrompt();
  assert.ok(!promptWithDisabled.includes('Go 1.22 + gRPC/Protobuf + PostgreSQL'), 'Disabled invariant must NOT appear in prompt');

  // Re-enable
  agent1.toggleInvariant(stackInv.id);
  const promptReEnabled = agent1.formatInvariantsPrompt();
  assert.ok(promptReEnabled.includes('Go 1.22 + gRPC/Protobuf + PostgreSQL'), 'Re-enabled invariant must appear in prompt');
  console.log('  ✓ Only active invariants are injected into LLM prompt');
  console.log('  PASSED: Test INV-4.\n');

  // ----------------------------------------------------
  // Test INV-5: Parsing of <invariant_check> Tags
  // ----------------------------------------------------
  console.log('Test INV-5: Parsing of <invariant_check> reasoning tags');
  const samplePassMessage = `<invariant_check>
status: PASS
violated: none
analysis: Запрос соответствует выбранному стеку Go и протоколу gRPC.
</invariant_check>
Вот пример реализации сервиса на Go...`;

  const sampleConflictMessage = `<invariant_check>
status: CONFLICT
violated: Технологический стек: Go 1.22 + gRPC/Protobuf + PostgreSQL
analysis: Запрос требует реализацию бэкенда на Python FastAPI и MongoDB, что запрещено активным инвариантом.
</invariant_check>
🛑 **Отказ: Нарушение инварианта "Технологический стек: Go 1.22 + gRPC/Protobuf + PostgreSQL"**
🔍 **Причина отказа:** В проекте утвержден технологический стек Go + gRPC + PostgreSQL.
💡 **Рекомендуемая альтернатива:** Предлагаю реализовать аналогичный эндпоинт на Go с gRPC handlers.`;

  // Parser verification logic (same regex as in MessageList)
  function testParse(content: string) {
    const match = content.match(/<invariant_check>([\s\S]*?)<\/invariant_check>/i);
    assert.ok(match, 'Must match <invariant_check> block');
    const inner = match[1];
    const isConflict = /status:\s*CONFLICT/i.test(inner);
    const violatedMatch = inner.match(/violated:\s*([^\r\n]+)/i);
    const violated = violatedMatch ? violatedMatch[1].trim() : '';
    const cleaned = content.replace(match[0], '').trim();
    return { isConflict, violated, cleaned };
  }

  const parsedPass = testParse(samplePassMessage);
  assert.equal(parsedPass.isConflict, false, 'Should parse as PASS');
  assert.equal(parsedPass.violated, 'none');
  assert.ok(parsedPass.cleaned.startsWith('Вот пример реализации'));

  const parsedConflict = testParse(sampleConflictMessage);
  assert.equal(parsedConflict.isConflict, true, 'Should parse as CONFLICT');
  assert.ok(parsedConflict.violated.includes('Технологический стек'));
  assert.ok(parsedConflict.cleaned.includes('Отказ: Нарушение инварианта'));
  console.log('  ✓ <invariant_check> parser successfully handles PASS and CONFLICT states');
  console.log('  PASSED: Test INV-5.\n');

  // ----------------------------------------------------
  // Test INV-6: Multi-chat Persistence
  // ----------------------------------------------------
  console.log('Test INV-6: Cross-chat persistence of invariants');
  // Add a persistent rule in chat A
  agent1.addInvariant({
    category: 'architecture',
    title: 'Zero Direct Database Access from Handlers',
    description: 'HTTP/gRPC хэндлеры не имеют права делать прямые SQL-запросы в обход репозиториев.',
    isActive: true,
  });

  // Open brand new chat B with fresh Agent instance
  const agent2 = new Agent('chat-inv-2');
  const invariantsChat2 = agent2.getInvariants();

  assert.ok(
    invariantsChat2.some((i) => i.title === 'Zero Direct Database Access from Handlers'),
    'Invariants added in one chat must be globally present in any new chat'
  );
  console.log('  ✓ Invariants are truly global and shared across all chat instances');
  console.log('  PASSED: Test INV-6.\n');

  console.log('🎉 ALL DAY 14 INVARIANTS TESTS PASSED SUCCESSFULLY!\n');
}

// Execute tests when run directly
runInvariantsTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
