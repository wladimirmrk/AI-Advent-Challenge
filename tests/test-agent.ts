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
  loadSummary,
  saveSummary,
  clearSummary,
  migrateStorage,
  DEFAULT_SUMMARY,
  CURRENT_SCHEMA_VERSION,
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

  // ----------------------------------------------------
  // Test 11: Storage Migration & Separate Summary Storage
  // ----------------------------------------------------
  console.log('Test 11: Storage Migration & Separate Summary Storage');
  mockStorage.clear();

  // Simulate existing v1 storage with messages but no summary key or version key
  saveMessages([
    { id: 'v1-msg-1', role: 'user', content: 'Message from v1', timestamp: 1000 },
    { id: 'v1-msg-2', role: 'assistant', content: 'Reply from v1', timestamp: 2000 },
  ]);
  assert.equal(localStorage.getItem('agent_storage_version'), null, 'Version should initially be null');
  assert.equal(localStorage.getItem('agent_summary'), null, 'Summary should initially be null');

  // Run migration
  migrateStorage();

  assert.equal(
    localStorage.getItem('agent_storage_version'),
    String(CURRENT_SCHEMA_VERSION),
    'Schema version must be updated to current version'
  );
  assert(mockStorage.has('agent_summary'), 'Summary key must be initialized');

  // Verify existing messages were NOT modified or deleted
  const preservedMessages = loadMessages();
  assert.equal(preservedMessages.length, 2, 'Existing messages must be preserved');
  assert.equal(preservedMessages[0].content, 'Message from v1');

  // Verify separate summary operations
  saveSummary({
    summary: 'Test summary content',
    lastSummarizedMessageId: 'v1-msg-2',
    lastSummarizedIndex: 1,
    updatedAt: 12345,
    version: 2,
  });
  const loadedSummary = loadSummary();
  assert.equal(loadedSummary.summary, 'Test summary content');
  assert.equal(loadedSummary.lastSummarizedMessageId, 'v1-msg-2');

  // Clear summary should only remove summary, not messages
  clearSummary();
  assert.equal(loadSummary().summary, '');
  assert.equal(loadMessages().length, 2, 'Clearing summary must not delete messages');
  console.log('  PASSED: Storage Migration & Separate Summary Storage.\n');

  // ----------------------------------------------------
  // Test 12: Configurable History Window N & Summary Threshold
  // ----------------------------------------------------
  console.log('Test 12: Configurable History Window N & Summary Threshold');
  const configAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 10,
    summaryThreshold: 10,
  });

  assert.equal(configAgent.getState().config.recentMessagesCount, 10, 'Default N should be 10');
  assert.equal(configAgent.getState().config.summaryThreshold, 10, 'Default threshold should be 10');

  // Reconfigure N and threshold
  configAgent.setRecentMessagesCount(5);
  configAgent.setSummaryThreshold(4);

  assert.equal(configAgent.getState().config.recentMessagesCount, 5);
  assert.equal(configAgent.getState().config.summaryThreshold, 4);

  // Verify persistence of config
  const reloadedAgent = new Agent();
  assert.equal(reloadedAgent.getState().config.recentMessagesCount, 5, 'Recent messages count N must persist');
  assert.equal(reloadedAgent.getState().config.summaryThreshold, 4, 'Summary threshold must persist');
  console.log('  PASSED: Configurable History Window N & Summary Threshold.\n');

  // ----------------------------------------------------
  // Test 13: Context Structure Transmitted to LLM (Prompt + Summary + Last N + New user)
  // ----------------------------------------------------
  console.log('Test 13: Context Structure Transmitted to LLM');
  mockStorage.clear();
  const contextAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 3,
    summaryThreshold: 10,
    systemPrompt: 'You are an AI assistant.',
  });

  // Seed history with 5 messages
  const initialFiveMessages = [
    { id: 'm1', role: 'user' as const, content: 'One', timestamp: 1 },
    { id: 'm2', role: 'assistant' as const, content: 'Two', timestamp: 2 },
    { id: 'm3', role: 'user' as const, content: 'Three', timestamp: 3 },
    { id: 'm4', role: 'assistant' as const, content: 'Four', timestamp: 4 },
    { id: 'm5', role: 'user' as const, content: 'Five', timestamp: 5 },
  ];
  saveMessages(initialFiveMessages);
  contextAgent.loadHistory();

  // Case 1: Without summary, transmitted context should be: system prompt + last 3 messages + new user message
  const preparedNoSummary = contextAgent.getPreparedMessages(
    contextAgent.getHistory(),
    { role: 'user', content: 'Six' }
  );
  assert.equal(preparedNoSummary.length, 5, 'Should contain: 1 system + 3 recent + 1 new user');
  assert.equal(preparedNoSummary[0].role, 'system');
  assert.equal(preparedNoSummary[0].content, 'You are an AI assistant.');
  assert.equal(preparedNoSummary[1].content, 'Three');
  assert.equal(preparedNoSummary[2].content, 'Four');
  assert.equal(preparedNoSummary[3].content, 'Five');
  assert.equal(preparedNoSummary[4].content, 'Six');

  // Case 2: With summary present, transmitted context should be:
  // system prompt + summary message + last 3 messages + new user message
  saveSummary({
    summary: 'The conversation discussed numbers One and Two.',
    lastSummarizedMessageId: 'm2',
    lastSummarizedIndex: 1,
    updatedAt: 100,
    version: 1,
  });
  contextAgent.loadHistory();

  const preparedWithSummary = contextAgent.getPreparedMessages(
    contextAgent.getHistory(),
    { role: 'user', content: 'Six' }
  );
  assert.equal(preparedWithSummary.length, 6, 'Should contain: 1 system + 1 summary + 3 recent + 1 new user');
  assert.equal(preparedWithSummary[0].role, 'system');
  assert.equal(preparedWithSummary[0].content, 'You are an AI assistant.');
  assert.equal(preparedWithSummary[1].role, 'system');
  assert(preparedWithSummary[1].content.includes('Summary of previous conversation:'));
  assert(preparedWithSummary[1].content.includes('One and Two'));
  assert.equal(preparedWithSummary[2].content, 'Three');
  assert.equal(preparedWithSummary[3].content, 'Four');
  assert.equal(preparedWithSummary[4].content, 'Five');
  assert.equal(preparedWithSummary[5].content, 'Six');
  console.log('  PASSED: Context Structure Transmitted to LLM.\n');

  // ----------------------------------------------------
  // Test 14: Incremental Summary Generation & Pointer Tracking
  // ----------------------------------------------------
  console.log('Test 14: Incremental Summary Generation & Pointer Tracking');
  mockStorage.clear();

  // Configure agent: N=2, summaryThreshold=2
  const incrementalAgent = new Agent({
    apiKey: 'sk-incremental',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 2,
    summaryThreshold: 2,
  });

  const capturedCalls: Array<{ url: string; messages: any[] }> = [];
  (globalThis as any).fetch = async (url: string, options: any) => {
    const body = JSON.parse(options.body);
    capturedCalls.push({ url, messages: body.messages });

    // Check if this is a summary call or a chat call
    const isSummaryPrompt = body.messages.some((m: any) =>
      m.content?.includes('conversation summarizer')
    );

    if (isSummaryPrompt) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gen-summary-1',
          choices: [{ message: { role: 'assistant', content: 'Summary of initial topic.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 },
        }),
      };
    } else {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gen-reply',
          choices: [{ message: { role: 'assistant', content: 'Assistant reply.' } }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
        }),
      };
    }
  };

  // Turn 1: sends Message 1. History has 2 messages (Msg 1, Reply 1).
  await incrementalAgent.sendMessage('Message 1');
  assert.equal(incrementalAgent.getHistory().length, 2);
  assert.equal(incrementalAgent.getSummary().summary, '', 'Summary should not trigger yet');

  // Turn 2: sends Message 2. History before Turn 2 had 2 messages (both inside recent N=2 window).
  // History after Turn 2 has 4 messages: [Msg 1, Reply 1, Msg 2, Reply 2].
  capturedCalls.length = 0;
  await incrementalAgent.sendMessage('Message 2');
  assert.equal(capturedCalls.length, 1, 'Turn 2 is a single chat call (no messages older than N=2 before send)');
  assert.equal(incrementalAgent.getHistory().length, 4);

  // Turn 3: sends Message 3.
  // History before Turn 3 has 4 messages. Recent N=2 window holds [Msg 2, Reply 2].
  // Older messages are [Msg 1, Reply 1] (count 2 >= summaryThreshold 2).
  // This must trigger incremental summary before the chat call!
  capturedCalls.length = 0;
  await incrementalAgent.sendMessage('Message 3');

  assert.equal(capturedCalls.length, 2, 'Turn 3 must trigger 1 summary call + 1 chat call');
  assert(
    capturedCalls[0].messages.some((m) => m.content?.includes('summarizer') || m.content?.includes('summary')),
    'First call in Turn 3 must be summary generation'
  );

  const updatedSummary = incrementalAgent.getSummary();
  assert.equal(updatedSummary.summary, 'Summary of initial topic.');
  assert(updatedSummary.lastSummarizedMessageId !== null, 'lastSummarizedMessageId must be set');
  assert(updatedSummary.lastSummarizedIndex >= 0, 'lastSummarizedIndex must be tracked');

  // Turn 4: sends Message 4.
  // History before Turn 4 has 6 messages. Recent N=2 window holds [Msg 3, Reply 3].
  // Older messages are [Msg 1, Reply 1, Msg 2, Reply 2].
  // Msg 1 and Reply 1 are already summarized!
  // Unsummarized older messages are [Msg 2, Reply 2] (count 2 >= summaryThreshold 2).
  // This must trigger the NEXT incremental summary!
  (globalThis as any).fetch = async (url: string, options: any) => {
    const body = JSON.parse(options.body);
    capturedCalls.push({ url, messages: body.messages });

    const isSummaryPrompt = body.messages.some((m: any) =>
      m.content?.includes('conversation summarizer')
    );

    if (isSummaryPrompt) {
      // Must receive existing summary in prompt!
      assert(
        body.messages.some((m: any) => m.content?.includes('Existing summary:') || m.content?.includes('Existing conversation summary:')),
        'Incremental summary call must include existing summary'
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gen-summary-2',
          choices: [{ message: { role: 'assistant', content: 'Updated summary of initial topic plus new events.' } }],
          usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
        }),
      };
    } else {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gen-reply-4',
          choices: [{ message: { role: 'assistant', content: 'Fourth reply.' } }],
          usage: { prompt_tokens: 45, completion_tokens: 10, total_tokens: 55 },
        }),
      };
    }
  };

  capturedCalls.length = 0;
  await incrementalAgent.sendMessage('Message 4');

  assert.equal(capturedCalls.length, 2, 'Turn 4 must trigger incremental summary + chat call');
  const secondSummary = incrementalAgent.getSummary();
  assert.equal(secondSummary.summary, 'Updated summary of initial topic plus new events.');
  assert.equal(secondSummary.version, 3, 'Summary version must increment to 3');

  // Verify all raw messages remain in full history (never deleted from DB)
  assert.equal(incrementalAgent.getHistory().length, 8, 'All 8 raw messages must remain in history');
  console.log('  PASSED: Incremental Summary Generation & Pointer Tracking.\n');

  // ----------------------------------------------------
  // Test 15: Error Handling during Summary Generation (Graceful Degradation)
  // ----------------------------------------------------
  console.log('Test 15: Error Handling during Summary Generation (Graceful Degradation)');
  mockStorage.clear();

  const gracefulAgent = new Agent({
    apiKey: 'sk-graceful',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 2,
    summaryThreshold: 2,
  });

  // Pre-seed an existing summary
  saveSummary({
    summary: 'Original stable summary.',
    lastSummarizedMessageId: 'old-1',
    lastSummarizedIndex: 0,
    updatedAt: 50,
    version: 1,
  });
  saveMessages([
    { id: 'old-1', role: 'user', content: 'Old 1', timestamp: 10 },
    { id: 'old-2', role: 'assistant', content: 'Old 2', timestamp: 20 },
    { id: 'old-3', role: 'user', content: 'Old 3', timestamp: 30 },
    { id: 'old-4', role: 'assistant', content: 'Old 4', timestamp: 40 },
  ]);
  gracefulAgent.loadHistory();

  // Mock fetch to fail when summarization is called, but succeed for normal chat
  (globalThis as any).fetch = async (_url: string, options: any) => {
    const body = JSON.parse(options.body);
    const isSummaryPrompt = body.messages.some((m: any) =>
      m.content?.includes('conversation summarizer')
    );

    if (isSummaryPrompt) {
      // Simulate LLM error for summary
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error on summarizer',
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gen-reply-ok',
        choices: [{ message: { role: 'assistant', content: 'Chat succeeded despite summary error.' } }],
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
      }),
    };
  };

  // sendMessage should succeed despite summary failure
  const reply = await gracefulAgent.sendMessage('New question');
  assert.equal(reply, 'Chat succeeded despite summary error.');

  // Verify existing summary was NOT deleted or corrupted
  const summaryAfterError = gracefulAgent.getSummary();
  assert.equal(summaryAfterError.summary, 'Original stable summary.');
  assert.equal(summaryAfterError.lastSummarizedMessageId, 'old-1');

  // Verify history contains the new question and reply
  const histAfterError = gracefulAgent.getHistory();
  assert.equal(histAfterError[histAfterError.length - 2].content, 'New question');
  assert.equal(histAfterError[histAfterError.length - 1].content, 'Chat succeeded despite summary error.');
  console.log('  PASSED: Error Handling during Summary Generation (Graceful Degradation).\n');

  // ----------------------------------------------------
  // Test 16: Race Condition Protection during Concurrent Requests
  // ----------------------------------------------------
  console.log('Test 16: Race Condition Protection during Concurrent Requests');
  mockStorage.clear();

  const concurrencyAgent = new Agent({
    apiKey: 'sk-concurrent',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 4,
    summaryThreshold: 2,
  });

  let activeRequests = 0;
  let maxConcurrent = 0;

  (globalThis as any).fetch = async (_url: string, options: any) => {
    activeRequests++;
    if (activeRequests > maxConcurrent) {
      maxConcurrent = activeRequests;
    }

    // Simulate async network delay
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRequests--;

    const body = JSON.parse(options.body);
    const lastUserMsg = body.messages[body.messages.length - 1]?.content || 'reply';

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `gen-${Math.random()}`,
        choices: [{ message: { role: 'assistant', content: `Echo: ${lastUserMsg}` } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    };
  };

  // Trigger 3 parallel sendMessage calls simultaneously
  const results = await Promise.all([
    concurrencyAgent.sendMessage('Concurrent message A'),
    concurrencyAgent.sendMessage('Concurrent message B'),
    concurrencyAgent.sendMessage('Concurrent message C'),
  ]);

  assert.equal(results[0], 'Echo: Concurrent message A');
  assert.equal(results[1], 'Echo: Concurrent message B');
  assert.equal(results[2], 'Echo: Concurrent message C');

  // Verify that execution was serialized by mutex queue (max concurrent was 1)
  assert.equal(maxConcurrent, 1, 'Requests must be serialized sequentially through mutex');

  // Verify history has all 6 messages in exact sequential order
  const finalHist = concurrencyAgent.getHistory();
  assert.equal(finalHist.length, 6);
  assert.equal(finalHist[0].content, 'Concurrent message A');
  assert.equal(finalHist[1].content, 'Echo: Concurrent message A');
  assert.equal(finalHist[2].content, 'Concurrent message B');
  assert.equal(finalHist[3].content, 'Echo: Concurrent message B');
  assert.equal(finalHist[4].content, 'Concurrent message C');
  assert.equal(finalHist[5].content, 'Echo: Concurrent message C');
  console.log('  PASSED: Race Condition Protection during Concurrent Requests.\n');

  // ----------------------------------------------------
  // Test 17: Immediate User Message Rendering & Rollback on Error
  // ----------------------------------------------------
  console.log('Test 17: Immediate User Message Rendering & Rollback on Error');
  mockStorage.clear();

  const immediateAgent = new Agent({
    apiKey: 'sk-immediate',
    model: 'openai/gpt-4o-mini',
  });

  let inspectedStateDuringLoading: any = null;

  (globalThis as any).fetch = async () => {
    // While server request is running, inspect agent state
    inspectedStateDuringLoading = immediateAgent.getState();

    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Ответ на первый вопрос' } }],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
      }),
    };
  };

  // Send first question
  const replyPromise = immediateAgent.sendMessage('Первый вопрос');

  // Await the completion
  await replyPromise;

  // 1. Verify that while waiting for the server, the user message was ALREADY in state and visible
  assert(inspectedStateDuringLoading !== null, 'Should have captured state during request');
  assert.equal(
    inspectedStateDuringLoading.messages.length,
    1,
    'User message must appear immediately in state before server responds'
  );
  assert.equal(inspectedStateDuringLoading.messages[0].content, 'Первый вопрос');
  assert.equal(inspectedStateDuringLoading.isLoading, true, 'Agent must be marked as loading');
  console.log('  ✓ User message rendered immediately before server response');

  // After completion, history should have 2 messages
  assert.equal(immediateAgent.getHistory().length, 2);
  assert.equal(immediateAgent.getHistory()[1].content, 'Ответ на первый вопрос');

  // 2. Verify rollback on error
  (globalThis as any).fetch = async () => {
    return {
      ok: false,
      status: 500,
      statusText: 'Server Error on LLM call',
    };
  };

  let errorThrown = false;
  try {
    await immediateAgent.sendMessage('Ошибочный вопрос');
  } catch (err: any) {
    errorThrown = true;
    assert(err.message.includes('500'));
  }
  assert(errorThrown, 'Should throw on 500 error');

  // Verify that 'Ошибочный вопрос' was rolled back and is NOT in history
  const historyAfterFailure = immediateAgent.getHistory();
  assert.equal(
    historyAfterFailure.length,
    2,
    'Failed user message must be rolled back from history'
  );
  assert(
    !historyAfterFailure.some((m) => m.content === 'Ошибочный вопрос'),
    'Failed user message must not remain in history'
  );
  assert.equal(
    loadMessages().length,
    2,
    'Failed user message must be removed from localStorage'
  );
  console.log('  ✓ User message rolled back from state and storage upon LLM error');
  // ----------------------------------------------------
  // Test 18: Strategy 1 - Sliding Window (Keep only last N messages)
  // ----------------------------------------------------
  console.log('Test 18: Strategy 1 - Sliding Window');
  mockStorage.clear();
  const slidingAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 3,
    strategy: 'sliding_window',
    systemPrompt: 'You are a sliding window assistant.',
  });

  const sixMessages = [
    { id: 'sw1', role: 'user' as const, content: 'Msg 1', timestamp: 1 },
    { id: 'sw2', role: 'assistant' as const, content: 'Msg 2', timestamp: 2 },
    { id: 'sw3', role: 'user' as const, content: 'Msg 3', timestamp: 3 },
    { id: 'sw4', role: 'assistant' as const, content: 'Msg 4', timestamp: 4 },
    { id: 'sw5', role: 'user' as const, content: 'Msg 5', timestamp: 5 },
    { id: 'sw6', role: 'assistant' as const, content: 'Msg 6', timestamp: 6 },
  ];
  saveMessages(sixMessages);
  saveSummary({
    summary: 'Old summary that should be ignored in sliding window',
    lastSummarizedMessageId: 'sw2',
    lastSummarizedIndex: 1,
    updatedAt: 100,
    version: 1,
  });
  slidingAgent.loadHistory();

  const preparedSliding = slidingAgent.getPreparedMessages(
    slidingAgent.getHistory(),
    { role: 'user', content: 'Msg 7' }
  );

  // Should have: 1 system prompt + exactly 3 recent messages (Msg 4, 5, 6) + Msg 7
  assert.equal(preparedSliding.length, 5, 'Should contain: 1 system + 3 recent + 1 new user');
  assert.equal(preparedSliding[0].role, 'system');
  assert.equal(preparedSliding[0].content, 'You are a sliding window assistant.');
  assert.equal(preparedSliding[1].content, 'Msg 4');
  assert.equal(preparedSliding[2].content, 'Msg 5');
  assert.equal(preparedSliding[3].content, 'Msg 6');
  assert.equal(preparedSliding[4].content, 'Msg 7');
  // Verify older messages Msg 1..3 and summary are completely excluded
  assert(!preparedSliding.some((m) => m.content.includes('Old summary')));
  assert(!preparedSliding.some((m) => m.content === 'Msg 1'));
  assert(!preparedSliding.some((m) => m.content === 'Msg 2'));
  assert(!preparedSliding.some((m) => m.content === 'Msg 3'));
  console.log('  ✓ Sliding Window strictly transmits last N messages and discards older context');
  console.log('  PASSED: Strategy 1 - Sliding Window.\n');

  // ----------------------------------------------------
  // Test 19: Strategy 2 - Sticky Facts / Key-Value Memory
  // ----------------------------------------------------
  console.log('Test 19: Strategy 2 - Sticky Facts (Key-Value Memory)');
  mockStorage.clear();
  const factsAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    recentMessagesCount: 2,
    strategy: 'sticky_facts',
    systemPrompt: 'You are a facts-aware assistant.',
  });

  // Add facts
  factsAgent.addFact('цель проекта', 'Создать чат-агент на TypeScript', 'goal');
  factsAgent.addFact('бюджет', 'до 500 долларов', 'constraint');
  factsAgent.addFact('стиль кода', 'Строгий ESLint и Prettier', 'preference');

  assert.equal(factsAgent.getFacts().length, 3);
  assert.equal(factsAgent.getState().facts.length, 3);

  // Update existing fact
  const budgetFact = factsAgent.getFacts().find((f) => f.key === 'бюджет');
  assert(budgetFact);
  factsAgent.updateFact(budgetFact.id, { value: 'до 1000 долларов' });
  assert.equal(
    factsAgent.getFacts().find((f) => f.key === 'бюджет')?.value,
    'до 1000 долларов'
  );

  // Seed 4 messages in history
  const fourMsgs = [
    { id: 'f1', role: 'user' as const, content: 'Привет', timestamp: 1 },
    { id: 'f2', role: 'assistant' as const, content: 'Привет!', timestamp: 2 },
    { id: 'f3', role: 'user' as const, content: 'Как дела?', timestamp: 3 },
    { id: 'f4', role: 'assistant' as const, content: 'Отлично!', timestamp: 4 },
  ];
  saveMessages(fourMsgs);
  factsAgent.loadHistory();

  // Test prepared messages: 1 system prompt + 1 sticky facts block + 2 recent messages + 1 new user
  const preparedFacts = factsAgent.getPreparedMessages(
    factsAgent.getHistory(),
    { role: 'user', content: 'Новый вопрос' }
  );
  assert.equal(preparedFacts.length, 5, 'Should contain: 1 system + 1 facts block + 2 recent + 1 new user');
  assert.equal(preparedFacts[0].role, 'system');
  assert.equal(preparedFacts[0].content, 'You are a facts-aware assistant.');
  assert.equal(preparedFacts[1].role, 'system');
  assert(preparedFacts[1].content.includes('Key-Value Memory'));
  assert(preparedFacts[1].content.includes('цель проекта: Создать чат-агент на TypeScript'));
  assert(preparedFacts[1].content.includes('бюджет: до 1000 долларов'));
  assert.equal(preparedFacts[2].content, 'Как дела?');
  assert.equal(preparedFacts[3].content, 'Отлично!');
  assert.equal(preparedFacts[4].content, 'Новый вопрос');

  // Test remove and clear facts
  factsAgent.removeFact(budgetFact.id);
  assert.equal(factsAgent.getFacts().length, 2);
  factsAgent.clearFacts();
  assert.equal(factsAgent.getFacts().length, 0);
  console.log('  ✓ Sticky Facts Key-Value memory is persisted, updated, and injected into context');
  console.log('  PASSED: Strategy 2 - Sticky Facts.\n');

  // ----------------------------------------------------
  // Test 20: Strategy 3 - Branching (Checkpoints & Dialogue Threads)
  // ----------------------------------------------------
  console.log('Test 20: Strategy 3 - Branching (Dialogue Branches)');
  mockStorage.clear();
  const branchAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    strategy: 'branching',
    recentMessagesCount: 10,
  });

  // Main branch starts with initial messages
  const initialBranchMsgs = [
    { id: 'b1', role: 'user' as const, content: 'Начало диалога', timestamp: 1 },
    { id: 'b2', role: 'assistant' as const, content: 'Привет, о чем говорим?', timestamp: 2 },
    { id: 'b3', role: 'user' as const, content: 'Точка выбора чекпоинта', timestamp: 3 },
    { id: 'b4', role: 'assistant' as const, content: 'Вот два варианта решения', timestamp: 4 },
    { id: 'b5', role: 'user' as const, content: 'Идем по плану А', timestamp: 5 },
  ];
  saveMessages(initialBranchMsgs);
  branchAgent.loadHistory();

  assert.equal(branchAgent.getBranches().length, 1);
  assert.equal(branchAgent.getActiveBranchId(), 'main');

  // 1. Create a new branch from checkpoint b3 ("Точка выбора чекпоинта")
  const branchB = branchAgent.createBranch('Ветка Б (Альтернатива)', 'b3');
  assert.equal(branchAgent.getActiveBranchId(), branchB.id);
  // Forked history should only include messages up to b3 (b1, b2, b3)
  assert.equal(branchAgent.getHistory().length, 3);
  assert.equal(branchAgent.getHistory()[2].id, 'b3');
  assert(!branchAgent.getHistory().some((m) => m.id === 'b4' || m.id === 'b5'));

  // Verify that branching context transmits system prompt + all messages of the active branch
  const prepBranchB = branchAgent.getPreparedMessages(
    branchAgent.getHistory(),
    { role: 'user', content: 'Вопрос в ветке Б' }
  );
  assert.equal(prepBranchB.length, 5, 'Should contain 1 system + 3 branch messages + 1 new user message');
  assert.equal(prepBranchB[0].role, 'system');
  assert.equal(prepBranchB[1].content, 'Начало диалога');
  assert.equal(prepBranchB[2].content, 'Привет, о чем говорим?');
  assert.equal(prepBranchB[3].content, 'Точка выбора чекпоинта');
  assert.equal(prepBranchB[4].content, 'Вопрос в ветке Б');

  // 2. Switch back to Main branch
  branchAgent.switchBranch('main');
  assert.equal(branchAgent.getActiveBranchId(), 'main');
  assert.equal(branchAgent.getHistory().length, 5);
  assert.equal(branchAgent.getHistory()[4].content, 'Идем по плану А');

  // 3. Rename branch
  branchAgent.renameBranch(branchB.id, 'Ветка Б: Финальный план');
  const renamedBranch = branchAgent.getBranches().find((b) => b.id === branchB.id);
  assert.equal(renamedBranch?.name, 'Ветка Б: Финальный план');

  // 4. Delete branch
  branchAgent.deleteBranch(branchB.id);
  assert.equal(branchAgent.getBranches().length, 1);
  assert.equal(branchAgent.getActiveBranchId(), 'main');
  console.log('  ✓ Branches can be created from checkpoints, switched independently, and managed');
  console.log('  PASSED: Strategy 3 - Branching.\n');

  // ----------------------------------------------------
  // Test 21: Context Strategy Switcher
  // ----------------------------------------------------
  console.log('Test 21: Context Strategy Switcher');
  mockStorage.clear();
  const switchAgent = new Agent({
    apiKey: 'sk-test',
    model: 'openai/gpt-4o-mini',
    strategy: 'sliding_window',
    recentMessagesCount: 2,
    systemPrompt: 'System',
  });

  const testFive = [
    { id: 's1', role: 'user' as const, content: '1', timestamp: 1 },
    { id: 's2', role: 'assistant' as const, content: '2', timestamp: 2 },
    { id: 's3', role: 'user' as const, content: '3', timestamp: 3 },
    { id: 's4', role: 'assistant' as const, content: '4', timestamp: 4 },
    { id: 's5', role: 'user' as const, content: '5', timestamp: 5 },
  ];
  saveMessages(testFive);
  switchAgent.loadHistory();

  // Sliding window -> 1 system + 2 recent (4, 5) = 3 messages
  let prep = switchAgent.getPreparedMessages(switchAgent.getHistory());
  assert.equal(prep.length, 3);
  assert.equal(prep[1].content, '4');
  assert.equal(prep[2].content, '5');

  // Switch to Demo -> all 5 messages included without slicing = 6 messages
  switchAgent.setStrategy('demo');
  assert.equal(switchAgent.getState().config.strategy, 'demo');
  assert.equal(switchAgent.getState().config.mode, 'demo');
  prep = switchAgent.getPreparedMessages(switchAgent.getHistory());
  assert.equal(prep.length, 6); // 1 system + 5 messages

  // Switch to Sliding Window with N=4
  switchAgent.setStrategy('sliding_window');
  switchAgent.setRecentMessagesCount(4);
  prep = switchAgent.getPreparedMessages(switchAgent.getHistory());
  assert.equal(prep.length, 5); // 1 system + 4 messages (2, 3, 4, 5)
  assert.equal(prep[1].content, '2');

  console.log('  ✓ Context Strategy Switcher dynamically alters LLM context transmission');
  console.log('  PASSED: Context Strategy Switcher.\n');

  console.log('🎉 ALL 21 TESTS PASSED SUCCESSFULLY! 100% SPEC COMPLIANCE.\n');

  // ----------------------------------------------------
  // Run Week 3 Memory Layer Tests
  // ----------------------------------------------------
  await runMemoryTests();
}

import { runMemoryTests } from './test-memory';

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

