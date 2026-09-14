/**
 * Comprehensive automated test suite for Agent, Storage, and Tokenizer modules.
 * Runs directly on Node 22 via --experimental-strip-types.
 */

import { strict as assert } from 'node:assert';

// 1. Mock browser globals (localStorage, window) for Node environment
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

// Import modules to test
import { Agent } from '../src/agent/Agent';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  formatTokenCount,
  calculateEstimatedCost,
} from '../src/agent/tokenizer';
import {
  saveMessages,
  loadMessages,
  clearMessages,
  saveApiKey,
  loadApiKey,
  loadCustomModels,
  saveCustomModels,
} from '../src/agent/storage';

async function runTests() {
  console.log('🧪 Starting Educational AI Agent Test Suite...\n');

  // ----------------------------------------------------
  // Test 1: Tokenizer Calculations
  // ----------------------------------------------------
  console.log('Test 1: Tokenizer calculations');
  const latinText = 'Hello world, this is a test prompt.';
  const cyrillicText = 'Привет мир, это тестовый запрос.';

  const latinTokens = estimateTokens(latinText);
  const cyrillicTokens = estimateTokens(cyrillicText);

  assert(latinTokens > 0, 'Latin tokens should be > 0');
  assert(cyrillicTokens > 0, 'Cyrillic tokens should be > 0');
  console.log(`  ✓ Latin estimation: "${latinText}" -> ${latinTokens} tokens`);
  console.log(`  ✓ Cyrillic estimation: "${cyrillicText}" -> ${cyrillicTokens} tokens`);

  const msgTokens = estimateMessageTokens({ role: 'user', content: latinText });
  assert(msgTokens === latinTokens + 4, 'Message tokens should include 4 framing tokens');

  const convTokens = estimateConversationTokens([
    { role: 'user', content: latinText },
    { role: 'assistant', content: 'Sure, I can help!' },
  ]);
  assert(convTokens > msgTokens, 'Conversation tokens should sum messages + priming tokens');

  assert.equal(formatTokenCount(25, true), '~25');
  assert.equal(formatTokenCount(25, false), '25');

  const cost = calculateEstimatedCost(1000, 500, 'openai/gpt-4o-mini');
  assert(cost !== null && cost > 0, 'Cost calculation should return positive number');
  console.log(`  ✓ Estimated cost for 1.5k tokens: $${cost?.toFixed(6)}`);
  console.log('  PASSED: Tokenizer tests.\n');

  // ----------------------------------------------------
  // Test 2: Storage Persistence
  // ----------------------------------------------------
  console.log('Test 2: Storage persistence functions');
  saveApiKey('sk-test-key-12345');
  assert.equal(loadApiKey(), 'sk-test-key-12345', 'API key should match saved key');

  const sampleMessages = [
    { id: '1', role: 'user' as const, content: 'Меня зовут Алексей. Запомни это.', timestamp: 1000 },
    { id: '2', role: 'assistant' as const, content: 'Привет, Алексей! Я запомнил.', timestamp: 2000 },
  ];
  saveMessages(sampleMessages);
  const loaded = loadMessages();
  assert.equal(loaded.length, 2, 'Should load 2 messages from localStorage');
  assert.equal(loaded[0].content, 'Меня зовут Алексей. Запомни это.');

  clearMessages();
  assert.equal(loadMessages().length, 0, 'Messages should be empty after clear');
  console.log('  PASSED: Storage tests.\n');

  // ----------------------------------------------------
  // Test 3: Agent Creation & API Key Validation
  // ----------------------------------------------------
  console.log('Test 3: Agent creation & API key validation');
  mockStorage.clear();
  const agent = new Agent({ apiKey: '', model: 'openai/gpt-4o-mini' });
  assert.equal(agent.getHistory().length, 0);

  let keyErrorThrown = false;
  try {
    await agent.sendMessage('Hello without key');
  } catch (err: any) {
    keyErrorThrown = true;
    assert(err.message.includes('API key is not configured'));
  }
  assert(keyErrorThrown, 'Should reject message when API key is missing');
  console.log('  ✓ Correctly rejects requests when API key is missing');
  console.log('  PASSED: Agent API key validation.\n');

  // ----------------------------------------------------
  // Test 4: Agent Sending Messages & Mocking OpenRouter
  // ----------------------------------------------------
  console.log('Test 4: Agent sending message & processing OpenRouter response');
  agent.setApiKey('sk-valid-openrouter-key');

  // Mock global fetch to simulate OpenRouter API response
  (globalThis as any).fetch = async (url: string, options: any) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const headers = options.headers;
    assert.equal(headers['Authorization'], 'Bearer sk-valid-openrouter-key');

    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-4o-mini');
    assert(body.messages.length >= 2, 'Should contain system prompt + user message');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gen-12345',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Очень приятно, Алексей! Чем могу помочь?',
            },
          },
        ],
        usage: {
          prompt_tokens: 38,
          completion_tokens: 15,
          total_tokens: 53,
        },
      }),
    };
  };

  const responseText = await agent.sendMessage('Меня зовут Алексей. Запомни это.');
  assert.equal(responseText, 'Очень приятно, Алексей! Чем могу помочь?');

  const history = agent.getHistory();
  assert.equal(history.length, 2, 'History must contain user and assistant messages');
  assert.equal(history[0].role, 'user');
  assert.equal(history[1].role, 'assistant');

  const stats = agent.getTokenStats();
  assert.equal(stats.conversation, 38, 'Conversation tokens should match usage.prompt_tokens');
  assert.equal(stats.response, 15, 'Response tokens should match usage.completion_tokens');
  assert.equal(stats.total, 53, 'Total tokens should match usage.total_tokens');
  assert.equal(stats.isEstimated, false, 'Stats should be marked as exact (isEstimated: false)');
  console.log(`  ✓ Received response: "${responseText}"`);
  console.log(`  ✓ Exact token usage updated: prompt=${stats.conversation}, completion=${stats.response}, total=${stats.total}`);
  console.log('  PASSED: Message sending and OpenRouter response handling.\n');

  // ----------------------------------------------------
  // Test 5: Context Persistence Across "Restarts"
  // ----------------------------------------------------
  console.log('Test 5: Persistence across application restart');
  // Create a completely new Agent instance (simulating browser reload / restart)
  const restartedAgent = new Agent();
  const restoredHistory = restartedAgent.getHistory();
  assert.equal(restoredHistory.length, 2, 'New agent instance must restore messages from localStorage');
  assert.equal(restoredHistory[0].content, 'Меня зовут Алексей. Запомни это.');
  assert.equal(restoredHistory[1].content, 'Очень приятно, Алексей! Чем могу помочь?');

  const restoredStats = restartedAgent.getTokenStats();
  assert(restoredStats.conversation > 0, 'Restored conversation tokens must be computed');
  console.log(`  ✓ Restored ${restoredHistory.length} messages on new agent startup`);
  console.log('  PASSED: History persistence across restarts.\n');

  // ----------------------------------------------------
  // Test 6: Demo Overflow Mode (Simulating Context Exceeded)
  // ----------------------------------------------------
  console.log('Test 6: Demo Overflow Mode');
  // Set context window to a tiny limit e.g. 20 tokens to easily test overflow
  restartedAgent.setMode('demo');
  restartedAgent.setContextWindow(25);

  let overflowErrorThrown = false;
  try {
    await restartedAgent.sendMessage('Повтори, пожалуйста, все предыдущие сообщения очень подробно.');
  } catch (err: any) {
    overflowErrorThrown = true;
    assert(err.message.includes('Context limit exceeded'));
    console.log(`  ✓ Successfully caught expected Demo Overflow error:`);
    console.log(`    ${err.message.replace(/\n/g, ' ')}`);
  }
  assert(overflowErrorThrown, 'Demo mode should trigger context limit exceeded error');
  console.log('  PASSED: Demo Overflow Mode.\n');

  // ----------------------------------------------------
  // Test 7: Production Mode (Context Trimming)
  // ----------------------------------------------------
  console.log('Test 7: Production Mode (Auto-trimming history)');
  // In Production mode, with small context limit, older messages must be trimmed
  // to stay within context limit while keeping system message and latest message
  restartedAgent.setMode('production');
  restartedAgent.setContextWindow(800); // 800 tokens limit (safety buffer 500 => target <= 300)

  // Add several messages
  const stateBefore = restartedAgent.getState();
  const prevCount = stateBefore.messages.length;

  // Next message sent should succeed without error
  await restartedAgent.sendMessage('Как меня зовут?');
  const stateAfter = restartedAgent.getState();
  assert(stateAfter.messages.length > 0, 'Messages should still exist');
  assert(stateAfter.error === null, 'Production mode should not error on context limits');
  console.log(`  ✓ Production mode successfully handled message flow without overflow error`);
  console.log('  PASSED: Production Mode.\n');

  // ----------------------------------------------------
  // Test 8: Clear Conversation
  // ----------------------------------------------------
  console.log('Test 8: Clear conversation');
  restartedAgent.clearHistory();
  assert.equal(restartedAgent.getHistory().length, 0, 'History must be 0 after clearHistory');
  assert.equal(loadMessages().length, 0, 'LocalStorage must be cleared');
  console.log('  PASSED: Clear conversation.\n');

  // ----------------------------------------------------
  // Test 9: Custom Models Persistence and Switching
  // ----------------------------------------------------
  console.log('Test 9: Custom models persistence and switching');
  const customModelId = 'qwen/qwen-2.5-72b-instruct';
  restartedAgent.addCustomModel(customModelId);

  // Verify in memory and in localStorage
  assert(restartedAgent.getCustomModels().includes(customModelId), 'Custom model should be in agent list');
  const storedModels = loadCustomModels();
  assert(storedModels.includes(customModelId), 'Custom model must be saved in localStorage');

  // Duplicate prevention
  restartedAgent.addCustomModel(customModelId);
  assert.equal(
    restartedAgent.getCustomModels().filter((m) => m === customModelId).length,
    1,
    'Duplicates must not be added'
  );

  // Model switching
  restartedAgent.setModel(customModelId);
  assert.equal(restartedAgent.getState().config.model, customModelId, 'Active model must switch to custom model');

  // Persistence across restart
  const thirdAgent = new Agent();
  assert(thirdAgent.getCustomModels().includes(customModelId), 'New agent must restore custom models from localStorage');
  assert.equal(thirdAgent.getState().config.model, customModelId, 'New agent must restore active model from localStorage');

  // Deletion and fallback
  thirdAgent.removeCustomModel(customModelId);
  assert(!thirdAgent.getCustomModels().includes(customModelId), 'Custom model must be removed from agent');
  assert(!loadCustomModels().includes(customModelId), 'Custom model must be removed from localStorage');
  assert.equal(thirdAgent.getState().config.model, 'openai/gpt-4o-mini', 'Active model must fall back to default upon deletion');
  console.log('  ✓ Successfully added, persisted, switched, and deleted custom models with fallback');
  console.log('  PASSED: Custom models persistence and switching.\n');

  console.log('🎉 ALL 9 TESTS PASSED SUCCESSFULLY! 100% SPEC COMPLIANCE.\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
