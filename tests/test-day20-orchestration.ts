/**
 * Day 20 Test Suite: Multi-Server MCP Orchestration & Smart Routing
 *
 * Requirements verified:
 * 1. Multi-server registration: 3 independent domain-specific MCP servers
 *    (Catalog/Inventory, Logistics/Orders, Analytics/Reports).
 * 2. Independent discovery and domain isolation: each server provides only its domain tools.
 * 3. Dynamic Tool Registry (McpRouter): resolves tool -> server mapping, formats server-grouped
 *    system prompt instructions, and routes tool calls directly without blind probing.
 * 4. Autonomous Long Flow: multi-step interaction across all 3 servers in sequence:
 *    - Search & SKU details (Catalog Server)
 *    - Delivery calculation (Logistics Server)
 *    - Analytical summary & safe disk persistence (Analytics Server)
 * 5. Order & support flow: order tracking (Logistics) -> item lookup (Catalog) -> summary (Analytics).
 * 6. Verification of execution order, metadata transparency (serverName, serverUrl, latency),
 *    and file persistence.
 * 7. Error isolation and fallback when tools are missing or servers offline.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  startAllMcpServers,
  RunningServers,
  CATALOG_TOOLS,
  LOGISTICS_TOOLS,
  ANALYTICS_TOOLS,
} from '../scripts/mcp-multi-server';
import { PipelineService } from '../scripts/pipeline-service';
import { testMcpConnection } from '../src/agent/mcp/McpClient';
import { McpRouter } from '../src/agent/mcp/McpRouter';
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

export async function runDay20OrchestrationTests() {
  console.log('\n🔥 Starting Day 20: Multi-Server MCP Orchestration & Smart Routing Test Suite...\n');

  const PORTS = {
    catalog: 3081,
    logistics: 3082,
    analytics: 3083,
  };

  const TEST_REPORTS_DIR = path.join(process.cwd(), 'data', 'test-reports-day20');

  // Setup clean test reports directory
  if (fs.existsSync(TEST_REPORTS_DIR)) {
    try {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    } catch {}
  }
  fs.mkdirSync(TEST_REPORTS_DIR, { recursive: true });

  const pipeline = PipelineService.getInstance();
  pipeline.setDefaultDirectory(TEST_REPORTS_DIR);

  let runningServers: RunningServers | null = null;

  try {
    // ----------------------------------------------------
    // Test T1: Start 3 Dedicated MCP Servers & Validate Independent Tool Registries
    // ----------------------------------------------------
    console.log('--- Test T1: Start 3 MCP Servers & Verify Domain Isolation ---');
    runningServers = await startAllMcpServers(PORTS);

    const catalogConfig: McpServerConfig = {
      id: 'server-catalog-test',
      name: 'Каталог и Склад',
      url: `http://localhost:${PORTS.catalog}/sse`,
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
    };

    const logisticsConfig: McpServerConfig = {
      id: 'server-logistics-test',
      name: 'Логистика и Заказы',
      url: `http://localhost:${PORTS.logistics}/sse`,
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
    };

    const analyticsConfig: McpServerConfig = {
      id: 'server-analytics-test',
      name: 'Аналитика и Отчеты',
      url: `http://localhost:${PORTS.analytics}/sse`,
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
    };

    const testServers = [catalogConfig, logisticsConfig, analyticsConfig];
    mockStorage.set('agent_mcp_servers', JSON.stringify(testServers));

    // Discover tools on each server independently
    const catalogDiscovery = await testMcpConnection(catalogConfig);
    assert.equal(catalogDiscovery.success, true, `Catalog server connection failed: ${catalogDiscovery.error}`);
    const catalogToolNames = catalogDiscovery.tools.map((t) => t.name);
    console.log(`✓ Catalog Server (port ${PORTS.catalog}) tools: ${catalogToolNames.join(', ')}`);
    assert.ok(catalogToolNames.includes('store_search_products'));
    assert.ok(catalogToolNames.includes('store_get_product'));
    assert.ok(catalogToolNames.includes('calculate'));
    // Ensure domain isolation: no logistics or analytics tools here
    assert.ok(!catalogToolNames.includes('delivery_calculate_cost'));
    assert.ok(!catalogToolNames.includes('saveToFile'));

    const logisticsDiscovery = await testMcpConnection(logisticsConfig);
    assert.equal(logisticsDiscovery.success, true, `Logistics server connection failed: ${logisticsDiscovery.error}`);
    const logisticsToolNames = logisticsDiscovery.tools.map((t) => t.name);
    console.log(`✓ Logistics Server (port ${PORTS.logistics}) tools: ${logisticsToolNames.join(', ')}`);
    assert.ok(logisticsToolNames.includes('order_get_status'));
    assert.ok(logisticsToolNames.includes('delivery_calculate_cost'));
    assert.ok(logisticsToolNames.includes('schedule_monitor'));
    // Domain isolation
    assert.ok(!logisticsToolNames.includes('store_search_products'));
    assert.ok(!logisticsToolNames.includes('saveToFile'));

    const analyticsDiscovery = await testMcpConnection(analyticsConfig);
    assert.equal(analyticsDiscovery.success, true, `Analytics server connection failed: ${analyticsDiscovery.error}`);
    const analyticsToolNames = analyticsDiscovery.tools.map((t) => t.name);
    console.log(`✓ Analytics Server (port ${PORTS.analytics}) tools: ${analyticsToolNames.join(', ')}`);
    assert.ok(analyticsToolNames.includes('search'));
    assert.ok(analyticsToolNames.includes('summarize'));
    assert.ok(analyticsToolNames.includes('saveToFile'));
    assert.ok(analyticsToolNames.includes('get_aggregated_summary'));
    // Domain isolation
    assert.ok(!analyticsToolNames.includes('order_get_status'));
    assert.ok(!analyticsToolNames.includes('store_get_product'));

    console.log('✅ Test T1 Passed: All 3 servers are online with strict domain isolation.');

    // ----------------------------------------------------
    // Test T2: Dynamic Tool Registry (McpRouter) & Smart Direct Routing
    // ----------------------------------------------------
    console.log('\n--- Test T2: McpRouter Dynamic Indexing & Targeted Dispatch ---');
    const router = McpRouter.getInstance();
    router.reset();

    const discoveredMap = await router.discoverAllTools(testServers, true);
    assert.equal(discoveredMap.size, 3, 'Router should have indexed all 3 servers');

    // Test smart target server resolution
    const target1 = router.resolveTargetServer('store_search_products', testServers);
    assert.equal(target1?.id, catalogConfig.id, 'store_search_products must route to Catalog server');

    const target2 = router.resolveTargetServer('delivery_calculate_cost', testServers);
    assert.equal(target2?.id, logisticsConfig.id, 'delivery_calculate_cost must route to Logistics server');

    const target3 = router.resolveTargetServer('saveToFile', testServers);
    assert.equal(target3?.id, analyticsConfig.id, 'saveToFile must route to Analytics server');

    // Test direct execution via router
    const call1 = await router.executeTool('store_search_products', { query: 'iPhone' }, testServers);
    assert.equal(call1.isError, false, `call1 should not be error: ${call1.result}`);
    assert.equal(call1.serverName, catalogConfig.name);
    assert.equal(call1.serverUrl, catalogConfig.url);
    assert.ok(call1.result?.includes('PHONE-15-PRO'));

    const call2 = await router.executeTool('delivery_calculate_cost', { city: 'Казань', weight_kg: 2, express: true }, testServers);
    assert.equal(call2.isError, false);
    assert.equal(call2.serverName, logisticsConfig.name);
    assert.equal(call2.serverUrl, logisticsConfig.url);
    assert.ok(call2.result?.includes('Казань'));

    const call3 = await router.executeTool(
      'saveToFile',
      { content: '# Routing Test Content', filename: 'route-test.md', directory: TEST_REPORTS_DIR },
      testServers
    );
    assert.equal(call3.isError, false);
    assert.equal(call3.serverName, analyticsConfig.name);
    assert.equal(call3.serverUrl, analyticsConfig.url);
    assert.ok(call3.result?.includes('route-test.md'));
    assert.ok(fs.existsSync(path.join(TEST_REPORTS_DIR, 'route-test.md')));

    console.log('✅ Test T2 Passed: McpRouter routes directly to correct target servers with full metadata.');

    // ----------------------------------------------------
    // Test T3: Multi-Server System Prompt Generation
    // ----------------------------------------------------
    console.log('\n--- Test T3: Server-Aware System Prompt Grouping ---');
    const prompt = router.formatSystemPromptInstructions(testServers);
    assert.ok(prompt.includes('Каталог и Склад'), 'Prompt must list Catalog server');
    assert.ok(prompt.includes('Логистика и Заказы'), 'Prompt must list Logistics server');
    assert.ok(prompt.includes('Аналитика и Отчеты'), 'Prompt must list Analytics server');
    assert.ok(prompt.includes('store_search_products'));
    assert.ok(prompt.includes('delivery_calculate_cost'));
    assert.ok(prompt.includes('saveToFile'));
    assert.ok(prompt.includes('MULTI-SERVER WORKFLOW'));

    console.log('✅ Test T3 Passed: System prompt accurately describes servers and orchestration.');

    // ----------------------------------------------------
    // Test T4: Long Autonomous Interaction Flow Across 3 MCP Servers
    // ----------------------------------------------------
    console.log('\n--- Test T4: Long Autonomous Interaction Flow (Catalog -> Logistics -> Analytics) ---');
    const agent = new Agent('chat-day20-orchestration');
    agent.setApiKey('test-dummy-api-key');

    // Mock LLM to simulate multi-turn cross-server orchestration:
    // Turn 1 (Agent): calls Catalog Server to search laptop
    // Turn 2 (Agent): calls Catalog Server to get exact SKU specs
    // Turn 3 (Agent): calls Logistics Server to calculate delivery to Kazan
    // Turn 4 (Agent): calls Analytics Server to summarize data
    // Turn 5 (Agent): calls Analytics Server to saveToFile
    // Turn 6 (Agent): returns final human-readable response

    let turnStep = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      turnStep++;
      const lastUserMsg = messages[messages.length - 1]?.content || '';

      if (turnStep === 1) {
        // Step 1: LLM selects Catalog tool: store_search_products
        return {
          content: `<mcp_call name="store_search_products">{"query": "ноутбук", "max_price": 150000}</mcp_call>`,
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
        };
      }

      if (turnStep === 2) {
        // Inspect tool result from Step 1
        assert.ok(lastUserMsg.includes('LAPTOP-AIR-M3'), 'Result of Step 1 must be passed to LLM');
        // Step 2: LLM selects Catalog tool: store_get_product for details
        return {
          content: `<mcp_call name="store_get_product">{"sku": "LAPTOP-AIR-M3"}</mcp_call>`,
          promptTokens: 150,
          completionTokens: 20,
          totalTokens: 170,
        };
      }

      if (turnStep === 3) {
        // Inspect tool result from Step 2
        assert.ok(lastUserMsg.includes('149990'), 'Product details must contain price');
        // Step 3: LLM routes to Logistics Server: delivery_calculate_cost
        return {
          content: `<mcp_call name="delivery_calculate_cost">{"city": "Казань", "weight_kg": 1.5, "express": true}</mcp_call>`,
          promptTokens: 200,
          completionTokens: 25,
          totalTokens: 225,
        };
      }

      if (turnStep === 4) {
        // Inspect delivery result from Step 3
        assert.ok(lastUserMsg.includes('Казань'), 'Delivery result must be present');
        // Step 4: LLM routes to Analytics Server: summarize
        return {
          content: `<mcp_call name="summarize">{"title": "Расчет покупки MacBook Air M3 с экспресс-доставкой в Казань", "content": "Ноутбук Apple MacBook Air 13 M3 16/512GB Space Gray. Цена: 149990 руб. Склад: Москва Север, в наличии 5 шт. Доставка в Казань: Экспресс-курьер 950 руб, срок 1-2 дня. Итого бюджет: 150940 руб."}</mcp_call>`,
          promptTokens: 250,
          completionTokens: 40,
          totalTokens: 290,
        };
      }

      if (turnStep === 5) {
        // Step 5: LLM routes to Analytics Server: saveToFile
        return {
          content: `<mcp_call name="saveToFile">{"filename": "laptop-order-kazan.md", "content": "# Расчет покупки MacBook Air M3\\n\\n- Товар: Apple MacBook Air 13 M3 (149 990 руб)\\n- Экспресс-доставка в Казань: 950 руб (1-2 дня)\\n- Итого: 150 940 руб\\n- Статус: в наличии на складе (5 шт)"}</mcp_call>`,
          promptTokens: 300,
          completionTokens: 35,
          totalTokens: 335,
        };
      }

      // Step 6: Final synthesis without tool tags
      return {
        content: `Я подобрал для вас оптимальный ноутбук Apple MacBook Air 13 M3 (149 990 руб., в наличии 5 шт.). Экспресс-доставка в Казань займет 1-2 дня и будет стоить 950 руб. Общая сумма заказа составит 150 940 руб. Полный расчет сохранен в файл laptop-order-kazan.md.`,
        promptTokens: 350,
        completionTokens: 50,
        totalTokens: 400,
      };
    };

    await agent.sendMessage(
      'Подбери мне лучший ноутбук для работы до 150000 руб, проверь его наличие и характеристики, рассчитай стоимость и срок экспресс-доставки в Казань, а затем сформируй подробный аналитический отчет и сохрани его на диск в data/reports.'
    );

    const msgs = agent.getState().messages;
    const lastMsg = msgs[msgs.length - 1];
    assert.equal(lastMsg.role, 'assistant');
    assert.ok(lastMsg.content.includes('laptop-order-kazan.md'));
    assert.ok(lastMsg.content.includes('150 940'));

    // Check executed MCP calls sequence
    const executedCalls = lastMsg.mcpCalls || [];
    console.log(`Executed multi-server call count: ${executedCalls.length}`);
    assert.equal(executedCalls.length, 5, 'Agent must have executed all 5 sequential steps');

    const expectedSequence = [
      { tool: 'store_search_products', server: 'Каталог и Склад', port: PORTS.catalog },
      { tool: 'store_get_product', server: 'Каталог и Склад', port: PORTS.catalog },
      { tool: 'delivery_calculate_cost', server: 'Логистика и Заказы', port: PORTS.logistics },
      { tool: 'summarize', server: 'Аналитика и Отчеты', port: PORTS.analytics },
      { tool: 'saveToFile', server: 'Аналитика и Отчеты', port: PORTS.analytics },
    ];

    for (let i = 0; i < expectedSequence.length; i++) {
      const exp = expectedSequence[i];
      const actual = executedCalls[i];
      assert.equal(actual.toolName, exp.tool, `Step ${i + 1} tool must be ${exp.tool}`);
      assert.equal(actual.serverName, exp.server, `Step ${i + 1} server must be ${exp.server}`);
      assert.ok(actual.serverUrl?.includes(String(exp.port)), `Step ${i + 1} port must be ${exp.port}`);
      assert.equal(actual.isError, false, `Step ${i + 1} must succeed without error`);
      console.log(`  Step ${i + 1}: ${actual.toolName} -> ${actual.serverName} (${actual.serverUrl}) [OK]`);
    }

    // Verify file on disk created by Analytics server
    const savedFilePath = path.join(TEST_REPORTS_DIR, 'laptop-order-kazan.md');
    assert.ok(fs.existsSync(savedFilePath), 'Report file must exist on disk');
    const savedContent = fs.readFileSync(savedFilePath, 'utf8');
    assert.ok(savedContent.includes('MacBook Air 13 M3'));
    assert.ok(savedContent.includes('150 940 руб'));

    console.log('✅ Test T4 Passed: Long 5-step cross-server orchestration executed with exact causal order and file saved.');

    // ----------------------------------------------------
    // Test T5: Order Audit Cross-Server Flow
    // ----------------------------------------------------
    console.log('\n--- Test T5: Order Audit Cross-Server Flow ---');
    const agentAudit = new Agent('chat-day20-audit');
    agentAudit.setApiKey('test-dummy-api-key');

    let auditStep = 0;
    (agentAudit as any).callLLM = async (messages: any[]) => {
      auditStep++;
      if (auditStep === 1) {
        // Step 1: Check order in Logistics server
        return {
          content: `<mcp_call name="order_get_status">{"order_id": "ORD-7741"}</mcp_call>`,
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        };
      }
      if (auditStep === 2) {
        // Step 2: Check current stock of the ordered item in Catalog server
        return {
          content: `<mcp_call name="store_get_product">{"sku": "PHONE-15-PRO"}</mcp_call>`,
          promptTokens: 150,
          completionTokens: 20,
          totalTokens: 170,
        };
      }
      // Step 3: Final response
      return {
        content: `Заказ ORD-7741 находится в статусе доставки курьером. Товар PHONE-15-PRO на центральном складе в достаточном количестве.`,
        promptTokens: 200,
        completionTokens: 30,
        totalTokens: 230,
      };
    };

    await agentAudit.sendMessage('Проверь статус заказа ORD-7741 и наличие его товаров на складе.');
    const auditMsgs = agentAudit.getState().messages;
    const auditLastMsg = auditMsgs[auditMsgs.length - 1];
    const auditCalls = auditLastMsg.mcpCalls || [];
    assert.equal(auditCalls.length, 2);
    assert.equal(auditCalls[0].toolName, 'order_get_status');
    assert.equal(auditCalls[0].serverName, 'Логистика и Заказы');
    assert.equal(auditCalls[1].toolName, 'store_get_product');
    assert.equal(auditCalls[1].serverName, 'Каталог и Склад');

    console.log('✅ Test T5 Passed: Order audit cross-server flow routed correctly.');

    // ----------------------------------------------------
    // Test T6: Error Isolation & Missing Tool Protection
    // ----------------------------------------------------
    console.log('\n--- Test T6: Error Isolation & Unknown Tool Handling ---');
    const unknownRes = await router.executeTool('non_existent_tool_xyz', {}, testServers);
    assert.equal(unknownRes.isError, true);
    assert.ok(unknownRes.result?.includes('Ошибка маршрутизации') || unknownRes.result?.includes('не найден') || unknownRes.result?.includes('Tool not found'));

    // Server offline isolation: if logistics server is disabled, catalog still works
    const disabledLogistics = testServers.map((s) => (s.id === logisticsConfig.id ? { ...s, enabled: false } : s));
    const catalogDirect = await router.executeTool('calculate', { expression: '25 * 4' }, disabledLogistics);
    assert.equal(catalogDirect.isError, false);
    assert.ok(catalogDirect.result?.includes('100'));

    console.log('✅ Test T6 Passed: Missing tools and disabled servers handled gracefully with zero crashes.');

    console.log('\n🎉 ALL DAY 20 MULTI-SERVER MCP ORCHESTRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    if (runningServers) {
      await runningServers.closeAll();
      console.log('🛑 Closed all 3 test MCP servers.');
    }
  }
}

// Standalone execution
if (
  process.argv[1]?.endsWith('test-day20-orchestration.ts') ||
  process.argv[1]?.endsWith('test-day20-orchestration.js')
) {
  runDay20OrchestrationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ DAY 20 TEST SUITE FAILED:', err);
      process.exit(1);
    });
}
