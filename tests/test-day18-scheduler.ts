/**
 * Day 18 Test Suite: MCP Scheduler & 24/7 Background Tasks
 *
 * Requirements verified:
 * 1. MCP Tools registration (schedule_monitor, get_aggregated_summary) & schemas.
 * 2. Delayed and periodic background task scheduling (interval_seconds, delay_seconds).
 * 3. Autonomous 24/7 background execution and data snapshot collection.
 * 4. JSON persistence on disk (reload and data integrity verification).
 * 5. Aggregated analytics: price deltas, stock alerts, order status tracking, executive summary.
 * 6. Agent end-to-end integration: scheduling and synthesizing periodic digests.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startMcpHttpServer, SchedulerService } from '../scripts/mcp-server';
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

export async function runDay18SchedulerTests() {
  console.log('\n🔥 Starting Day 18: MCP Scheduler & Background Tasks Test Suite...\n');

  const TEST_PORT = 3098;
  const TEST_STORAGE_PATH = path.join(process.cwd(), 'data', 'test-day18-scheduler.json');

  // Clean test file if exists
  if (fs.existsSync(TEST_STORAGE_PATH)) {
    try {
      fs.unlinkSync(TEST_STORAGE_PATH);
    } catch {}
  }

  // Configure scheduler with test file
  const scheduler = SchedulerService.getInstance();
  scheduler.setStoragePath(TEST_STORAGE_PATH);
  scheduler.clearAll();

  const server = await startMcpHttpServer(TEST_PORT);

  const serverConfig: McpServerConfig = {
    id: 'test-day18-server',
    name: 'Day 18 Scheduler MCP Server',
    url: `http://localhost:${TEST_PORT}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  mockStorage.set('agent_mcp_servers', JSON.stringify([serverConfig]));

  try {
    // ----------------------------------------------------
    // Test T1: MCP Tools Registration & Metadata
    // ----------------------------------------------------
    console.log('--- Test T1: MCP Server Tool Registration & Schemas ---');
    const discoveryResult = await testMcpConnection(serverConfig);
    assert.equal(discoveryResult.success, true, `Connection should succeed: ${discoveryResult.error}`);

    const registeredTools = discoveryResult.tools.map((t) => t.name);
    console.log(`Discovered tools: ${registeredTools.join(', ')}`);

    assert.ok(
      registeredTools.includes('schedule_monitor'),
      'schedule_monitor must be registered on MCP server'
    );
    assert.ok(
      registeredTools.includes('get_aggregated_summary'),
      'get_aggregated_summary must be registered on MCP server'
    );

    const scheduleTool = discoveryResult.tools.find((t) => t.name === 'schedule_monitor')!;
    assert.ok(scheduleTool.description, 'schedule_monitor must have a description');
    assert.deepEqual(
      scheduleTool.inputSchema?.required,
      ['interval_seconds'],
      'interval_seconds must be required for schedule_monitor'
    );

    const summaryTool = discoveryResult.tools.find((t) => t.name === 'get_aggregated_summary')!;
    assert.ok(summaryTool.description, 'get_aggregated_summary must have a description');

    console.log('✅ Test T1 Passed: All Day 18 scheduler tools and schemas are properly registered!\n');

    // ----------------------------------------------------
    // Test T2: Task Scheduling (Immediate & Periodic)
    // ----------------------------------------------------
    console.log('--- Test T2: Scheduling Tasks via MCP Tool ---');
    const scheduleRes = await callMcpTool(serverConfig, 'schedule_monitor', {
      target: 'all',
      interval_seconds: 2, // 2-second interval for test
      notes: 'Test background catalog monitor',
    });

    assert.equal(scheduleRes.success, true, 'schedule_monitor tool call should succeed');
    assert.ok(scheduleRes.result, 'Should return text result');

    const scheduleData = JSON.parse(scheduleRes.result!);
    assert.equal(scheduleData.success, true);
    assert.ok(scheduleData.task.id, 'Task must have an ID');
    assert.equal(scheduleData.task.target, 'all');
    assert.equal(scheduleData.task.intervalSeconds, 2);
    assert.equal(scheduleData.task.status, 'active');
    assert.equal(scheduleData.task.runCount, 1, 'Initial runCount should be 1 upon zero delay');

    console.log(`  Created scheduled task: ID=${scheduleData.task.id}, nextRun=${scheduleData.task.nextRunAt}`);
    console.log('✅ Test T2 Passed: Task successfully created and queued!\n');

    // ----------------------------------------------------
    // Test T3: Autonomous 24/7 Background Execution
    // ----------------------------------------------------
    console.log('--- Test T3: Autonomous Background Execution & Snapshots ---');
    console.log('  Waiting 2.5 seconds for background timer tick...');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const tasks = scheduler.getTasks();
    const activeTask = tasks.find((t) => t.id === scheduleData.task.id);
    assert.ok(activeTask, 'Task must exist in scheduler');
    assert.ok(
      activeTask.runCount >= 2,
      `Task should have executed at least 2 cycles (actual: ${activeTask.runCount})`
    );

    const snapshots = scheduler.getSnapshots();
    assert.ok(
      snapshots.length >= 2,
      `Scheduler should have recorded at least 2 snapshots (actual: ${snapshots.length})`
    );
    assert.ok(snapshots[0].products && snapshots[0].products.length > 0, 'Snapshot must contain products');
    assert.ok(snapshots[0].orders && snapshots[0].orders.length > 0, 'Snapshot must contain orders');

    console.log(`  Snapshots collected: ${snapshots.length}, run count: ${activeTask.runCount}`);
    console.log('✅ Test T3 Passed: Autonomous background cycles executed on schedule!\n');

    // ----------------------------------------------------
    // Test T4: JSON Persistence on Disk
    // ----------------------------------------------------
    console.log('--- Test T4: JSON Persistence on Disk ---');
    assert.ok(fs.existsSync(TEST_STORAGE_PATH), `Storage file must exist at ${TEST_STORAGE_PATH}`);

    const fileContent = fs.readFileSync(TEST_STORAGE_PATH, 'utf-8');
    const parsedData = JSON.parse(fileContent);
    assert.equal(parsedData.version, '1.0.0');
    assert.ok(Array.isArray(parsedData.tasks), 'Data must contain tasks array');
    assert.ok(Array.isArray(parsedData.snapshots), 'Data must contain snapshots array');
    assert.equal(parsedData.tasks.length, 1);
    assert.equal(parsedData.tasks[0].id, scheduleData.task.id);

    // Verify loading in a fresh instance
    const freshScheduler = new SchedulerService(TEST_STORAGE_PATH);
    const reloadedTasks = freshScheduler.getTasks();
    assert.equal(reloadedTasks.length, 1, 'Fresh instance must reload persisted tasks');
    assert.equal(reloadedTasks[0].id, scheduleData.task.id);
    assert.equal(freshScheduler.getSnapshots().length, snapshots.length);

    console.log(`  File size: ${Buffer.byteLength(fileContent)} bytes, tasks: ${reloadedTasks.length}, snapshots: ${freshScheduler.getSnapshots().length}`);
    console.log('✅ Test T4 Passed: State reliably persisted and reloaded from JSON file!\n');

    // ----------------------------------------------------
    // Test T5: Market Events Simulation & Aggregated Analytics
    // ----------------------------------------------------
    console.log('--- Test T5: Market Changes Simulation & Aggregated Analytics ---');
    // Simulate market events: price drop on iPhone, low stock on MacBook Air, delivered order
    scheduler.simulateProductChange('PHONE-15-PRO', 109990); // 119990 -> 109990 (-8.33%)
    scheduler.simulateProductChange('LAPTOP-AIR-M3', undefined, 2); // 5 -> 2 (Low stock alert)
    scheduler.simulateOrderStatusChange('ORD-7741', 'delivered'); // shipped -> delivered

    // Force one run cycle to capture changed data
    scheduler.runTaskCycle(scheduleData.task.id);

    // Call get_aggregated_summary MCP tool
    const summaryRes = await callMcpTool(serverConfig, 'get_aggregated_summary', { target: 'all' });
    assert.equal(summaryRes.success, true, 'get_aggregated_summary should succeed');
    assert.ok(summaryRes.result, 'Summary must return stringified JSON');

    const summaryData = JSON.parse(summaryRes.result!);
    assert.equal(summaryData.status, 'success');
    assert.ok(summaryData.totalCycles >= 3, 'Total cycles should be >= 3');

    // Verify Price Delta Detection
    const phoneDelta = summaryData.priceChanges.find((p: any) => p.sku === 'PHONE-15-PRO');
    assert.ok(phoneDelta, 'Should detect price change on PHONE-15-PRO');
    assert.equal(phoneDelta.oldPrice, 119990);
    assert.equal(phoneDelta.newPrice, 109990);
    assert.equal(phoneDelta.delta, -10000);
    console.log(`  Detected price delta: ${phoneDelta.title} -> ${phoneDelta.delta} RUB (${phoneDelta.percentChange}%)`);

    // Verify Stock Alerts
    const lowStockMac = summaryData.stockAlerts.lowStock.find((s: any) => s.sku === 'LAPTOP-AIR-M3');
    assert.ok(lowStockMac, 'Should alert on low stock for MacBook Air');
    assert.equal(lowStockMac.stockCount, 2);
    console.log(`  Detected stock alert: ${lowStockMac.title} -> ${lowStockMac.stockCount} left`);

    // Verify Order Status Changes
    const orderChange = summaryData.ordersSummary.statusChanges.find((o: any) => o.orderId === 'ORD-7741');
    assert.ok(orderChange, 'Should detect status change for ORD-7741');
    assert.equal(orderChange.oldStatus, 'shipped');
    assert.equal(orderChange.newStatus, 'delivered');
    console.log(`  Detected order status change: ORD-7741 (${orderChange.clientName}): ${orderChange.oldStatus} ➔ ${orderChange.newStatus}`);

    // Verify Executive Summary and Alerts
    assert.ok(summaryData.executiveSummary.length > 20, 'Executive summary should be descriptive');
    assert.ok(summaryData.alerts.length >= 2, 'Should generate multiple alerts');
    console.log(`  Executive summary: "${summaryData.executiveSummary}"`);
    console.log('✅ Test T5 Passed: Aggregated summary successfully calculated metrics & deltas!\n');

    // ----------------------------------------------------
    // Test T6: AI Agent End-to-End Scheduling & Summary Synthesis
    // ----------------------------------------------------
    console.log('--- Test T6: AI Agent End-to-End Scheduling & Digest Synthesis ---');
    const agent = new Agent('chat-day18-test');
    agent.setApiKey('test-dummy-api-key');

    // 1. Verify prompt contains schedule_monitor and get_aggregated_summary
    const mcpPrompt = agent.formatMcpToolsPrompt();
    assert.ok(mcpPrompt.includes('schedule_monitor'), 'Agent prompt must include schedule_monitor');
    assert.ok(mcpPrompt.includes('get_aggregated_summary'), 'Agent prompt must include get_aggregated_summary');

    // 2. Simulated LLM call: User requests periodic summary
    let agentCallCounter = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      agentCallCounter++;
      if (agentCallCounter === 1) {
        // Agent decides to call get_aggregated_summary
        return {
          content: `Запрашиваю актуальную сводку данных мониторинга у планировщика.\n<mcp_call name="get_aggregated_summary">{"target": "all"}</mcp_call>`,
          promptTokens: 150,
          completionTokens: 40,
          totalTokens: 190,
          isEstimated: false,
        };
      } else {
        // Agent synthesizes final response based on <mcp_result>
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('<mcp_result name="get_aggregated_summary"'), 'Must contain mcp_result');
        assert.ok(lastMsg.includes('PHONE-15-PRO'), 'Result must include product data');
        return {
          content: [
            '📊 **Сводка фонового мониторинга (24/7 Digest)**:',
            '- 📉 **Динамика цен:** Смартфон iPhone 15 Pro подешевел на 10 000 руб. (новая цена 109 990 руб.).',
            '- ⚠️ **Складские алерты:** Ноутбук MacBook Air 13" M3 заканчивается (осталось 2 шт.).',
            '- 📦 **Статусы заказов:** Заказ ORD-7741 успешно доставлен клиенту Алексею Смирнову.',
          ].join('\n'),
          promptTokens: 280,
          completionTokens: 75,
          totalTokens: 355,
          isEstimated: false,
        };
      }
    };

    const reply = await agent.sendMessage('Покажи сводку фонового мониторинга магазина');
    assert.equal(agentCallCounter, 2, 'Should execute 2 LLM steps (tool request + synthesis)');
    assert.ok(reply.includes('Сводка фонового мониторинга'), 'Reply must include digest header');
    assert.ok(reply.includes('109 990') || reply.includes('10 000'), 'Reply must include price change details');
    assert.ok(reply.includes('MacBook Air'), 'Reply must mention low stock item');
    assert.ok(reply.includes('ORD-7741'), 'Reply must mention order update');

    console.log(`  Agent final synthesized digest:\n${reply}`);
    console.log('\n✅ Test T6 Passed: Agent flawlessly executed tool and synthesized analytical digest!\n');

    console.log('🎉 ALL DAY 18 TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    scheduler.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    // Clean test storage
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      try {
        fs.unlinkSync(TEST_STORAGE_PATH);
      } catch {}
    }
    console.log('🧹 Cleaned up test resources and stopped scheduler.\n');
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-day18-scheduler.ts') || process.argv[1]?.endsWith('test-day18-scheduler.js')) {
  runDay18SchedulerTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Day 18 Scheduler Test failed:', err);
      process.exit(1);
    });
}
