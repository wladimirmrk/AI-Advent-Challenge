/**
 * Automated test suite for MCP Scopes:
 * 1. Global MCP Master Switch (Enable / Disable)
 * 2. Per-Chat MCP Server Isolation (Chat A custom tools vs Chat B)
 * 3. Per-Chat Enable / Disable Override
 * 4. McpRouter dynamic routing with chat-specific tools
 * 5. Cleanup on Chat Deletion
 */

import { strict as assert } from 'node:assert';

// Mock browser globals (localStorage, window) for Node environment
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
import { McpServerConfig } from '../src/agent/mcp/types';
import { chatManagerInstance } from '../src/agent/ChatManager';
import { loadMcpServers, saveMcpServers } from '../src/agent/mcp/storage';

export async function runMcpScopeTests() {
  console.log('\n🌐 Starting MCP Scopes (Global & Per-Chat) Test Suite...\n');

  mockStorage.clear();

  // Setup default global servers
  const baseGlobalServers: McpServerConfig[] = [
    {
      id: 'global-calc-server',
      name: 'Global Calculator',
      url: 'http://localhost:3001/sse',
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
      scope: 'global',
    },
  ];
  saveMcpServers(baseGlobalServers);

  // ----------------------------------------------------
  // Test S1: Default State & Global Master Switch
  // ----------------------------------------------------
  console.log('--- Test S1: Global Master Switch ---');
  const agent1 = new Agent('chat-test-1');

  assert.equal(agent1.isGlobalMcpEnabled(), true, 'MCP should be enabled globally by default');
  assert.equal(agent1.isMcpActive(), true, 'Agent MCP should be active by default');
  assert.equal(agent1.getEffectiveMcpServers().length, 1, 'Should have 1 effective global server');

  const initialPrompt = agent1.formatMcpToolsPrompt();
  assert.ok(initialPrompt.includes('Global Calculator'), 'System prompt should mention Global Calculator');

  // Turn off globally
  agent1.setGlobalMcpEnabled(false);
  assert.equal(agent1.isGlobalMcpEnabled(), false, 'Global MCP should be false after setGlobalMcpEnabled(false)');
  assert.equal(agent1.isMcpActive(), false, 'Agent MCP should be inactive when global is off');
  assert.equal(agent1.getEffectiveMcpServers().length, 0, 'Effective servers should be empty when global is off');
  assert.equal(agent1.formatMcpToolsPrompt(), '', 'Prompt should be empty string when global is off');

  const execResult = await agent1.executeMcpTool('calculate', { expression: '2+2' });
  assert.equal(execResult.isError, true, 'Tool execution must fail when MCP is off');
  assert.ok(execResult.result?.includes('MCP отключен'), 'Error message should explain MCP is disabled');

  // Turn back on globally
  agent1.setGlobalMcpEnabled(true);
  assert.equal(agent1.isMcpActive(), true, 'Agent MCP should be active again');
  console.log('✅ Test S1 Passed: Global Master Switch works properly!');

  // ----------------------------------------------------
  // Test S2: Per-Chat MCP Server Isolation
  // ----------------------------------------------------
  console.log('\n--- Test S2: Per-Chat MCP Server Isolation ---');
  const chatA = new Agent('chat-project-alpha');
  const chatB = new Agent('chat-project-beta');

  const customServerA: McpServerConfig = {
    id: 'chat-a-dev-server',
    name: 'Alpha Custom Dev Server',
    url: 'http://localhost:4050/sse',
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
    scope: 'chat',
    chatId: 'chat-project-alpha',
  };

  chatA.saveChatMcpServers([customServerA]);

  const serversA = chatA.getEffectiveMcpServers();
  const serversB = chatB.getEffectiveMcpServers();

  assert.equal(serversA.length, 2, 'Chat A should have 2 effective servers (1 global + 1 chat)');
  assert.equal(serversB.length, 1, 'Chat B should have only 1 effective server (global only)');

  assert.ok(serversA.some((s) => s.id === 'chat-a-dev-server'), 'Chat A must include its custom server');
  assert.ok(!serversB.some((s) => s.id === 'chat-a-dev-server'), 'Chat B must NOT have access to Chat A server');

  const promptA = chatA.formatMcpToolsPrompt();
  const promptB = chatB.formatMcpToolsPrompt();

  assert.ok(promptA.includes('Alpha Custom Dev Server'), 'Chat A prompt should include Alpha Custom Dev Server');
  assert.ok(!promptB.includes('Alpha Custom Dev Server'), 'Chat B prompt must NOT include Alpha Custom Dev Server');

  console.log('✅ Test S2 Passed: Per-chat MCP servers are strictly isolated!');

  // ----------------------------------------------------
  // Test S3: Per-Chat Enable / Disable Override
  // ----------------------------------------------------
  console.log('\n--- Test S3: Per-Chat Enable / Disable Override ---');
  // Global is enabled
  assert.equal(chatB.isGlobalMcpEnabled(), true);

  // Disable MCP only for Chat B
  chatB.setChatMcpEnabled(false);
  assert.equal(chatB.getChatMcpEnabledSetting(), false, 'Chat B setting should be false');
  assert.equal(chatB.isMcpActive(), false, 'Chat B should be inactive');
  assert.equal(chatB.getEffectiveMcpServers().length, 0, 'Chat B effective servers should be empty');
  assert.equal(chatB.formatMcpToolsPrompt(), '', 'Chat B prompt should be empty');

  // Verify Chat A remains active and unaffected!
  assert.equal(chatA.isMcpActive(), true, 'Chat A must remain active');
  assert.equal(chatA.getEffectiveMcpServers().length, 2, 'Chat A still has 2 servers');

  // Reset Chat B to inherit global
  chatB.setChatMcpEnabled(null);
  assert.equal(chatB.getChatMcpEnabledSetting(), null, 'Chat B setting should be null (inherit)');
  assert.equal(chatB.isMcpActive(), true, 'Chat B should now be active again');
  assert.equal(chatB.getEffectiveMcpServers().length, 1, 'Chat B restored global server');

  console.log('✅ Test S3 Passed: Per-chat enable/disable override functions correctly!');

  // ----------------------------------------------------
  // Test S4: AgentState & Token Stats Integration
  // ----------------------------------------------------
  console.log('\n--- Test S4: AgentState & Token Stats Integration ---');
  const stateA = chatA.getState();
  assert.equal(stateA.isMcpGloballyEnabled, true, 'stateA.isMcpGloballyEnabled should be true');
  assert.equal(stateA.effectiveMcpServersCount, 2, 'stateA.effectiveMcpServersCount should be 2');

  chatA.setGlobalMcpEnabled(false);
  const stateADisabled = chatA.getState();
  assert.equal(stateADisabled.isMcpGloballyEnabled, false, 'stateA.isMcpGloballyEnabled should be false');
  assert.equal(stateADisabled.effectiveMcpServersCount, 0, 'effectiveMcpServersCount should be 0 when disabled');

  chatA.setGlobalMcpEnabled(true);
  console.log('✅ Test S4 Passed: AgentState accurately reflects global and chat MCP statuses!');

  // ----------------------------------------------------
  // Test S5: Chat Storage Cleanup on Chat Deletion
  // ----------------------------------------------------
  console.log('\n--- Test S5: Chat Deletion Storage Cleanup ---');
  const { chat: tempChat } = chatManagerInstance.createChat('Ephemeral Chat');
  const tempAgent = chatManagerInstance.getAgent(tempChat.id);

  tempAgent.saveChatMcpServers([
    {
      id: 'temp-server',
      name: 'Temp Server',
      url: 'http://localhost:9999/sse',
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
      scope: 'chat',
      chatId: tempChat.id,
    },
  ]);
  tempAgent.setChatMcpEnabled(false);

  assert.equal(tempAgent.getChatMcpServers().length, 1);
  assert.equal(tempAgent.getChatMcpEnabledSetting(), false);

  // Delete chat
  chatManagerInstance.deleteChat(tempChat.id);

  const rawServersAfterDelete = mockStorage.get(`agent_${tempChat.id}_mcp_servers`);
  const rawEnabledAfterDelete = mockStorage.get(`agent_${tempChat.id}_mcp_enabled`);

  assert.equal(rawServersAfterDelete, undefined, 'Chat MCP servers storage should be deleted');
  assert.equal(rawEnabledAfterDelete, undefined, 'Chat MCP enabled setting storage should be deleted');
  console.log('✅ Test S5 Passed: Chat deletion properly purges chat MCP storage!');

  // ----------------------------------------------------
  // Test S6: Custom Third-Party Server (e.g. Google Stitch) System Prompt & Routing
  // ----------------------------------------------------
  console.log('\n--- Test S6: Custom MCP Server (Google Stitch) Prompt & Routing ---');
  const stitchChat = new Agent('chat-stitch');
  const stitchServer: McpServerConfig = {
    id: 'google-stitch-mcp',
    name: 'Google Stitch MCP',
    url: 'http://localhost:5500/sse',
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
    scope: 'chat',
    chatId: 'chat-stitch',
    tools: [
      {
        name: 'stitch_generate_ui',
        description: 'Generates UI code from design tokens',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Design prompt' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'stitch_export_component',
        description: 'Exports component to React JSX',
        inputSchema: {
          type: 'object',
          properties: {
            component_id: { type: 'string' },
          },
          required: ['component_id'],
        },
      },
    ],
  };

  stitchChat.saveChatMcpServers([stitchServer]);
  const stitchPrompt = stitchChat.formatMcpToolsPrompt();

  assert.ok(stitchPrompt.includes('Google Stitch MCP'), 'System prompt must include Google Stitch MCP');
  assert.ok(stitchPrompt.includes('stitch_generate_ui'), 'System prompt must include stitch_generate_ui');
  assert.ok(stitchPrompt.includes('stitch_export_component'), 'System prompt must include stitch_export_component');

  // CRITICAL CHECK: Google Stitch must NEVER receive hallucinated e-commerce tools like store_search_products!
  assert.ok(!stitchPrompt.includes('store_search_products: Поиск товаров'), 'Google Stitch must NOT contain store_search_products');

  // Verify routing routes stitch_generate_ui directly to google-stitch-mcp
  const router = stitchChat.getMcpRouter();
  const target = router.resolveTargetServer('stitch_generate_ui', stitchChat.getEffectiveMcpServers());
  assert.equal(target?.id, 'google-stitch-mcp', 'Must route stitch_generate_ui directly to google-stitch-mcp');

  console.log('✅ Test S6 Passed: Custom MCP Server (Google Stitch) tools correctly injected and routed!');

  // ----------------------------------------------------
  // Test S7: Robust Parsing and Routing for Google Stitch
  // ----------------------------------------------------
  console.log('\n--- Test S7: Robust Parsing and Routing for Google Stitch ---');
  const agentStitch = new Agent('chat-stitch-syntax');

  // Verify parseMcpCalls handles server-name + function call in body
  const call1 = agentStitch.parseMcpCalls('<mcp_call name="google_stitch">list_projects()</mcp_call>');
  assert.equal(call1.length, 1);
  assert.equal(call1[0].name, 'list_projects', 'Should extract list_projects from body function syntax');

  // Verify parseMcpCalls handles tool="..." attribute
  const call2 = agentStitch.parseMcpCalls('<mcp_call server="Google Stitch" tool="list_projects">{}</mcp_call>');
  assert.equal(call2.length, 1);
  assert.equal(call2[0].name, 'list_projects', 'Should extract tool name from tool attribute');

  // Verify parseMcpCalls handles namespaced name="google_stitch.list_projects"
  const call3 = agentStitch.parseMcpCalls('<mcp_call name="google_stitch.list_projects">{"pageSize": 10}</mcp_call>');
  assert.equal(call3.length, 1);
  assert.equal(call3[0].name, 'list_projects', 'Should strip prefix and extract tool name');
  assert.equal((call3[0].args as any).pageSize, 10);

  // Verify parseMcpCalls handles self-closing tag <mcp_call name="list_projects"/>
  const call4 = agentStitch.parseMcpCalls('<mcp_call name="list_projects"/>');
  assert.equal(call4.length, 1);
  assert.equal(call4[0].name, 'list_projects', 'Should handle self-closing tag');

  // Verify parseMcpCalls handles JSON body with action / tool field
  const call5 = agentStitch.parseMcpCalls('<mcp_call name="google_stitch">{"action": "list_projects"}</mcp_call>');
  assert.equal(call5.length, 1);
  assert.equal(call5[0].name, 'list_projects', 'Should extract tool name from action parameter');

  // Verify parseMcpCalls handles generic wrapper name="mcp_call" with {"name": "list_projects"}
  const call6 = agentStitch.parseMcpCalls('<mcp_call name="mcp_call">{"name": "list_projects"}</mcp_call>');
  assert.equal(call6.length, 1);
  assert.equal(call6[0].name, 'list_projects', 'Should unwrap list_projects from name="mcp_call"');
  assert.deepEqual(call6[0].args, {}, 'Args should be empty object when tool name was unwrapped');

  // Verify parseMcpCalls handles generic wrapper name="mcp_call" with {"name": "list_projects", "arguments": {}}
  const call7 = agentStitch.parseMcpCalls('<mcp_call name="mcp_call">{"name": "list_projects", "arguments": {}}</mcp_call>');
  assert.equal(call7.length, 1);
  assert.equal(call7[0].name, 'list_projects');
  assert.deepEqual(call7[0].args, {});

  // Verify parseMcpCalls handles tag without name attribute: <mcp_call>{"name": "list_projects"}</mcp_call>
  const call8 = agentStitch.parseMcpCalls('<mcp_call>{"name": "list_projects"}</mcp_call>');
  assert.equal(call8.length, 1);
  assert.equal(call8[0].name, 'list_projects');
  assert.deepEqual(call8[0].args, {});

  // Verify parseMcpCalls handles <tool_call> with generic name and nested tool
  const call9 = agentStitch.parseMcpCalls('<tool_call>{"name": "mcp_call", "arguments": {"name": "list_projects"}}</tool_call>');
  assert.equal(call9.length, 1);
  assert.equal(call9[0].name, 'list_projects');
  assert.deepEqual(call9[0].args, {});

  // Verify parseMcpCalls handles Qwen format with generic name
  const call10 = agentStitch.parseMcpCalls('<|tool_call_start|>[{"name": "mcp_call", "arguments": {"name": "list_projects"}}]<|tool_call_end|>');
  assert.equal(call10.length, 1);
  assert.equal(call10[0].name, 'list_projects');
  assert.deepEqual(call10[0].args, {});

  // Test routing resolution with namespacing and server names
  const testServers: McpServerConfig[] = [
    {
      id: 'google-stitch-mcp',
      name: 'Google Stitch',
      url: 'https://stitch.googleapis.com/mcp',
      transport: 'sse',
      enabled: true,
      createdAt: Date.now(),
      scope: 'chat',
      chatId: 'chat-stitch-syntax',
      tools: [
        {
          name: 'list_projects',
          description: 'Lists all Stitch projects accessible to the user.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    },
  ];

  const stitchRouter = agentStitch.getMcpRouter();

  // Test namespaced resolution
  const targetPrefixed = stitchRouter.resolveTargetServer('google_stitch.list_projects', testServers);
  assert.equal(targetPrefixed?.id, 'google-stitch-mcp', 'Should resolve prefixed tool to google-stitch-mcp');

  // Test server-name resolution fallback
  const targetServerName = stitchRouter.resolveTargetServer('google_stitch', testServers);
  assert.equal(targetServerName?.id, 'google-stitch-mcp', 'Should resolve server name to google-stitch-mcp');

  console.log('✅ Test S7 Passed: Google Stitch tool parsing and routing work flawlessly!');

  console.log('\n🎉 ALL MCP SCOPE TESTS PASSED SUCCESSFULLY! 🎉\n');
}

// Direct execution via tsx
runMcpScopeTests().catch((err) => {
  console.error('❌ MCP Scope Tests Failed:', err);
  process.exit(1);
});
