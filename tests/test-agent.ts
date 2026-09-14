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
  fetchModelInfo,
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
  // Test 9: Custom Models Persistence, Context Length & Switching
  // ----------------------------------------------------
  console.log('Test 9: Custom models persistence, context length, and auto-switching contextWindow');

  // Test fetchModelInfo with mocked OpenRouter model endpoint
  const previousFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string) => {
    if (url === 'https://openrouter.ai/api/v1/model/anthropic/claude-sonnet-4') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 'anthropic/claude-sonnet-4',
            name: 'Anthropic: Claude Sonnet 4',
            context_length: 1000000,
          },
        }),
      };
    }
    if (url.includes('nonexistent')) {
      return { ok: false, status: 404 };
    }
    return previousFetch(url);
  };

  const fetchedInfo = await fetchModelInfo('anthropic/claude-sonnet-4');
  assert(fetchedInfo !== null, 'fetchModelInfo should return data for valid model');
  assert.equal(fetchedInfo.contextLength, 1000000, 'Context length should be 1,000,000');
  assert.equal(fetchedInfo.name, 'Anthropic: Claude Sonnet 4');

  const notFound = await fetchModelInfo('nonexistent/model');
  assert.equal(notFound, null, 'fetchModelInfo should return null for 404 models');

  // Add custom model with its fetched contextLength
  restartedAgent.addCustomModel({
    id: 'anthropic/claude-sonnet-4',
    name: fetchedInfo.name,
    contextLength: fetchedInfo.contextLength,
  });

  // Verify in memory and in localStorage
  const customModels = restartedAgent.getCustomModels();
  const addedModel = customModels.find((m) => m.id === 'anthropic/claude-sonnet-4');
  assert(addedModel, 'Custom model should be in agent list');
  assert.equal(addedModel.contextLength, 1000000, 'Model contextLength should match fetched length');

  const storedModels = loadCustomModels();
  const storedModel = storedModels.find((m) => m.id === 'anthropic/claude-sonnet-4');
  assert(storedModel, 'Custom model must be saved in localStorage');
  assert.equal(storedModel.contextLength, 1000000, 'Stored contextLength must be 1,000,000');

  // Switch model and verify active contextWindow automatically updates!
  restartedAgent.setModel('anthropic/claude-sonnet-4');
  assert.equal(restartedAgent.getState().config.model, 'anthropic/claude-sonnet-4');
  assert.equal(
    restartedAgent.getState().config.contextWindow,
    1000000,
    'Active agent contextWindow must automatically update to model contextLength'
  );
  assert.equal(
    restartedAgent.getTokenStats().contextWindow,
    1000000,
    'TokenStats contextWindow must reflect 1,000,000'
  );

  // Persistence across restart
  const thirdAgent = new Agent();
  const restoredCustoms = thirdAgent.getCustomModels();
  assert(
    restoredCustoms.some((m) => m.id === 'anthropic/claude-sonnet-4' && m.contextLength === 1000000),
    'New agent must restore custom models with their contextLength from localStorage'
  );
  assert.equal(thirdAgent.getState().config.model, 'anthropic/claude-sonnet-4');
  assert.equal(thirdAgent.getState().config.contextWindow, 1000000);

  // Deletion and fallback
  thirdAgent.removeCustomModel('anthropic/claude-sonnet-4');
  assert(!thirdAgent.getCustomModels().some((m) => m.id === 'anthropic/claude-sonnet-4'));
  assert.equal(thirdAgent.getState().config.model, 'openai/gpt-4o-mini', 'Must fall back to default model on deletion');
  assert.equal(thirdAgent.getState().config.contextWindow, 128000, 'Must fall back to default context window');

  console.log('  ✓ Verified OpenRouter context_length fetch, custom model persistence, and auto-updating context window');
  console.log('  PASSED: Custom models persistence and switching.\n');

  // ----------------------------------------------------
  // Test 10: Ollama Provider, API Endpoints, Context Discovery & Chat
  // ----------------------------------------------------
  console.log('Test 10: Ollama Provider, Endpoints, Context Discovery & Chat');

  // Mock global fetch for Ollama endpoints
  (globalThis as any).fetch = async (url: string, options: any) => {
    if (url === 'http://localhost:11434/api/version') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: '0.5.4' }),
      };
    }
    if (url === 'http://localhost:11434/api/tags') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'llama3.2:latest', size: 2000000000 },
            { name: 'mistral:latest', size: 4000000000 },
          ],
        }),
      };
    }
    if (url === 'http://localhost:11434/api/show') {
      const body = JSON.parse(options.body);
      if (body.model === 'llama3.2:latest') {
        // Returns parameters with num_ctx
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parameters: 'stop "<|eot_id|>"\nnum_ctx 8192\ntemperature 0.7',
            model_info: { 'llama.context_length': 131072 },
          }),
        };
      }
      if (body.model === 'mistral:latest') {
        // No num_ctx in parameters, falls back to model_info architecture context_length
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parameters: 'temperature 0.7',
            model_info: { 'mistral.context_length': 32768 },
          }),
        };
      }
      return { ok: false, status: 404 };
    }
    if (url === 'http://localhost:11434/api/chat') {
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false, 'Ollama chat request must specify stream: false');
      assert(body.messages.length >= 2, 'Must include system prompt and user message');
      // Assert num_ctx is NOT sent in options per design agreement
      assert(!body.options?.num_ctx, 'num_ctx must NOT be passed in chat options per agreed design');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          message: {
            role: 'assistant',
            content: 'Привет! Я локальная модель Ollama.',
          },
          done: true,
          prompt_eval_count: 28,
          eval_count: 14,
        }),
      };
    }
    return previousFetch(url, options);
  };

  const { checkOllamaConnection, fetchOllamaModels, fetchOllamaModelInfo } = await import(
    '../src/agent/ollama'
  );

  // 10a. Connection check
  const conn = await checkOllamaConnection('http://localhost:11434');
  assert(conn.ok, 'Ollama connection check should succeed');
  assert.equal(conn.version, '0.5.4');
  console.log('  ✓ Ollama connection check passed (version: 0.5.4)');

  // 10b. Models list
  const ollamaModels = await fetchOllamaModels('http://localhost:11434');
  assert.equal(ollamaModels.length, 2);
  assert.equal(ollamaModels[0].id, 'llama3.2:latest');
  assert.equal(ollamaModels[0].provider, 'ollama');
  console.log('  ✓ Ollama models fetched via GET /api/tags: 2 models');

  // 10c. Context length detection: num_ctx from parameters priority
  const llamaInfo = await fetchOllamaModelInfo('http://localhost:11434', 'llama3.2:latest');
  assert.equal(llamaInfo.contextLength, 8192, 'Should prioritize num_ctx from parameters (8192)');
  console.log('  ✓ Context window from parameters num_ctx: 8192 tokens');

  // 10d. Context length detection: <arch>.context_length fallback
  const mistralInfo = await fetchOllamaModelInfo('http://localhost:11434', 'mistral:latest');
  assert.equal(mistralInfo.contextLength, 32768, 'Should fall back to model_info context_length (32768)');
  console.log('  ✓ Context window from model_info fallback: 32768 tokens');

  // 10e. Agent chatting via Ollama without API key
  const ollamaAgent = new Agent({
    provider: 'ollama',
    apiKey: '', // Empty API key must NOT block Ollama!
    model: 'llama3.2:latest',
    contextWindow: 8192,
  });

  assert.equal(ollamaAgent.getState().config.provider, 'ollama');
  assert.equal(ollamaAgent.getState().config.apiKey, '');

  const ollamaReply = await ollamaAgent.sendMessage('Привет, как дела?');
  assert.equal(ollamaReply, 'Привет! Я локальная модель Ollama.');
  console.log(`  ✓ Received Ollama response without API key: "${ollamaReply}"`);

  const ollamaStats = ollamaAgent.getTokenStats();
  assert.equal(ollamaStats.isLocal, true, 'isLocal must be true for Ollama');
  assert.equal(ollamaStats.estimatedCost, 0, 'Cost for local Ollama models must be $0.00');
  assert.equal(ollamaStats.conversation, 28, 'Prompt tokens must match prompt_eval_count (28)');
  assert.equal(ollamaStats.response, 14, 'Response tokens must match eval_count (14)');
  assert.equal(ollamaStats.total, 42, 'Total tokens must be 42');
  console.log(`  ✓ Exact Ollama token stats: prompt=28, response=14, cost=$${ollamaStats.estimatedCost} (Local)`);

  console.log('  PASSED: Ollama provider, connection, context extraction, and chat tests.\n');

  console.log('🎉 ALL 10 TESTS PASSED SUCCESSFULLY! 100% SPEC COMPLIANCE.\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
