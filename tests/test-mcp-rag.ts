/**
 * Test Suite: MCP Server for Structural RAG (CryptoTrack)
 *
 * Verifies:
 * 1. Server initialization and SSE / HTTP endpoints.
 * 2. Tool discovery for `rag_search_structural`.
 * 3. Tool execution returning structural chunks for query "Room Database".
 * 4. Error handling for empty query.
 * 5. Healthcheck endpoint functionality.
 */

import { strict as assert } from 'node:assert';
import { startRagHttpServer, DEFAULT_INDEX_DIR } from '../MCP/rag/server';
import { testMcpConnection, callMcpTool } from '../src/agent/mcp/McpClient';
import { McpServerConfig } from '../src/agent/mcp/types';

export async function runRagMcpTests() {
  console.log('\n📚 Starting MCP Structural RAG (CryptoTrack) Test Suite...\n');

  const TEST_PORT = 3088;
  const server = await startRagHttpServer(TEST_PORT);

  try {
    const config: McpServerConfig = {
      id: 'mcp-rag-test',
      name: 'CryptoTrack RAG Test Server',
      url: `http://localhost:${TEST_PORT}/sse`,
      transport: 'sse',
      headers: {},
      enabled: true,
      createdAt: Date.now(),
    };

    // --- Step 1: Healthcheck endpoint test ---
    console.log('--- Step 1: Healthcheck endpoint test ---');
    const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`);
    assert.equal(healthRes.status, 200, 'Health endpoint should return 200 OK');
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.server, 'crypto-track-rag-server');
    assert.equal(healthData.strategy, 'structural');
    assert.ok(healthData.tools.includes('rag_search_structural'));
    console.log('✓ Healthcheck endpoint verified successfully.');

    // --- Step 2: MCP Connection and Tool Discovery ---
    console.log('\n--- Step 2: MCP connection and tool discovery via SDK ---');
    const connectionResult = await testMcpConnection(config);
    assert.equal(connectionResult.success, true, `Connection should succeed: ${connectionResult.error}`);
    assert.ok(Array.isArray(connectionResult.tools), 'Discovered tools must be an array');

    const ragTool = connectionResult.tools.find((t) => t.name === 'rag_search_structural');
    assert.ok(ragTool, 'Server must provide "rag_search_structural" tool');
    assert.ok(ragTool.description && ragTool.description.length > 0, 'Tool must have description');
    console.log(`✓ Tool discovered: [${ragTool.name}] - ${ragTool.description}`);

    // --- Step 3: Tool Execution - Search Structural Index ---
    console.log('\n--- Step 3: Tool execution: rag_search_structural ---');
    const toolCallResult = await callMcpTool(config, 'rag_search_structural', {
      query: 'Room Database',
      top_k: 2,
    });
    assert.equal(toolCallResult.isError, false, `Tool execution should not report error: ${toolCallResult.error || toolCallResult.result}`);

    console.log('Tool response preview:', toolCallResult.result?.slice(0, 300) + '...');
    const parsed = JSON.parse(toolCallResult.result);
    assert.equal(parsed.success, true, 'Result success field should be true');
    assert.equal(parsed.strategy, 'structural', 'Strategy should be structural');
    assert.ok(Array.isArray(parsed.results), 'Results should be an array');
    assert.ok(parsed.results.length > 0, 'Should return at least 1 structural chunk');

    const firstChunk = parsed.results[0];
    assert.ok(firstChunk.source, 'Chunk must contain source file');
    assert.ok(firstChunk.content, 'Chunk must contain content');
    assert.ok(typeof firstChunk.score === 'number', 'Chunk must have numeric score');
    console.log(`✓ Found ${parsed.results.length} chunks. Top chunk: [${firstChunk.source}] (${firstChunk.section || 'root'}) score: ${firstChunk.score}`);

    // --- Step 4: Error handling for empty query ---
    console.log('\n--- Step 4: Error handling for empty query ---');
    const errorCallResult = await callMcpTool(config, 'rag_search_structural', {
      query: '   ',
    });
    assert.equal(errorCallResult.isError, true, 'Tool should return isError=true for empty query');
    assert.ok(
      errorCallResult.result.includes('пустым') ||
      errorCallResult.result.includes('Ошибка') ||
      (errorCallResult.error && errorCallResult.error.includes('пустым')),
      'Error message should indicate empty query'
    );
    console.log('✓ Empty query correctly rejected with proper error message.');

    console.log('\n🎉 ALL MCP RAG TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('🧹 Test MCP RAG server shut down.');
        resolve();
      });
    });
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-mcp-rag.ts') || process.argv[1]?.endsWith('test-mcp-rag.js')) {
  runRagMcpTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
}
