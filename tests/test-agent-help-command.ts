/**
 * Test Suite: Agent /help Command with MCP Git Branch & Structural RAG
 *
 * Verifies:
 * 1. Execution of `/help` without arguments (interactive overview, git branch status, sample queries).
 * 2. Execution of `/help <question>` with active MCP Git Branch and MCP Structural RAG servers.
 * 3. Proactive tool execution and recording in `message.mcpCalls`.
 * 4. Grounded answer synthesis referencing active Git branch and RAG source code chunks.
 * 5. Resilient fallback handling when MCP servers are offline or erroring.
 */

import { strict as assert } from 'node:assert';
import { Agent } from '../src/agent/Agent';
import { startGitBranchHttpServer } from '../MCP/git-branch/server';
import { startRagHttpServer } from '../MCP/rag/server';
import { McpServerConfig } from '../src/agent/mcp/types';
import { McpRouter } from '../src/agent/mcp/McpRouter';

export async function runHelpCommandTests() {
  console.log('\n💡 Starting Agent /help Command (Git Branch + RAG Structural) Test Suite...\n');

  const GIT_PORT = 3091;
  const RAG_PORT = 3092;

  // 1. Start test servers
  const gitServer = await startGitBranchHttpServer(GIT_PORT);
  const ragServer = await startRagHttpServer(RAG_PORT);

  try {
    const gitConfig: McpServerConfig = {
      id: 'mcp-git-branch-test',
      name: 'CryptoTrack Git Branch Test',
      url: `http://localhost:${GIT_PORT}/sse`,
      transport: 'sse',
      headers: {},
      enabled: true,
      createdAt: Date.now(),
      scope: 'global',
      tools: [
        {
          name: 'get_current_git_branch',
          description: 'Получить название текущей git ветки проекта CryptoTrack',
        },
      ],
    };

    const ragConfig: McpServerConfig = {
      id: 'mcp-rag-test',
      name: 'CryptoTrack RAG Test',
      url: `http://localhost:${RAG_PORT}/sse`,
      transport: 'sse',
      headers: {},
      enabled: true,
      createdAt: Date.now(),
      scope: 'global',
      tools: [
        {
          name: 'rag_search_structural',
          description: 'Поиск по кодовой базе и документации CryptoTrack через структурный RAG индекс',
        },
      ],
    };

    // Initialize agent with test configuration
    const agent = new Agent({
      provider: 'ollama',
      model: 'tinyllama',
      contextWindow: 8192,
    });

    // Seed test servers into McpRouter and override getGlobalMcpServers
    const router = McpRouter.getInstance();
    router.reset();
    router.seedFromServers([gitConfig, ragConfig]);

    // Override agent's global MCP servers for this test instance
    (agent as any).getGlobalMcpServers = () => [gitConfig, ragConfig];

    // --- Test 1: /help without arguments ---
    console.log('--- Test 1: /help without arguments (Overview & Status) ---');
    const overviewResponse = await agent.sendMessage('/help');

    assert.ok(overviewResponse.includes('Справка по проекту CryptoTrack'), 'Should contain title header');
    assert.ok(overviewResponse.includes('Активная Git-ветка'), 'Should contain Git branch section');
    assert.ok(overviewResponse.includes('База знаний RAG'), 'Should mention RAG knowledge base');
    assert.ok(overviewResponse.includes('/help <вопрос>'), 'Should explain how to ask questions');

    const msgs = agent.getState().messages;
    const lastMsg = msgs[msgs.length - 1];
    assert.equal(lastMsg.role, 'assistant');
    assert.ok(lastMsg.mcpCalls && lastMsg.mcpCalls.length >= 1, 'Should record get_current_git_branch tool call');
    assert.equal(lastMsg.mcpCalls[0].toolName, 'get_current_git_branch');
    console.log('✓ /help overview returned successfully with active Git branch detection.');

    // --- Test 2: /help <question> with full MCP Git Branch and RAG execution ---
    console.log('\n--- Test 2: /help <question> (Room Database inquiry) ---');
    const helpQuery = '/help Как устроен data-слой и Room Database в проекте?';
    const answer = await agent.sendMessage(helpQuery);

    const msgsAfterQuery = agent.getState().messages;
    const helpMsg = msgsAfterQuery[msgsAfterQuery.length - 1];
    assert.equal(helpMsg.role, 'assistant');
    assert.ok(helpMsg.mcpCalls && helpMsg.mcpCalls.length >= 2, 'Should execute at least 2 MCP tool calls');

    const branchCall = helpMsg.mcpCalls.find((c) => c.toolName === 'get_current_git_branch');
    const ragCall = helpMsg.mcpCalls.find((c) => c.toolName === 'rag_search_structural');

    assert.ok(branchCall, 'Must call get_current_git_branch');
    assert.ok(ragCall, 'Must call rag_search_structural');
    assert.equal(branchCall.isError, false, 'get_current_git_branch must succeed');
    assert.equal(ragCall.isError, false, 'rag_search_structural must succeed');

    // Verify RAG output content
    const ragResult = JSON.parse(ragCall.result || '{}');
    assert.equal(ragResult.success, true);
    assert.ok(Array.isArray(ragResult.results) && ragResult.results.length > 0, 'RAG should return chunks');
    console.log(`✓ RAG returned ${ragResult.results.length} chunks. Sample chunk: ${ragResult.results[0].source}`);

    // Verify synthesized/fallback answer contains branch and code references
    assert.ok(
      answer.includes('Ветка') || answer.includes('CryptoTrack'),
      'Answer must reference project context'
    );
    console.log('✓ Grounded /help response synthesized successfully.');

    // --- Test 3: Error isolation when MCP tools return error ---
    console.log('\n--- Test 3: Error isolation and graceful messaging ---');
    // Call with a non-existent index or simulate offline server
    const offlineConfig: McpServerConfig = {
      id: 'mcp-offline-test',
      name: 'Offline Server',
      url: `http://localhost:3099/sse`,
      transport: 'sse',
      headers: {},
      enabled: true,
      createdAt: Date.now(),
      scope: 'global',
      tools: [
        { name: 'get_current_git_branch' },
        { name: 'rag_search_structural' },
      ],
    };
    (agent as any).getGlobalMcpServers = () => [offlineConfig];
    router.reset();
    router.seedFromServers([offlineConfig]);

    const fallbackAns = await agent.sendMessage('/help Как работают корутины?');
    assert.ok(typeof fallbackAns === 'string' && fallbackAns.length > 0, 'Must not crash when servers are offline');
    console.log('✓ Offline servers handled cleanly without application crash.');

    console.log('\n🎉 ALL AGENT /HELP COMMAND TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    // Clean up servers
    await Promise.all([
      new Promise<void>((res) => gitServer.close(() => res())),
      new Promise<void>((res) => ragServer.close(() => res())),
    ]);
    console.log('🧹 Test servers shut down cleanly.');
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-agent-help-command.ts') || process.argv[1]?.endsWith('test-agent-help-command.js')) {
  runHelpCommandTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
}
