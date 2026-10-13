/**
 * Automated test suite for Conversation Undo / Rollback functionality.
 * Tests undoing full conversational turns, lone user messages,
 * empty history handling, multi-branch isolation, and localStorage persistence.
 */

import { strict as assert } from 'node:assert';

// 1. Mock browser globals for Node test environment
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
import { Message } from '../src/agent/types';

async function runUndoTests() {
  console.log('\n======================================================');
  console.log('↩️ Starting Undo / Rollback Last Turn Test Suite...');
  console.log('======================================================\n');

  // --- Test T1: Undo on empty conversation ---
  console.log('--- Test T1: Undo on Empty Conversation ---');
  {
    mockStorage.clear();
    const agent = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, 'test-undo-chat-1');
    agent.clearHistory();

    const result = agent.undoLastTurn();
    assert.strictEqual(result, null, 'Undo on empty history must return null');
    assert.strictEqual(agent.getState().messages.length, 0, 'Messages length must remain 0');
    console.log('✅ Test T1 Passed: Safe null return on empty history.');
  }

  // --- Test T2: Undo full turn (User + Assistant) ---
  console.log('\n--- Test T2: Undo Full Conversational Turn (User + Assistant) ---');
  {
    mockStorage.clear();
    const agent = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, 'test-undo-chat-2');
    agent.clearHistory();

    const initialTokens = agent.getState().tokenStats.conversation;

    const userMsg: Message = {
      id: 'msg-u1',
      role: 'user',
      content: 'Какая погода в Москве?',
      timestamp: Date.now(),
      tokens: 15,
    };
    const assistantMsg: Message = {
      id: 'msg-a1',
      role: 'assistant',
      content: 'В Москве солнечно, около +18°C.',
      timestamp: Date.now() + 100,
      tokens: 22,
    };

    // Inject messages into agent
    (agent as any).messages = [userMsg, assistantMsg];
    (agent as any).recalculateCurrentStats();

    assert.strictEqual(agent.getState().messages.length, 2);
    assert.ok(agent.getState().tokenStats.conversation > initialTokens);

    const promptReturned = agent.undoLastTurn();
    assert.strictEqual(promptReturned, 'Какая погода в Москве?', 'Must return the original user prompt text');
    assert.strictEqual(agent.getState().messages.length, 0, 'Both user and assistant messages must be removed');
    assert.strictEqual(agent.getState().tokenStats.conversation, initialTokens, 'Conversation tokens must reset to baseline');
    console.log('✅ Test T2 Passed: Full turn cleanly rolled back and user prompt text returned.');
  }

  // --- Test T3: Sequential undo across multiple turns ---
  console.log('\n--- Test T3: Sequential Undo Across Multiple Turns ---');
  {
    mockStorage.clear();
    const agent = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, 'test-undo-chat-3');
    agent.clearHistory();

    const turn1User: Message = { id: 'u1', role: 'user', content: 'Шаг 1: Вопрос', timestamp: 1000 };
    const turn1Assistant: Message = { id: 'a1', role: 'assistant', content: 'Шаг 1: Ответ', timestamp: 1100 };
    const turn2User: Message = { id: 'u2', role: 'user', content: 'Шаг 2: Вопрос', timestamp: 2000 };
    const turn2Assistant: Message = { id: 'a2', role: 'assistant', content: 'Шаг 2: Ответ', timestamp: 2100 };

    (agent as any).messages = [turn1User, turn1Assistant, turn2User, turn2Assistant];
    (agent as any).recalculateCurrentStats();

    // 1. Undo turn 2
    const undone2 = agent.undoLastTurn();
    assert.strictEqual(undone2, 'Шаг 2: Вопрос');
    assert.strictEqual(agent.getState().messages.length, 2);
    assert.strictEqual(agent.getState().messages[0].id, 'u1');
    assert.strictEqual(agent.getState().messages[1].id, 'a1');

    // 2. Undo turn 1
    const undone1 = agent.undoLastTurn();
    assert.strictEqual(undone1, 'Шаг 1: Вопрос');
    assert.strictEqual(agent.getState().messages.length, 0);

    // 3. Undo on empty
    const undoneEmpty = agent.undoLastTurn();
    assert.strictEqual(undoneEmpty, null);

    console.log('✅ Test T3 Passed: Sequential multi-turn undo preserves chronological order.');
  }

  // --- Test T4: Undo lone user message ---
  console.log('\n--- Test T4: Undo Lone User Message ---');
  {
    mockStorage.clear();
    const agent = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, 'test-undo-chat-4');
    agent.clearHistory();

    const loneUserMsg: Message = { id: 'u-lone', role: 'user', content: 'Одиночное сообщение', timestamp: 1000 };
    (agent as any).messages = [loneUserMsg];
    (agent as any).recalculateCurrentStats();

    assert.strictEqual(agent.getState().messages.length, 1);

    const undonePrompt = agent.undoLastTurn();
    assert.strictEqual(undonePrompt, 'Одиночное сообщение');
    assert.strictEqual(agent.getState().messages.length, 0);

    console.log('✅ Test T4 Passed: Lone user message safely removed and text returned.');
  }

  // --- Test T5: Persistence to localStorage ---
  console.log('\n--- Test T5: Persistence Across Agent Re-initialization ---');
  {
    mockStorage.clear();
    const chatId = 'test-undo-chat-5';
    const agent1 = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, chatId);
    agent1.clearHistory();

    const u1: Message = { id: 'u1', role: 'user', content: 'Первый', timestamp: 1000 };
    const a1: Message = { id: 'a1', role: 'assistant', content: 'Ответ 1', timestamp: 1100 };
    const u2: Message = { id: 'u2', role: 'user', content: 'Второй', timestamp: 2000 };
    const a2: Message = { id: 'a2', role: 'assistant', content: 'Ответ 2', timestamp: 2100 };

    (agent1 as any).messages = [u1, a1, u2, a2];
    (agent1 as any).branches[0].messages = [u1, a1, u2, a2];
    agent1.undoLastTurn(); // Undoes turn 2

    // Re-instantiate agent with the same chatId
    const agent2 = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, chatId);
    assert.strictEqual(agent2.getState().messages.length, 2, 'Restored history must contain only turn 1');
    assert.strictEqual(agent2.getState().messages[0].id, 'u1');
    assert.strictEqual(agent2.getState().messages[1].id, 'a1');

    console.log('✅ Test T5 Passed: Undone state persisted to localStorage correctly.');
  }

  // --- Test T6: Multi-Branch Undo Isolation ---
  console.log('\n--- Test T6: Multi-Branch Isolation on Undo ---');
  {
    mockStorage.clear();
    const chatId = 'test-undo-chat-6';
    const agent = new Agent({ apiKey: 'test-key', provider: 'openrouter' }, chatId);
    agent.clearHistory();

    // In Main branch, add turn 1
    const u1: Message = { id: 'u1', role: 'user', content: 'Ветка Главная', timestamp: 1000 };
    const a1: Message = { id: 'a1', role: 'assistant', content: 'Ответ Главная', timestamp: 1100 };
    (agent as any).messages = [u1, a1];
    (agent as any).branches[0].messages = [u1, a1];

    // Create Branch 2
    agent.createBranch('Эксперимент', 'a1');
    const branch2Id = agent.getState().activeBranchId;
    assert.notStrictEqual(branch2Id, 'main');

    // Add turn in Branch 2
    const u2: Message = { id: 'u2', role: 'user', content: 'Ветка 2 Вопрос', timestamp: 2000 };
    const a2: Message = { id: 'a2', role: 'assistant', content: 'Ветка 2 Ответ', timestamp: 2100 };
    (agent as any).messages = [u1, a1, u2, a2];
    const b2Idx = (agent as any).branches.findIndex((b: any) => b.id === branch2Id);
    (agent as any).branches[b2Idx].messages = [u1, a1, u2, a2];

    // Undo on Branch 2
    const undonePrompt = agent.undoLastTurn();
    assert.strictEqual(undonePrompt, 'Ветка 2 Вопрос');
    assert.strictEqual(agent.getState().messages.length, 2, 'Branch 2 should have 2 messages');

    // Switch back to Main branch and verify it remained intact
    agent.switchBranch('main');
    assert.strictEqual(agent.getState().messages.length, 2, 'Main branch history remained intact');
    assert.strictEqual(agent.getState().messages[0].content, 'Ветка Главная');

    console.log('✅ Test T6 Passed: Undo is strictly isolated to the active branch.');
  }

  console.log('\n🎉 ALL UNDO / ROLLBACK TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runUndoTests().catch((err) => {
  console.error('❌ Undo tests failed:', err);
  process.exit(1);
});
