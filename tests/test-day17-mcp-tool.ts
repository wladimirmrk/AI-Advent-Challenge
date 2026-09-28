/**
 * Day 17 Test Suite: First MCP Tool & Agent Integration
 *
 * Requirements verified:
 * 1. MCP Server tool registration (store_search_products, store_get_product, order_get_status, delivery_calculate_cost).
 * 2. Proper input schemas, descriptions, and required arguments validation.
 * 3. Structured tool result return via @modelcontextprotocol/sdk.
 * 4. Agent tool execution via callMcpTool.
 * 5. Full end-to-end agent invocation with tool call interception and response synthesis.
 */

import { strict as assert } from 'node:assert';
import { startMcpHttpServer } from '../scripts/mcp-server';
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

export async function runDay17McpTests() {
  console.log('\n🔥 Starting Day 17: First MCP Tool Test Suite...\n');

  const TEST_PORT = 3099;
  const server = await startMcpHttpServer(TEST_PORT);

  const serverConfig: McpServerConfig = {
    id: 'test-day17-server',
    name: 'Day 17 Mock Store Server',
    url: `http://localhost:${TEST_PORT}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  // Configure storage so Agent knows about this test server
  mockStorage.set('agent_mcp_servers', JSON.stringify([serverConfig]));

  try {
    // ----------------------------------------------------
    // Test T1: MCP Server Tool Registration & Schemas
    // ----------------------------------------------------
    console.log('--- Test T1: MCP Server Tool Registration & Metadata ---');
    const discoveryResult = await testMcpConnection(serverConfig);
    assert.equal(discoveryResult.success, true, `Connection should succeed: ${discoveryResult.error}`);

    const registeredToolNames = discoveryResult.tools.map((t) => t.name);
    console.log(`Discovered ${registeredToolNames.length} tools: ${registeredToolNames.join(', ')}`);

    const expectedTools = [
      'store_search_products',
      'store_get_product',
      'order_get_status',
      'delivery_calculate_cost',
    ];

    for (const tool of expectedTools) {
      assert.ok(
        registeredToolNames.includes(tool),
        `MCP Server must have registered tool: "${tool}"`
      );
    }

    // Verify input schemas
    const productTool = discoveryResult.tools.find((t) => t.name === 'store_get_product')!;
    assert.ok(productTool.description, 'store_get_product must have description');
    assert.deepEqual(productTool.inputSchema?.required, ['sku'], 'sku must be required');

    const orderTool = discoveryResult.tools.find((t) => t.name === 'order_get_status')!;
    assert.ok(orderTool.description, 'order_get_status must have description');
    assert.deepEqual(orderTool.inputSchema?.required, ['order_id'], 'order_id must be required');

    const deliveryTool = discoveryResult.tools.find((t) => t.name === 'delivery_calculate_cost')!;
    assert.ok(deliveryTool.description, 'delivery_calculate_cost must have description');
    assert.deepEqual(deliveryTool.inputSchema?.required, ['city'], 'city must be required');

    console.log('✅ Test T1 Passed: All 4 tools and schemas properly registered!\n');

    // ----------------------------------------------------
    // Test T2: Product Catalog Tools (search & get by SKU)
    // ----------------------------------------------------
    console.log('--- Test T2: Product Catalog Tools ---');
    // Search products
    const searchRes = await callMcpTool(serverConfig, 'store_search_products', { query: 'iPhone' });
    assert.equal(searchRes.success, true, 'store_search_products should succeed');
    assert.ok(searchRes.result, 'Should have text result');
    const searchData = JSON.parse(searchRes.result!);
    assert.ok(searchData.totalFound >= 1, 'Should find at least 1 iPhone');
    assert.ok(searchData.products[0].sku.includes('PHONE-15-PRO'));
    console.log(`  Found product: ${searchData.products[0].title} (SKU: ${searchData.products[0].sku})`);

    // Get specific product
    const productRes = await callMcpTool(serverConfig, 'store_get_product', { sku: 'PHONE-15-PRO' });
    assert.equal(productRes.success, true, 'store_get_product should succeed');
    const prodData = JSON.parse(productRes.result!);
    assert.equal(prodData.found, true);
    assert.equal(prodData.product.sku, 'PHONE-15-PRO');
    assert.equal(prodData.product.price, 119990);
    assert.equal(prodData.product.inStock, true);
    console.log(`  Product info: ${prodData.product.title}, Price: ${prodData.product.price} ${prodData.product.currency}`);

    // Unknown product SKU
    const notFoundProd = await callMcpTool(serverConfig, 'store_get_product', { sku: 'NON-EXISTENT' });
    const notFoundData = JSON.parse(notFoundProd.result!);
    assert.equal(notFoundData.found, false);
    console.log('✅ Test T2 Passed: Product catalog queries return accurate data!\n');

    // ----------------------------------------------------
    // Test T3: Order Tracking Tool (order_get_status)
    // ----------------------------------------------------
    console.log('--- Test T3: Order Tracking Tool ---');
    const orderRes = await callMcpTool(serverConfig, 'order_get_status', { order_id: 'ORD-7741' });
    assert.equal(orderRes.success, true, 'order_get_status should succeed');
    const orderData = JSON.parse(orderRes.result!);
    assert.equal(orderData.found, true);
    assert.equal(orderData.order.orderId, 'ORD-7741');
    assert.equal(orderData.order.clientName, 'Алексей Смирнов');
    assert.equal(orderData.order.status, 'shipped');
    assert.ok(orderData.order.trackNumber, 'Should contain tracking number');
    console.log(`  Order ORD-7741: status=${orderData.order.status}, track=${orderData.order.trackNumber}, courier=${orderData.order.courier}`);

    // Unknown order
    const unknownOrder = await callMcpTool(serverConfig, 'order_get_status', { order_id: 'ORD-0000' });
    const unknownOrderData = JSON.parse(unknownOrder.result!);
    assert.equal(unknownOrderData.found, false);
    console.log('✅ Test T3 Passed: Order tracking correctly resolves statuses!\n');

    // ----------------------------------------------------
    // Test T4: Delivery Calculation Tool (delivery_calculate_cost)
    // ----------------------------------------------------
    console.log('--- Test T4: Delivery Calculation Tool ---');
    const deliveryRes = await callMcpTool(serverConfig, 'delivery_calculate_cost', {
      city: 'Москва',
      weight_kg: 2.5,
      express: false,
    });
    assert.equal(deliveryRes.success, true, 'delivery_calculate_cost should succeed');
    const deliveryData = JSON.parse(deliveryRes.result!);
    assert.equal(deliveryData.city, 'Москва');
    assert.ok(deliveryData.totalCost > 0, 'Total cost must be > 0');
    assert.ok(deliveryData.estimatedDays, 'Estimated days must be present');
    console.log(`  Delivery to ${deliveryData.city}: ${deliveryData.totalCost} ${deliveryData.currency}, time: ${deliveryData.estimatedDays}`);

    // Express delivery
    const expressRes = await callMcpTool(serverConfig, 'delivery_calculate_cost', {
      city: 'Санкт-Петербург',
      weight_kg: 1.0,
      express: true,
    });
    const expressData = JSON.parse(expressRes.result!);
    assert.equal(expressData.isExpress, true);
    assert.ok(expressData.expressCost > 0);
    console.log(`  Express delivery to ${expressData.city}: ${expressData.totalCost} ${expressData.currency}`);
    console.log('✅ Test T4 Passed: Delivery calculation verified!\n');

    // ----------------------------------------------------
    // Test T5: Agent Integration & End-to-End Execution
    // ----------------------------------------------------
    console.log('--- Test T5: Agent Integration & End-to-End Tool Call ---');
    const agent = new Agent('chat-day17-test');
    agent.setApiKey('test-dummy-api-key');

    // 1. Verify MCP tools are injected into prompt
    const promptText = agent.formatMcpToolsPrompt();
    assert.ok(promptText.includes('store_search_products'), 'Prompt must contain store_search_products');
    assert.ok(promptText.includes('store_get_product'), 'Prompt must contain store_get_product');
    assert.ok(promptText.includes('order_get_status'), 'Prompt must contain order_get_status');
    assert.ok(promptText.includes('delivery_calculate_cost'), 'Prompt must contain delivery_calculate_cost');

    // 2. Verify parseMcpCalls helper
    const testContent = `Сейчас я проверю статус вашего заказа.
<mcp_call name="order_get_status">
{
  "order_id": "ORD-7741"
}
</mcp_call>`;
    const parsedCalls = agent.parseMcpCalls(testContent);
    assert.equal(parsedCalls.length, 1);
    assert.equal(parsedCalls[0].name, 'order_get_status');
    assert.equal(parsedCalls[0].args.order_id, 'ORD-7741');

    // 3. Test Agent executing MCP tool directly
    const execRes = await agent.executeMcpTool('order_get_status', { order_id: 'ORD-7741' });
    assert.equal(execRes.isError, false);
    assert.ok(execRes.result?.includes('Алексей Смирнов'));
    assert.ok(execRes.result?.includes('shipped'));
    console.log(`  Direct agent execution of order_get_status: success=${!execRes.isError}`);

    // 4. Test end-to-end sendMessage with simulated LLM tool invocation
    let callLlmCounter = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      callLlmCounter++;
      if (callLlmCounter === 1) {
        // First LLM step: Model decides to call MCP tool
        return {
          content: `Проверяю статус заказа в системе.\n<mcp_call name="order_get_status">{"order_id": "ORD-7741"}</mcp_call>`,
          promptTokens: 120,
          completionTokens: 35,
          totalTokens: 155,
          isEstimated: false,
        };
      } else {
        // Second LLM step: Model receives <mcp_result> and synthesizes final answer
        const lastUserMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastUserMsg.includes('<mcp_result name="order_get_status"'), 'Followup must include mcp_result');
        return {
          content: 'Ваш заказ ORD-7741 передан в курьерскую службу CDEK Express (трек-номер CDK-982341234) и ожидается к доставке завтра с 10:00 до 18:00.',
          promptTokens: 180,
          completionTokens: 40,
          totalTokens: 220,
          isEstimated: false,
        };
      }
    };

    const reply = await agent.sendMessage('Где сейчас мой заказ ORD-7741?');
    assert.equal(callLlmCounter, 2, 'Should execute 2 LLM steps (tool request + final synthesis)');
    assert.ok(reply.includes('ORD-7741'), 'Final response should include order ID');
    assert.ok(reply.includes('CDEK Express'), 'Final response should mention courier from tool data');

    // Verify assistant message contains mcpCalls metadata
    const state = agent.getState();
    const lastAssistantMsg = state.messages[state.messages.length - 1];
    assert.equal(lastAssistantMsg.role, 'assistant');
    assert.ok(lastAssistantMsg.mcpCalls, 'Assistant message must contain mcpCalls array');
    assert.equal(lastAssistantMsg.mcpCalls?.length, 1);
    assert.equal(lastAssistantMsg.mcpCalls?.[0].toolName, 'order_get_status');
    assert.equal(lastAssistantMsg.mcpCalls?.[0].isError, false);

    console.log(`  Agent final synthesized response: "${reply}"`);
    console.log(`  Recorded MCP call metadata: tool=${lastAssistantMsg.mcpCalls?.[0].toolName}, latency=${lastAssistantMsg.mcpCalls?.[0].latencyMs}ms`);
    console.log('\n✅ Test T5 Passed: Full end-to-end agent MCP tool call & synthesis verified!\n');

    // ----------------------------------------------------
    // Test T6: Qwen/Hermes <|tool_call_start|> Format & Human Synthesis
    // ----------------------------------------------------
    console.log('--- Test T6: Qwen/Hermes <|tool_call_start|> Format & Synthesis ---');
    const qwenContent = `<|tool_call_start|>[store_get_product(sku='PHONE-15-PRO')]<|tool_call_end|>`;
    const parsedQwen = agent.parseMcpCalls(qwenContent);
    assert.equal(parsedQwen.length, 1);
    assert.equal(parsedQwen[0].name, 'store_get_product');
    assert.equal(parsedQwen[0].args.sku, 'PHONE-15-PRO');

    let qwenLlmCounter = 0;
    (agent as any).callLLM = async (messages: any[]) => {
      qwenLlmCounter++;
      if (qwenLlmCounter === 1) {
        // Model emits Qwen token
        return {
          content: `<|tool_call_start|>[store_get_product(sku='PHONE-15-PRO')]<|tool_call_end|>`,
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          isEstimated: false,
        };
      } else {
        const lastMsg = messages[messages.length - 1]?.content || '';
        assert.ok(lastMsg.includes('<mcp_result name="store_get_product"'), 'Must contain product result');
        assert.ok(lastMsg.includes('"inStock": true'), 'Must contain inStock: true');
        return {
          content: 'Да, iPhone 15 Pro (артикул PHONE-15-PRO) есть на складе в наличии (14 шт.). Цена составляет 119 990 руб.',
          promptTokens: 150,
          completionTokens: 35,
          totalTokens: 185,
          isEstimated: false,
        };
      }
    };

    const qwenReply = await agent.sendMessage('Есть ли у нас на складе iPhone 15 Pro (артикул PHONE-15-PRO) и какая на него цена?');
    assert.equal(qwenLlmCounter, 2, 'Should execute 2 LLM steps');
    assert.ok(qwenReply.includes('119 990') || qwenReply.includes('119990'), 'Should contain price');
    assert.ok(qwenReply.includes('Да') || qwenReply.includes('наличии') || qwenReply.includes('складе'), 'Should confirm availability');
    assert.ok(!qwenReply.includes('<|tool_call_start|>'), 'Must not contain raw tool tokens');

    console.log(`  Qwen final synthesized response: "${qwenReply}"`);
    console.log('✅ Test T6 Passed: Qwen/Hermes tool calling format seamlessly processed!\n');

    console.log('🎉 ALL DAY 17 TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    console.log('🧹 Test MCP server shut down.\n');
  }
}

// Standalone execution
if (process.argv[1]?.endsWith('test-day17-mcp-tool.ts') || process.argv[1]?.endsWith('test-day17-mcp-tool.js')) {
  runDay17McpTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Day 17 MCP Test failed:', err);
      process.exit(1);
    });
}
