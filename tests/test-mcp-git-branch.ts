/**
 * Test Suite: MCP Server for Git Branch (CryptoTrack)
 *
 * Verifies:
 * 1. Server initialization and SSE / HTTP endpoints.
 * 2. Tool discovery for `get_current_git_branch`.
 * 3. Tool execution returning active git branch for C:\Users\W\Projects\CryptoTrack.
 * 4. Error handling for non-existent path.
 * 5. Healthcheck endpoint functionality.
 */

import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { startGitBranchHttpServer, DEFAULT_PROJECT_PATH } from '../MCP/git-branch/server';
import { testMcpConnection, callMcpTool } from '../src/agent/mcp/McpClient';
import { McpServerConfig } from '../src/agent/mcp/types';

export async function runGitBranchMcpTests() {
  console.log('\n🌿 Starting MCP Git Branch (CryptoTrack) Test Suite...\n');

  const TEST_PORT = 3089;
  const server = await startGitBranchHttpServer(TEST_PORT);

  try {
    const config: McpServerConfig = {
      id: 'mcp-git-branch-test',
      name: 'CryptoTrack Git Branch Test Server',
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
    assert.equal(healthData.server, 'crypto-track-git-branch-server');
    assert.ok(healthData.tools.includes('get_current_git_branch'));
    console.log('✓ Healthcheck endpoint verified successfully.');

    // --- Step 2: MCP Connection and Tool Discovery ---
    console.log('\n--- Step 2: MCP connection and tool discovery via SDK ---');
    const connectionResult = await testMcpConnection(config);
    assert.equal(connectionResult.success, true, `Connection should succeed: ${connectionResult.error}`);
    assert.ok(Array.isArray(connectionResult.tools), 'Discovered tools must be an array');
    
    const branchTool = connectionResult.tools.find((t) => t.name === 'get_current_git_branch');
    assert.ok(branchTool, 'Server must provide "get_current_git_branch" tool');
    assert.ok(branchTool.description.length > 0, 'Tool must have description');
    console.log(`✓ Tool discovered: [${branchTool.name}] - ${branchTool.description}`);

    // --- Step 3: Tool Execution - Get Current Git Branch ---
    console.log('\n--- Step 3: Tool execution: get_current_git_branch ---');
    const toolCallResult = await callMcpTool(config, 'get_current_git_branch', {});
    assert.equal(toolCallResult.isError, false, `Tool execution should not report error: ${toolCallResult.error || toolCallResult.result}`);

    console.log('Tool response content:', toolCallResult.result);
    const parsed = JSON.parse(toolCallResult.result);
    assert.equal(parsed.success, true, 'Result success field should be true');
    assert.ok(parsed.branch && typeof parsed.branch === 'string', 'Result must contain string branch name');
    assert.ok(parsed.branch.length > 0, 'Branch name must not be empty');

    // Cross-verify with real git CLI output for C:\Users\W\Projects\CryptoTrack
    const expectedBranch = execSync('git -C "C:\\Users\\W\\Projects\\CryptoTrack" branch --show-current', {
      encoding: 'utf8',
    }).trim() || 'main';

    assert.equal(parsed.branch, expectedBranch, `Branch name should match git CLI (${expectedBranch})`);
    console.log(`✓ Real Git branch matched: "${parsed.branch}" in "${parsed.projectPath}"`);

    // --- Step 4: Error handling for invalid path ---
    console.log('\n--- Step 4: Error handling for invalid path ---');
    const errorCallResult = await callMcpTool(config, 'get_current_git_branch', {
      projectPath: 'C:\\NonExistent_Invalid_Repo_Path_98765',
    });
    assert.equal(errorCallResult.isError, true, 'Tool should return isError=true for invalid path');
    assert.ok(
      errorCallResult.result.includes('не существует') ||
      errorCallResult.result.includes('Ошибка') ||
      (errorCallResult.error && errorCallResult.error.includes('не существует')),
      'Error message should indicate non-existent directory'
    );
    console.log('✓ Invalid path correctly rejected with proper error message.');

    console.log('\n🎉 ALL MCP GIT BRANCH TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('🧹 Test MCP Git Branch server shut down.');
        resolve();
      });
    });
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-mcp-git-branch.ts') || process.argv[1]?.endsWith('test-mcp-git-branch.js')) {
  runGitBranchMcpTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
}
