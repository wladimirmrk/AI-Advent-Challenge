/**
 * Test Suite: MCP Server for CryptoTrack Project Files
 *
 * Verifies:
 * 1. Server initialization and SSE / HTTP endpoints on port 3087.
 * 2. Tool discovery for all 6 file tools:
 *    - list_project_files
 *    - read_project_file
 *    - search_project_files
 *    - write_project_file
 *    - patch_project_file
 *    - get_file_diff
 * 3. Multi-file search finding real symbols (e.g. "SafeApiCall", "CoinGecko") in CryptoTrack.
 * 4. Safe reading with line ranges and line numbers.
 * 5. Writing new files and patching existing content.
 * 6. Obtaining unified git diff.
 * 7. Path traversal security checks (blocking access outside project root).
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  startFilesHttpServer,
  DEFAULT_PROJECT_PATH,
  resolveSafePath,
} from '../MCP/files/server';
import { testMcpConnection, callMcpTool } from '../src/agent/mcp/McpClient';
import { McpServerConfig } from '../src/agent/mcp/types';

export async function runFilesMcpTests() {
  console.log('\n📁 Starting MCP CryptoTrack Project Files Test Suite...\n');

  const TEST_PORT = 3087;
  const projectRoot = DEFAULT_PROJECT_PATH;

  assert.ok(
    fs.existsSync(projectRoot),
    `Целевой каталог CryptoTrack должен существовать: "${projectRoot}"`
  );

  const server = await startFilesHttpServer(TEST_PORT, projectRoot);

  const testFilePath = 'docs/decisions/ADR-TEST-099-file-assistant-verification.md';
  const testFileAbs = path.join(projectRoot, testFilePath);

  try {
    const config: McpServerConfig = {
      id: 'mcp-files-test',
      name: 'CryptoTrack Files Test Server',
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
    assert.equal(healthData.server, 'crypto-track-files-server');
    assert.ok(healthData.tools.includes('list_project_files'));
    assert.ok(healthData.tools.includes('read_project_file'));
    assert.ok(healthData.tools.includes('search_project_files'));
    assert.ok(healthData.tools.includes('write_project_file'));
    assert.ok(healthData.tools.includes('patch_project_file'));
    assert.ok(healthData.tools.includes('get_file_diff'));
    console.log('✓ Healthcheck endpoint verified successfully.');

    // --- Step 2: MCP Connection & Tool Discovery ---
    console.log('\n--- Step 2: MCP connection and tool discovery via SDK ---');
    const connectionResult = await testMcpConnection(config);
    assert.equal(
      connectionResult.success,
      true,
      `Connection should succeed: ${connectionResult.error}`
    );
    assert.ok(Array.isArray(connectionResult.tools), 'Discovered tools must be an array');
    assert.equal(
      connectionResult.tools.length,
      6,
      'Must discover exactly 6 project file tools'
    );

    const toolNames = connectionResult.tools.map((t) => t.name);
    console.log(`✓ Discovered tools: ${toolNames.join(', ')}`);

    // --- Step 3: Tool Execution - list_project_files ---
    console.log('\n--- Step 3: Tool execution: list_project_files ---');
    const listRes = await callMcpTool(config, 'list_project_files', {
      subpath: 'docs/decisions',
      pattern: 'ADR-',
      limit: 10,
    });
    assert.equal(listRes.isError, false, `list_project_files failed: ${listRes.result}`);
    const listData = JSON.parse(listRes.result);
    assert.equal(listData.success, true);
    assert.ok(listData.returnedFiles > 0, 'Should find ADR files in docs/decisions');
    assert.ok(
      listData.files.some((f: string) => f.includes('ADR-001')),
      'Should include ADR-001'
    );
    console.log(
      `✓ Found ${listData.totalFiles} ADR files in docs/decisions. First: ${listData.files[0]}`
    );

    // --- Step 4: Tool Execution - search_project_files (Multi-file search) ---
    console.log('\n--- Step 4: Tool execution: search_project_files across codebase ---');
    const searchRes = await callMcpTool(config, 'search_project_files', {
      query: 'SafeApiCall',
      maxResults: 10,
    });
    assert.equal(searchRes.isError, false, `search_project_files failed: ${searchRes.result}`);
    const searchData = JSON.parse(searchRes.result);
    assert.equal(searchData.success, true);
    assert.ok(searchData.totalMatches > 0, 'Should find matches for SafeApiCall');
    assert.ok(
      searchData.filesCount >= 2,
      `Should find SafeApiCall across at least 2 distinct files (found ${searchData.filesCount})`
    );
    console.log(
      `✓ Search returned ${searchData.totalMatches} matches across ${searchData.filesCount} files:`
    );
    for (const m of searchData.matches.slice(0, 3)) {
      console.log(`   - ${m.file}:${m.line} -> ${m.text}`);
    }

    // --- Step 5: Tool Execution - read_project_file with line ranges ---
    console.log('\n--- Step 5: Tool execution: read_project_file ---');
    const readRes = await callMcpTool(config, 'read_project_file', {
      filePath: 'docs/architecture.md',
      startLine: 1,
      endLine: 15,
    });
    assert.equal(readRes.isError, false, `read_project_file failed: ${readRes.result}`);
    const readData = JSON.parse(readRes.result);
    assert.equal(readData.success, true);
    assert.equal(readData.startLine, 1);
    assert.equal(readData.endLine, 15);
    assert.ok(readData.content.includes('1:'), 'Numbered content must include line 1 prefix');
    console.log(`✓ Read lines 1-15 of docs/architecture.md (total lines: ${readData.totalLines})`);

    // --- Step 6: Tool Execution - write_project_file (Create new ADR) ---
    console.log('\n--- Step 6: Tool execution: write_project_file (Create test ADR) ---');
    const testContent = `# ADR-TEST-099: File Assistant Verification

## Context
Automated verification test for Day 34 File Assistant MCP server.

## Status
Proposed

## Decision
All file operations must be validated through unified git diff.
`;

    const writeRes = await callMcpTool(config, 'write_project_file', {
      filePath: testFilePath,
      content: testContent,
      overwrite: true,
    });
    assert.equal(writeRes.isError, false, `write_project_file failed: ${writeRes.result}`);
    const writeData = JSON.parse(writeRes.result);
    assert.equal(writeData.success, true);
    assert.ok(fs.existsSync(testFileAbs), 'Created file must exist on disk');
    console.log(`✓ Created test file "${testFilePath}" (${writeData.bytesWritten} bytes)`);

    // --- Step 7: Tool Execution - patch_project_file ---
    console.log('\n--- Step 7: Tool execution: patch_project_file ---');
    const patchRes = await callMcpTool(config, 'patch_project_file', {
      filePath: testFilePath,
      targetContent: '## Status\nProposed',
      replacementContent: '## Status\nAccepted (Verified via MCP)',
    });
    assert.equal(patchRes.isError, false, `patch_project_file failed: ${patchRes.result}`);
    const patchData = JSON.parse(patchRes.result);
    assert.equal(patchData.success, true);
    assert.equal(patchData.replaced, true);

    const patchedFileContent = fs.readFileSync(testFileAbs, 'utf8');
    assert.ok(
      patchedFileContent.includes('Accepted (Verified via MCP)'),
      'Patched content must be present in file'
    );
    console.log(`✓ Successfully patched "${testFilePath}"`);

    // --- Step 8: Tool Execution - get_file_diff ---
    console.log('\n--- Step 8: Tool execution: get_file_diff ---');
    const diffRes = await callMcpTool(config, 'get_file_diff', {
      filePath: testFilePath,
    });
    assert.equal(diffRes.isError, false, `get_file_diff failed: ${diffRes.result}`);
    const diffData = JSON.parse(diffRes.result);
    assert.equal(diffData.success, true);
    assert.ok(diffData.hasChanges, 'Should detect changes in repo');
    console.log(`✓ Git diff detected changes. Output preview: ${diffData.diff.substring(0, 100)}...`);

    // --- Step 9: Security Guardrails - Path Traversal Prevention ---
    console.log('\n--- Step 9: Security guardrails: Path Traversal Prevention ---');
    let traversalBlocked = false;
    try {
      resolveSafePath(projectRoot, '../../Windows/System32/calc.exe');
    } catch (err: any) {
      if (err.message.includes('outside allowed project root')) {
        traversalBlocked = true;
      }
    }
    assert.equal(
      traversalBlocked,
      true,
      'resolveSafePath must reject path traversal outside project root'
    );

    const attackRes = await callMcpTool(config, 'read_project_file', {
      filePath: '../../etc/passwd',
    });
    assert.equal(attackRes.isError, true, 'Tool must reject path traversal');
    console.log('✓ Path traversal attack securely rejected with Access Denied.');

    console.log('\n🎉 ALL MCP PROJECT FILES TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    // Clean up temporary test file
    if (fs.existsSync(testFileAbs)) {
      try {
        fs.unlinkSync(testFileAbs);
        console.log(`🧹 Cleaned up temporary test file "${testFilePath}"`);
      } catch {
        // ignore
      }
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('🧹 Test MCP Files server shut down cleanly.\n');
  }
}

// Standalone execution if launched directly via CLI
if (
  process.argv[1]?.endsWith('test-mcp-files.ts') ||
  process.argv[1]?.endsWith('test-mcp-files.js')
) {
  runFilesMcpTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
}
