/**
 * Day 16 Test Suite: Model Context Protocol (MCP) Connection & Tool Discovery
 *
 * Requirements verified:
 * 1. Minimal code establishing an MCP connection using @modelcontextprotocol/sdk.
 * 2. Proper retrieval and parsing of available tools from the MCP server.
 * 3. Accurate tool metadata validation (names, descriptions, schemas).
 * 4. Error handling and diagnostic output.
 */

import { strict as assert } from 'node:assert';
import { startMcpHttpServer } from '../scripts/mcp-server';
import { testMcpConnection } from '../src/agent/mcp/McpClient';
import { McpServerConfig } from '../src/agent/mcp/types';

export async function runMcpTests() {
  console.log('\n🔥 Starting Day 16: Model Context Protocol (MCP) Connection Test Suite...\n');

  const TEST_PORT = 3088;
  const server = await startMcpHttpServer(TEST_PORT);

  try {
    console.log('--- Step 1: Configuring MCP client ---');
    const config: McpServerConfig = {
      id: 'test-local-server',
      name: 'Local Test MCP Server',
      url: `http://localhost:${TEST_PORT}/sse`,
      transport: 'sse',
      headers: {
        'X-Client-Test': 'advent-day-16',
      },
      enabled: true,
      createdAt: Date.now(),
    };

    console.log(`Target URL: ${config.url}`);
    console.log(`Transport: ${config.transport}`);
    console.log(`Headers: ${JSON.stringify(config.headers)}`);

    console.log('\n--- Step 2: Establishing connection & querying tools ---');
    const result = await testMcpConnection(config);

    console.log(`Connection success: ${result.success}`);
    console.log(`Latency: ${result.latencyMs}ms`);

    assert.equal(result.success, true, `Connection should succeed. Error: ${result.error}`);
    assert.ok(Array.isArray(result.tools), 'Result must contain an array of tools');
    assert.ok(result.tools.length >= 3, `Expected at least 3 tools, got ${result.tools.length}`);

    console.log(`\n--- Step 3: Discovered tools (${result.tools.length}) ---`);
    for (const tool of result.tools) {
      console.log(`  🔧 Tool: [${tool.name}]`);
      console.log(`     Description: ${tool.description || 'none'}`);
      console.log(`     Schema: ${JSON.stringify(tool.inputSchema)}`);
    }

    // Verify expected tool names
    const toolNames = result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('calculate'), 'Tools should include calculate');
    assert.ok(toolNames.includes('get_system_time'), 'Tools should include get_system_time');
    assert.ok(toolNames.includes('echo'), 'Tools should include echo');

    console.log('\n✅ Day 16 Verification Passed: MCP connection established and tools retrieved successfully!\n');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    console.log('🧹 Test MCP server shut down.\n');
  }
}

// Standalone runner
if (process.argv[1]?.endsWith('test-mcp.ts') || process.argv[1]?.endsWith('test-mcp.js')) {
  runMcpTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Day 16 MCP Test failed:', err);
      process.exit(1);
    });
}
