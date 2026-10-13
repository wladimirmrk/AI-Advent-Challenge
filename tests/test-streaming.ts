/**
 * Automated test suite for Streaming Responses (Day 26 / Week 6).
 * Tests OpenRouter SSE streaming, Ollama NDJSON streaming,
 * Stop Generation cancellation (AbortController), and real-time technical tag filtering.
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

/**
 * Creates a mock ReadableStream that emits given text chunks with optional delay.
 */
function createMockStream(chunks: string[], delayMs = 10): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function runStreamingTests() {
  console.log('⚡ Starting Day 26: Agent Streaming Response Test Suite...\n');

  // -------------------------------------------------------------------------
  // Test T1: OpenRouter SSE Streaming
  // -------------------------------------------------------------------------
  console.log('--- Test T1: OpenRouter SSE Streaming ---');
  const agent1 = new Agent('stream-test-openrouter', {
    provider: 'openrouter',
    apiKey: 'test-key-123',
    model: 'google/gemini-2.0-flash-exp:free',
    strategy: 'sliding_window',
  });

  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":", "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"мир!"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18}}\n\n',
    'data: [DONE]\n\n',
  ];

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (url.includes('openrouter.ai')) {
      const stream = createMockStream(sseChunks, 5);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return originalFetch(url, init);
  };

  const chunksReceived1: string[] = [];
  const unsubscribe1 = agent1.subscribe((state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
      chunksReceived1.push(lastMsg.content);
    }
  });

  const response1 = await agent1.sendMessage('Тестовое приветствие');
  unsubscribe1();

  assert.equal(response1, 'Привет, мир!', 'Full accumulated text must match expected response');
  assert.ok(chunksReceived1.length >= 2, 'Observer should have received incremental updates during stream');
  const finalState1 = agent1.getState();
  assert.equal(finalState1.isLoading, false, 'Agent isLoading should be false after completion');
  assert.equal(finalState1.isStreaming, false, 'Agent isStreaming should be false after completion');
  assert.equal(finalState1.tokenStats.response, 6, 'TokenStats response tokens should match usage from stream');
  console.log('✅ Test T1 Passed: OpenRouter SSE stream successfully received and rendered incrementally!');

  // -------------------------------------------------------------------------
  // Test T2: Ollama NDJSON Streaming
  // -------------------------------------------------------------------------
  console.log('\n--- Test T2: Ollama NDJSON Streaming ---');
  const agent2 = new Agent('stream-test-ollama', {
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3:latest',
    strategy: 'sliding_window',
  });

  const ndjsonChunks = [
    JSON.stringify({ message: { role: 'assistant', content: 'Ответ ' }, done: false }) + '\n',
    JSON.stringify({ message: { role: 'assistant', content: 'от ' }, done: false }) + '\n',
    JSON.stringify({ message: { role: 'assistant', content: 'Ollama!' }, done: false }) + '\n',
    JSON.stringify({
      done: true,
      prompt_eval_count: 15,
      eval_count: 7,
    }) + '\n',
  ];

  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (url.includes('/api/chat')) {
      const stream = createMockStream(ndjsonChunks, 5);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
    return originalFetch(url, init);
  };

  const response2 = await agent2.sendMessage('Вопрос к Ollama');
  assert.equal(response2, 'Ответ от Ollama!', 'Ollama streaming response must be accumulated correctly');
  const finalState2 = agent2.getState();
  assert.equal(finalState2.isLoading, false);
  assert.equal(finalState2.isStreaming, false);
  assert.equal(finalState2.tokenStats.response, 7, 'Ollama eval_count tokens should be recorded');
  console.log('✅ Test T2 Passed: Ollama NDJSON stream successfully parsed and tokens recorded!');

  // -------------------------------------------------------------------------
  // Test T3: Stop Generation (AbortController cancellation)
  // -------------------------------------------------------------------------
  console.log('\n--- Test T3: Stop Generation / Abort Cancellation ---');
  const agent3 = new Agent('stream-test-abort', {
    provider: 'openrouter',
    apiKey: 'test-key-abort',
    model: 'test-model',
  });

  const longSseChunks = [
    'data: {"choices":[{"delta":{"content":"Первая часть текста. "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Вторая часть текста. "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Третья часть текста."}}]}\n\n',
  ];

  (globalThis as any).fetch = async (url: string, init?: any) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < longSseChunks.length; i++) {
          if (init?.signal?.aborted) {
            controller.error(new DOMException('Aborted', 'AbortError'));
            return;
          }
          await new Promise((r) => setTimeout(r, 40));
          if (init?.signal?.aborted) {
            controller.error(new DOMException('Aborted', 'AbortError'));
            return;
          }
          controller.enqueue(encoder.encode(longSseChunks[i]));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  // Launch message sending, then abort after 50ms (after first chunk)
  const sendPromise = agent3.sendMessage('Длинный запрос');
  setTimeout(() => {
    agent3.stopGeneration();
  }, 50);

  const abortedResult = await sendPromise;
  const stateAfterAbort = agent3.getState();

  assert.equal(stateAfterAbort.isLoading, false, 'isLoading must be false after stopGeneration');
  assert.equal(stateAfterAbort.isStreaming, false, 'isStreaming must be false after stopGeneration');
  const lastMsg3 = stateAfterAbort.messages[stateAfterAbort.messages.length - 1];
  assert.equal(lastMsg3.role, 'assistant', 'Assistant message should be retained');
  assert.ok(lastMsg3.content.includes('Первая часть текста'), 'Partial generated text must be preserved');
  console.log(`✅ Test T3 Passed: Stop generation preserved partial output ("${lastMsg3.content.trim()}") and reset loading!`);

  // -------------------------------------------------------------------------
  // Test T4: Real-time Technical Tag Filtering during Streaming
  // -------------------------------------------------------------------------
  console.log('\n--- Test T4: Real-time Technical Tag Filtering ---');
  const sample1 = 'Привет! <mcp_call name="search">{"query":"laptop"}</mcp_call> Вот результат.';
  const cleaned1 = agent1.cleanLiveStreamingText(sample1);
  assert.equal(cleaned1.trim(), 'Привет!  Вот результат.', 'Complete tool tags must be removed');

  const partialTagStream = 'Подождите, проверяю базу <mcp_call name="store_search"';
  const cleanedPartial = agent1.cleanLiveStreamingText(partialTagStream);
  assert.equal(cleanedPartial.trim(), 'Подождите, проверяю базу', 'Unclosed in-progress tag must not leak into view');

  const stateCheckStream = 'Начинаю планирование <state_check>status: VALID</state_check> продолжим.';
  const cleanedState = agent1.cleanLiveStreamingText(stateCheckStream);
  assert.equal(cleanedState.trim(), 'Начинаю планирование  продолжим.', 'State check tags must be filtered');
  console.log('✅ Test T4 Passed: Technical tags and in-progress stream fragments correctly filtered in real time!');

  // -------------------------------------------------------------------------
  // Test T5: OpenRouter Reasoning / Thinking Streaming (delta.reasoning)
  // -------------------------------------------------------------------------
  console.log('\n--- Test T5: OpenRouter Reasoning / Thinking Streaming ---');
  const agent5 = new Agent('stream-test-thinking-openrouter', {
    provider: 'openrouter',
    apiKey: 'test-key-r1',
    model: 'deepseek/deepseek-r1',
  });

  const thinkingSseChunks = [
    'data: {"choices":[{"delta":{"reasoning":"Сначала подумаем о структуре."}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning":" Теперь сформулируем ответ."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Вот "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"готовый ответ."}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
    'data: [DONE]\n\n',
  ];

  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (url.includes('openrouter.ai')) {
      // Check that include_reasoning is sent in body
      const body = JSON.parse(init.body);
      assert.equal(body.include_reasoning, true, 'OpenRouter request should have include_reasoning: true');
      const stream = createMockStream(thinkingSseChunks, 5);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return originalFetch(url, init);
  };

  const response5 = await agent5.sendMessage('Запрос к DeepSeek R1');
  const state5 = agent5.getState();
  const lastMsg5 = state5.messages[state5.messages.length - 1];

  assert.equal(response5, 'Вот готовый ответ.');
  assert.equal(lastMsg5.content, 'Вот готовый ответ.');
  assert.equal(lastMsg5.thinking, 'Сначала подумаем о структуре. Теперь сформулируем ответ.');
  assert.equal(lastMsg5.isThinking, false);
  assert.ok(typeof lastMsg5.thinkingDurationMs === 'number', 'thinkingDurationMs should be recorded');
  console.log('✅ Test T5 Passed: OpenRouter delta.reasoning streamed and separated from final response content!');

  // -------------------------------------------------------------------------
  // Test T6: Ollama <think> Tag Streaming
  // -------------------------------------------------------------------------
  console.log('\n--- Test T6: Ollama <think> Tag Streaming ---');
  const agent6 = new Agent('stream-test-thinking-ollama', {
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    model: 'deepseek-r1:latest',
  });

  const ollamaThinkChunks = [
    JSON.stringify({ message: { role: 'assistant', content: '<think>\nАнализирую' }, done: false }) + '\n',
    JSON.stringify({ message: { role: 'assistant', content: ' проблему глубоко...\n</think>' }, done: false }) + '\n',
    JSON.stringify({ message: { role: 'assistant', content: 'Финальный ' }, done: false }) + '\n',
    JSON.stringify({ message: { role: 'assistant', content: 'результат.' }, done: true, prompt_eval_count: 5, eval_count: 10 }) + '\n',
  ];

  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (url.includes('/api/chat')) {
      const stream = createMockStream(ollamaThinkChunks, 5);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
    return originalFetch(url, init);
  };

  const response6 = await agent6.sendMessage('Вопрос с think-тегами');
  const state6 = agent6.getState();
  const lastMsg6 = state6.messages[state6.messages.length - 1];

  assert.equal(response6, 'Финальный результат.');
  assert.equal(lastMsg6.content, 'Финальный результат.');
  assert.ok(lastMsg6.thinking?.includes('Анализирую проблему глубоко'), 'Thinking text must contain think tag body');
  assert.equal(lastMsg6.content.includes('<think>'), false, 'Content must NOT contain think tags');
  assert.equal(lastMsg6.isThinking, false);
  assert.ok(typeof lastMsg6.thinkingDurationMs === 'number');
  console.log('✅ Test T6 Passed: Ollama <think> tags streamed into thinking field and cleanly omitted from content!');

  // Clean up global mock
  (globalThis as any).fetch = originalFetch;

  console.log('\n🎉 ALL DAY 26 STREAMING RESPONSE TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runStreamingTests().catch((err) => {
  console.error('❌ Streaming tests failed:', err);
  process.exit(1);
});
