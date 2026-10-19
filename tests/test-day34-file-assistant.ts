/**
 * Test Suite: Day 34 File Assistant End-to-End Autonomous Workflow
 *
 * Verifies:
 * 1. Autonomous initiation of file operations based on high-level goals.
 * 2. Multi-file reading & search across at least 2-3 project files in CryptoTrack.
 * 3. File creation & patching (ADR / reports).
 * 4. Verification and inspection via git diff.
 * 5. Full reproducibility and clean tear-down.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '../src/agent/Agent';
import { startFilesHttpServer, DEFAULT_PROJECT_PATH } from '../MCP/files/server';
import { McpServerConfig } from '../src/agent/mcp/types';
import { McpRouter } from '../src/agent/mcp/McpRouter';

export async function runDay34FileAssistantTests() {
  console.log('\n🤖 Starting Day 34 File Assistant Autonomous Tests...\n');

  const TEST_PORT = 3086;
  const projectRoot = DEFAULT_PROJECT_PATH;

  assert.ok(
    fs.existsSync(projectRoot),
    `CryptoTrack project directory must exist: "${projectRoot}"`
  );

  const server = await startFilesHttpServer(TEST_PORT, projectRoot);

  const generatedReportPath = path.join(
    projectRoot,
    'docs/reports/safe-api-call-audit.md'
  );
  const generatedAdrPath = path.join(
    projectRoot,
    'docs/decisions/ADR-019-background-price-sync.md'
  );

  try {
    const filesConfig: McpServerConfig = {
      id: 'mcp-files-server',
      name: 'CryptoTrack Files Assistant',
      url: `http://localhost:${TEST_PORT}/sse`,
      transport: 'sse',
      headers: {},
      enabled: true,
      createdAt: Date.now(),
      scope: 'global',
      tools: [
        {
          name: 'list_project_files',
          description: 'Получить список файлов проекта CryptoTrack',
        },
        {
          name: 'read_project_file',
          description: 'Прочитать содержимое файла проекта CryptoTrack с диапазоном строк',
        },
        {
          name: 'search_project_files',
          description: 'Поиск по файлам проекта CryptoTrack (код, документация, gradle)',
        },
        {
          name: 'write_project_file',
          description: 'Создать или перезаписать файл проекта CryptoTrack (ADR, отчет, changelog)',
        },
        {
          name: 'patch_project_file',
          description: 'Точечно заменить фрагмент текста в файле проекта CryptoTrack',
        },
        {
          name: 'get_file_diff',
          description: 'Получить unified diff изменений в проекте CryptoTrack через Git',
        },
      ],
    };

    // 1. Initialize Agent
    const agent = new Agent({
      provider: 'ollama',
      model: 'tinyllama',
      contextWindow: 16384,
    });

    const router = McpRouter.getInstance();
    router.reset();
    router.seedFromServers([filesConfig]);
    (agent as any).getGlobalMcpServers = () => [filesConfig];

    // =========================================================================
    // Scenario 1: Component Audit (Search -> Read 3 files -> Write Report -> Diff)
    // =========================================================================
    console.log('--- Scenario 1: Autonomous Component Audit (SafeApiCall) ---');

    let turn = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      turn++;

      if (turn === 1) {
        // High-level goal received: agent decides to search for the component
        return {
          content: `<mcp_call name="search_project_files">{"query": "SafeApiCall", "maxResults": 10}</mcp_call>`,
          promptTokens: 100,
          completionTokens: 30,
          totalTokens: 130,
        };
      }

      if (turn === 2) {
        // Tool results returned with matches: agent decides to inspect implementation
        return {
          content: `<mcp_call name="read_project_file">{"filePath": "core/network/src/main/kotlin/com/cryptotrack/core/network/error/SafeApiCall.kt"}</mcp_call>`,
          promptTokens: 250,
          completionTokens: 35,
          totalTokens: 285,
        };
      }

      if (turn === 3) {
        // SafeApiCall read: agent reads remote data source consumer
        return {
          content: `<mcp_call name="read_project_file">{"filePath": "core/network/src/main/kotlin/com/cryptotrack/core/network/source/CoinGeckoRemoteDataSource.kt", "startLine": 1, "endLine": 45}</mcp_call>`,
          promptTokens: 400,
          completionTokens: 45,
          totalTokens: 445,
        };
      }

      if (turn === 4) {
        // Data source read: agent reads unit test to verify error handling
        return {
          content: `<mcp_call name="read_project_file">{"filePath": "core/network/src/test/kotlin/com/cryptotrack/core/network/SafeApiCallTest.kt", "startLine": 1, "endLine": 50}</mcp_call>`,
          promptTokens: 550,
          completionTokens: 45,
          totalTokens: 595,
        };
      }

      if (turn === 5) {
        // Agent analyzed 3 files and now writes audit report
        const reportContent = `# SafeApiCall Architecture & Error Handling Audit

## 1. Summary
SafeApiCall is a central defensive wrapper for remote HTTP calls in module \`:core:network\`.

## 2. Analyzed Files
- \`core/network/src/main/kotlin/com/cryptotrack/core/network/error/SafeApiCall.kt\`
- \`core/network/src/main/kotlin/com/cryptotrack/core/network/source/CoinGeckoRemoteDataSource.kt\`
- \`core/network/src/test/kotlin/com/cryptotrack/core/network/SafeApiCallTest.kt\`

## 3. Findings
- Network exceptions (IOException, HttpException) are safely mapped into Result<T>.
- Tests verify non-2xx status codes and network disconnects.
`;
        return {
          content: `<mcp_call name="write_project_file">{"filePath": "docs/reports/safe-api-call-audit.md", "content": ${JSON.stringify(reportContent)}}</mcp_call>`,
          promptTokens: 700,
          completionTokens: 80,
          totalTokens: 780,
        };
      }

      if (turn === 6) {
        // Agent checks git diff to ensure changes are accurate
        return {
          content: `<mcp_call name="get_file_diff">{"filePath": "docs/reports/safe-api-call-audit.md"}</mcp_call>`,
          promptTokens: 850,
          completionTokens: 30,
          totalTokens: 880,
        };
      }

      // Final synthesis
      return {
        content: `Аудит SafeApiCall успешно выполнен!\n\nПроанализировано 3 файла:\n1. SafeApiCall.kt\n2. CoinGeckoRemoteDataSource.kt\n3. SafeApiCallTest.kt\n\nСоздан подробный архитектурный отчет: [docs/reports/safe-api-call-audit.md]. Изменения зафиксированы в git diff.`,
        promptTokens: 950,
        completionTokens: 60,
        totalTokens: 1010,
      };
    };

    const auditResponse = await agent.sendMessage(
      'Найди все места, где используется SafeApiCall в проекте CryptoTrack, проанализируй обработку ошибок и подготовь архитектурный отчет'
    );

    assert.ok(
      auditResponse.includes('SafeApiCall'),
      'Synthesis response must reference SafeApiCall'
    );
    assert.ok(
      auditResponse.includes('safe-api-call-audit.md'),
      'Synthesis response must reference generated report'
    );

    const msgs = agent.getState().messages;
    const lastMsg = msgs[msgs.length - 1];
    assert.equal(lastMsg.role, 'assistant');
    assert.ok(lastMsg.mcpCalls, 'Assistant message must have recorded mcpCalls');
    assert.ok(
      lastMsg.mcpCalls.length >= 5,
      `Expected >= 5 autonomous tool steps, got ${lastMsg.mcpCalls.length}`
    );

    // Verify tool calls sequence
    const toolSequence = lastMsg.mcpCalls.map((c) => c.toolName);
    console.log(`✓ Autonomous tool chain executed: ${toolSequence.join(' -> ')}`);
    assert.ok(toolSequence.includes('search_project_files'));
    assert.ok(toolSequence.includes('read_project_file'));
    assert.ok(toolSequence.includes('write_project_file'));
    assert.ok(toolSequence.includes('get_file_diff'));

    // Verify created file on disk
    assert.ok(
      fs.existsSync(generatedReportPath),
      'Report file must be saved to disk'
    );
    const savedReport = fs.readFileSync(generatedReportPath, 'utf8');
    assert.ok(savedReport.includes('SafeApiCall Architecture'));
    console.log(`✓ Verified generated report on disk: "${generatedReportPath}"`);

    // =========================================================================
    // Scenario 2: Generate ADR (List -> Read ADR-005 -> Write ADR-019 -> Diff)
    // =========================================================================
    console.log('\n--- Scenario 2: Autonomous ADR-019 Generation ---');

    turn = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      turn++;

      if (turn === 1) {
        return {
          content: `<mcp_call name="read_project_file">{"filePath": "docs/decisions/ADR-005-offline-first.md"}</mcp_call>`,
          promptTokens: 100,
          completionTokens: 30,
          totalTokens: 130,
        };
      }

      if (turn === 2) {
        return {
          content: `<mcp_call name="read_project_file">{"filePath": "docs/decisions/ADR-016-room-inside-core-data.md"}</mcp_call>`,
          promptTokens: 250,
          completionTokens: 30,
          totalTokens: 280,
        };
      }

      if (turn === 3) {
        const adrContent = `# ADR-019: Periodic Background Price Synchronization

## Status
Accepted

## Context
Crypto prices require periodic refresh even when the app is in background, respecting battery and offline-first principles (ADR-005, ADR-016).

## Decision
Use Android Jetpack WorkManager in \`:core:sync\` to schedule periodic background sync with exponential backoff and network constraints.

## Consequences
- Reliable price caching in Room database.
- Zero battery drain during Doze mode.
`;
        return {
          content: `<mcp_call name="write_project_file">{"filePath": "docs/decisions/ADR-019-background-price-sync.md", "content": ${JSON.stringify(adrContent)}}</mcp_call>`,
          promptTokens: 400,
          completionTokens: 80,
          totalTokens: 480,
        };
      }

      if (turn === 4) {
        return {
          content: `<mcp_call name="get_file_diff">{"filePath": "docs/decisions/ADR-019-background-price-sync.md"}</mcp_call>`,
          promptTokens: 550,
          completionTokens: 30,
          totalTokens: 580,
        };
      }

      return {
        content: `Новый архитектурный документ [ADR-019: Background Price Sync] успешно создан на основе анализа ADR-005 и ADR-016! Изменения верифицированы через git diff.`,
        promptTokens: 650,
        completionTokens: 40,
        totalTokens: 690,
      };
    };

    const adrResponse = await agent.sendMessage(
      'Изучи существующие ADR в docs/decisions и создай новый ADR-019 о внедрении фонового обновления курсов криптовалют в CryptoTrack'
    );

    assert.ok(adrResponse.includes('ADR-019'), 'Must mention ADR-019');
    assert.ok(
      fs.existsSync(generatedAdrPath),
      'ADR-019 file must exist on disk'
    );
    const adrText = fs.readFileSync(generatedAdrPath, 'utf8');
    assert.ok(adrText.includes('Periodic Background Price Synchronization'));
    console.log(`✓ Verified ADR-019 generated on disk: "${generatedAdrPath}"`);

    console.log('\n🎉 ALL DAY 34 FILE ASSISTANT TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    // Clean up created files in CryptoTrack
    for (const f of [generatedReportPath, generatedAdrPath]) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
          console.log(`🧹 Cleaned up generated file: ${f}`);
        } catch {
          // ignore
        }
      }
    }

    const reportDir = path.join(projectRoot, 'docs/reports');
    if (fs.existsSync(reportDir)) {
      try {
        const files = fs.readdirSync(reportDir);
        if (files.length === 0) fs.rmdirSync(reportDir);
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
  process.argv[1]?.endsWith('test-day34-file-assistant.ts') ||
  process.argv[1]?.endsWith('test-day34-file-assistant.js')
) {
  runDay34FileAssistantTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
}
