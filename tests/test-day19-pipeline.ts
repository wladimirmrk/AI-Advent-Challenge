/**
 * Day 19 Test Suite: MCP Tool Composition & Agent Autonomous Orchestration
 *
 * Requirements verified:
 * 1. MCP Tools registration (search, summarize, saveToFile) & JSON schemas.
 * 2. Step 1 Tool: search (text query, category filter, max_results).
 * 3. Step 2 Tool: summarize (statistical calculation, price analysis, markdown/json generation).
 * 4. Step 3 Tool: saveToFile (disk persistence, auto-naming, path traversal defense).
 * 5. Agent Autonomous Orchestration (Markdown): Agent sequentially executes search -> summarize -> saveToFile.
 * 6. Agent Autonomous Orchestration (JSON): Agent chains tools to produce and save structured JSON analytics.
 * 7. Verification of data handoff and disk persistence: file exists, content matches pipeline calculations.
 * 8. Error handling & edge cases: empty query results, path traversal blocking, missing parameters.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startMcpHttpServer, PipelineService } from '../scripts/mcp-server';
import { testMcpConnection, callMcpTool } from '../src/agent/mcp/McpClient';
import { McpServerConfig } from '../src/agent/mcp/types';

// Mock storage & window environment for Agent class in Node.js
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

export async function runDay19PipelineTests() {
  console.log('\n🔥 Starting Day 19: Agent-Orchestrated MCP Tool Composition Test Suite...\n');

  const TEST_PORT = 3097;
  const TEST_REPORTS_DIR = path.join(process.cwd(), 'data', 'test-reports-day19');

  // Setup clean test reports directory
  if (fs.existsSync(TEST_REPORTS_DIR)) {
    try {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    } catch {}
  }
  fs.mkdirSync(TEST_REPORTS_DIR, { recursive: true });

  const pipeline = PipelineService.getInstance();
  pipeline.setDefaultDirectory(TEST_REPORTS_DIR);

  const server = await startMcpHttpServer(TEST_PORT);

  const serverConfig: McpServerConfig = {
    id: 'test-day19-server',
    name: 'Day 19 Pipeline MCP Server',
    url: `http://localhost:${TEST_PORT}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  mockStorage.set('agent_mcp_servers', JSON.stringify([serverConfig]));

  try {
    // ----------------------------------------------------
    // Test T1: MCP Tools Registration & JSON Schema Validation
    // ----------------------------------------------------
    console.log('--- Test T1: MCP Server Tool Registration & Schemas ---');
    const discovery = await testMcpConnection(serverConfig);
    assert.equal(discovery.success, true, `Connection should succeed: ${discovery.error}`);

    const registeredToolNames = discovery.tools.map((t) => t.name);
    console.log(`Discovered tools: ${registeredToolNames.join(', ')}`);

    // Verify atomic pipeline tools exist and run_pipeline is removed
    const requiredTools = ['search', 'summarize', 'saveToFile'];
    for (const tool of requiredTools) {
      assert.ok(
        registeredToolNames.includes(tool),
        `MCP Server must have registered Day 19 tool: "${tool}"`
      );
    }
    assert.ok(
      !registeredToolNames.includes('run_pipeline'),
      'run_pipeline tool must NOT be registered; pipeline must be driven by Agent'
    );

    const searchTool = discovery.tools.find((t) => t.name === 'search')!;
    assert.ok(searchTool.description?.includes('Шаг 1'));
    assert.deepEqual(searchTool.inputSchema?.required, ['query']);

    const summarizeTool = discovery.tools.find((t) => t.name === 'summarize')!;
    assert.ok(summarizeTool.description?.includes('Шаг 2'));

    const saveTool = discovery.tools.find((t) => t.name === 'saveToFile')!;
    assert.ok(saveTool.description?.includes('Шаг 3'));
    assert.deepEqual(saveTool.inputSchema?.required, ['content']);

    console.log('✅ Test T1 Passed: search, summarize, saveToFile registered (run_pipeline correctly absent)!\n');

    // ----------------------------------------------------
    // Test T2: Step 1 Tool (search)
    // ----------------------------------------------------
    console.log('--- Test T2: Step 1 Tool (search) ---');
    const searchRes = await callMcpTool(serverConfig, 'search', { query: 'iPhone' });
    assert.equal(searchRes.success, true, 'search tool should succeed');
    const searchData = JSON.parse(searchRes.result!);
    assert.equal(searchData.success, true);
    assert.ok(searchData.totalFound >= 1, 'Should find at least 1 iPhone');
    assert.ok(searchData.items[0].sku.includes('PHONE-15-PRO'));
    console.log(`  Found: ${searchData.items[0].title} (Price: ${searchData.items[0].price} ${searchData.items[0].currency})`);

    // Search by category
    const catRes = await callMcpTool(serverConfig, 'search', { query: '', category: 'laptops' });
    const catData = JSON.parse(catRes.result!);
    assert.equal(catData.success, true);
    assert.ok(catData.items.some((i: any) => i.category === 'laptops'));
    console.log(`  Found ${catData.items.length} laptops in catalog.`);
    console.log('✅ Test T2 Passed: search tool retrieves expected data!\n');

    // ----------------------------------------------------
    // Test T3: Step 2 Tool (summarize)
    // ----------------------------------------------------
    console.log('--- Test T3: Step 2 Tool (summarize) ---');
    const summaryRes = await callMcpTool(serverConfig, 'summarize', {
      items: searchData.items,
      format: 'markdown',
      title: 'Анализ смартфонов Apple',
    });
    assert.equal(summaryRes.success, true, 'summarize tool should succeed');
    const summaryData = JSON.parse(summaryRes.result!);
    assert.equal(summaryData.success, true);
    assert.equal(summaryData.format, 'markdown');
    assert.ok(summaryData.stats.totalItems >= 1);
    assert.ok(summaryData.stats.minPrice > 0);
    assert.ok(summaryData.renderedContent.includes('# Анализ смартфонов Apple'));
    assert.ok(summaryData.renderedContent.includes('| Товар | Артикул | Цена |'));
    assert.ok(summaryData.renderedContent.includes('PHONE-15-PRO'));
    console.log(`  Generated summary title: ${summaryData.title}`);
    console.log(`  Key Highlights: ${summaryData.keyHighlights.length} points generated`);

    // JSON format summarize
    const jsonSummaryRes = await callMcpTool(serverConfig, 'summarize', {
      items: catData.items,
      format: 'json',
    });
    const jsonSummaryData = JSON.parse(jsonSummaryRes.result!);
    assert.equal(jsonSummaryData.format, 'json');
    const parsedInner = JSON.parse(jsonSummaryData.renderedContent);
    assert.ok(parsedInner.stats);
    assert.ok(Array.isArray(parsedInner.items));
    console.log('✅ Test T3 Passed: summarize tool processes data and calculates statistics!\n');

    // ----------------------------------------------------
    // Test T4: Step 3 Tool (saveToFile)
    // ----------------------------------------------------
    console.log('--- Test T4: Step 3 Tool (saveToFile) ---');
    const customFilename = 'test-smartphones-summary.md';
    const saveRes = await callMcpTool(serverConfig, 'saveToFile', {
      content: summaryData.renderedContent,
      filename: customFilename,
      format: 'markdown',
    });
    assert.equal(saveRes.success, true, 'saveToFile should succeed');
    const saveData = JSON.parse(saveRes.result!);
    assert.equal(saveData.success, true);
    assert.equal(saveData.filename, customFilename);
    assert.ok(fs.existsSync(saveData.filePath), `File must exist at ${saveData.filePath}`);

    // Verify content on disk
    const savedContent = fs.readFileSync(saveData.filePath, 'utf8');
    assert.ok(savedContent.includes('Анализ смартфонов Apple'));
    assert.ok(savedContent.includes('PHONE-15-PRO'));
    console.log(`  Saved ${saveData.bytesWritten} bytes to: ${saveData.filePath}`);

    // Test Path Traversal Protection
    const evilSave = await callMcpTool(serverConfig, 'saveToFile', {
      content: 'evil payload',
      filename: '../../evil.txt',
    });
    assert.equal(evilSave.isError, true, 'Path traversal attempt must be rejected');
    console.log('  Path traversal rejection verified.');
    console.log('✅ Test T4 Passed: saveToFile correctly persists file and guards against path traversal!\n');

    // ----------------------------------------------------
    // Test T5: Agent Autonomous Orchestration (Markdown Pipeline)
    // ----------------------------------------------------
    console.log('--- Test T5: Agent Autonomous Orchestration (Markdown Pipeline) ---');
    const agentMd = new Agent('chat-day19-md-agent');
    agentMd.setApiKey('test-dummy-api-key');

    let turnCounterMd = 0;
    (agentMd as any).callLLM = async (messages: any[]) => {
      turnCounterMd++;
      if (turnCounterMd === 1) {
        // Step 1: Agent decides to search
        return {
          content: `Шаг 1: Начинаю поиск товаров по категории laptops.\n<mcp_call name="search">{"query": "MacBook", "category": "laptops"}</mcp_call>`,
          promptTokens: 110,
          completionTokens: 30,
          totalTokens: 140,
          isEstimated: false,
        };
      } else if (turnCounterMd === 2) {
        // Step 2: Agent receives search result and invokes summarize with extracted items
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('<mcp_result name="search"'));
        assert.ok(lastMsg.includes('LAPTOP-AIR-M3'));
        return {
          content: `Шаг 2: Данные получены. Формирую аналитическую выжимку.\n<mcp_call name="summarize">
{
  "items": [
    {
      "sku": "LAPTOP-AIR-M3",
      "title": "Apple MacBook Air 13 M3 16/512GB",
      "category": "laptops",
      "price": 149990,
      "currency": "RUB",
      "inStock": true,
      "stockCount": 5,
      "warehouse": "Склад Юг"
    }
  ],
  "format": "markdown",
  "title": "Сводный отчет по ультрабукам Apple"
}
</mcp_call>`,
          promptTokens: 220,
          completionTokens: 40,
          totalTokens: 260,
          isEstimated: false,
        };
      } else if (turnCounterMd === 3) {
        // Step 3: Agent receives summarize result and invokes saveToFile
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('<mcp_result name="summarize"'));
        return {
          content: `Шаг 3: Выжимка готова. Сохраняю отчет на диск.\n<mcp_call name="saveToFile">
{
  "content": "Отчет по ультрабукам Apple MacBook Air M3 (цена 149 990 руб., в наличии).",
  "filename": "agent-laptops-digest.md",
  "format": "markdown"
}
</mcp_call>`,
          promptTokens: 320,
          completionTokens: 35,
          totalTokens: 355,
          isEstimated: false,
        };
      } else {
        // Step 4: Final user-facing synthesis
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('<mcp_result name="saveToFile"'));
        return {
          content: 'Я успешно провел исследование каталога ноутбуков Apple, составил аналитическую сводку по характеристикам и ценам и сохранил готовый отчет в файл `agent-laptops-digest.md`.',
          promptTokens: 420,
          completionTokens: 45,
          totalTokens: 465,
          isEstimated: false,
        };
      }
    };

    const replyMd = await agentMd.sendMessage('Найди ультрабуки Apple, сформируй аналитическую сводку и сохрани в файл.');
    assert.equal(turnCounterMd, 4, 'Should execute 4 turns (search -> summarize -> saveToFile -> final synthesis)');
    assert.ok(replyMd.includes('agent-laptops-digest.md'));

    const stateMd = agentMd.getState();
    const lastAssistantMd = stateMd.messages[stateMd.messages.length - 1];
    assert.equal(lastAssistantMd.mcpCalls?.length, 3, 'Must have recorded 3 MCP calls');
    assert.equal(lastAssistantMd.mcpCalls?.[0].toolName, 'search');
    assert.equal(lastAssistantMd.mcpCalls?.[1].toolName, 'summarize');
    assert.equal(lastAssistantMd.mcpCalls?.[2].toolName, 'saveToFile');

    // Verify file exists on disk
    const expectedFilePath = path.join(TEST_REPORTS_DIR, 'agent-laptops-digest.md');
    assert.ok(fs.existsSync(expectedFilePath), 'Agent generated file must exist on disk');
    console.log(`  Agent response: "${replyMd}"`);
    console.log(`  File confirmed on disk: ${expectedFilePath}`);
    console.log('✅ Test T5 Passed: Agent autonomously executed Markdown pipeline from end to end!\n');

    // ----------------------------------------------------
    // Test T6: Agent Autonomous Orchestration (JSON Export Pipeline)
    // ----------------------------------------------------
    console.log('--- Test T6: Agent Autonomous Orchestration (JSON Export Pipeline) ---');
    const agentJson = new Agent('chat-day19-json-agent');
    agentJson.setApiKey('test-dummy-api-key');

    let turnCounterJson = 0;
    (agentJson as any).callLLM = async (messages: any[]) => {
      turnCounterJson++;
      if (turnCounterJson === 1) {
        return {
          content: `Запрашиваю данные по аудиотоварам.\n<mcp_call name="search">{"query": "AirPods", "category": "audio"}</mcp_call>`,
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          isEstimated: false,
        };
      } else if (turnCounterJson === 2) {
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('HEADPHONES-MAX'));
        return {
          content: `Формирую JSON-структуру.\n<mcp_call name="summarize">
{
  "items": [
    {
      "sku": "HEADPHONES-MAX",
      "title": "Apple AirPods Max Silver",
      "category": "audio",
      "price": 64990,
      "currency": "RUB",
      "inStock": true,
      "stockCount": 8,
      "warehouse": "Склад Север"
    }
  ],
  "format": "json",
  "title": "Audio Catalog Export"
}
</mcp_call>`,
          promptTokens: 180,
          completionTokens: 35,
          totalTokens: 215,
          isEstimated: false,
        };
      } else if (turnCounterJson === 3) {
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('"format": "json"'));
        return {
          content: `Сохраняю JSON на диск.\n<mcp_call name="saveToFile">
{
  "content": "{\\"export\\": \\"audio\\", \\"status\\": \\"ok\\"}",
  "filename": "audio-export.json",
  "format": "json"
}
</mcp_call>`,
          promptTokens: 260,
          completionTokens: 35,
          totalTokens: 295,
          isEstimated: false,
        };
      } else {
        return {
          content: 'Экспорт аудиоустройств успешно выгружен в структурированный JSON-файл `audio-export.json`.',
          promptTokens: 340,
          completionTokens: 30,
          totalTokens: 370,
          isEstimated: false,
        };
      }
    };

    const replyJson = await agentJson.sendMessage('Выгрузи аудиотовары в формате JSON и сохрани в файл.');
    assert.equal(turnCounterJson, 4);
    assert.ok(replyJson.includes('audio-export.json'));

    const jsonPath = path.join(TEST_REPORTS_DIR, 'audio-export.json');
    assert.ok(fs.existsSync(jsonPath), 'JSON file must exist on disk');
    console.log(`  Agent response: "${replyJson}"`);
    console.log(`  JSON file confirmed on disk: ${jsonPath}`);
    console.log('✅ Test T6 Passed: Agent autonomously executed JSON export pipeline!\n');

    // ----------------------------------------------------
    // Test T7: Data Transfer Integrity Between Tools
    // ----------------------------------------------------
    console.log('--- Test T7: Data Transfer Integrity Between Tools ---');
    // Call search directly
    const s1 = await callMcpTool(serverConfig, 'search', { query: 'Watch' });
    const s1Parsed = JSON.parse(s1.result!);
    assert.equal(s1Parsed.success, true);
    assert.ok(s1Parsed.items.length >= 1);
    const watchItem = s1Parsed.items[0];

    // Pass s1 items to summarize
    const s2 = await callMcpTool(serverConfig, 'summarize', {
      items: s1Parsed.items,
      format: 'markdown',
      title: 'Тест передачи данных по часам',
    });
    const s2Parsed = JSON.parse(s2.result!);
    assert.equal(s2Parsed.success, true);
    assert.ok(s2Parsed.renderedContent.includes(watchItem.sku));
    assert.ok(s2Parsed.renderedContent.includes(watchItem.title));

    // Pass s2 renderedContent to saveToFile
    const s3 = await callMcpTool(serverConfig, 'saveToFile', {
      content: s2Parsed.renderedContent,
      filename: 'data-integrity-test.md',
    });
    const s3Parsed = JSON.parse(s3.result!);
    assert.equal(s3Parsed.success, true);

    const onDiskText = fs.readFileSync(s3Parsed.filePath, 'utf8');
    assert.equal(onDiskText, s2Parsed.renderedContent, 'Saved file content must match summarize output exactly');
    console.log('  Data transfer integrity verified: 100% byte match between summarize output and saved file.');
    console.log('✅ Test T7 Passed: Correctness of data transfer between tools verified!\n');

    // ----------------------------------------------------
    // Test T8: Edge Cases & Error Handling
    // ----------------------------------------------------
    console.log('--- Test T8: Edge Cases & Error Handling ---');
    // 1. Search for non-existent product
    const emptySearch = await callMcpTool(serverConfig, 'search', { query: 'UnknownItem99999' });
    const emptyData = JSON.parse(emptySearch.result!);
    assert.equal(emptyData.totalFound, 0);

    // 2. Summarize empty list
    const emptySummary = await callMcpTool(serverConfig, 'summarize', { items: [] });
    const emptySumData = JSON.parse(emptySummary.result!);
    assert.equal(emptySumData.stats.totalItems, 0);
    assert.ok(emptySumData.summary.includes('не найдено'));

    // 3. Save without content (missing required field)
    const missingContentSave = await callMcpTool(serverConfig, 'saveToFile', {} as any);
    assert.equal(missingContentSave.isError, true);

    console.log('✅ Test T8 Passed: Edge cases and validation handled properly!\n');

    console.log('🎉 ALL DAY 19 TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    console.log('🧹 Test MCP server shut down.\n');
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-day19-pipeline.ts') || process.argv[1]?.endsWith('test-day19-pipeline.js')) {
  runDay19PipelineTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Day 19 Pipeline Test failed:', err);
      process.exit(1);
    });
}
