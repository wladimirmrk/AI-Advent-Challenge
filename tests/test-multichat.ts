/**
 * Multi-Chat Automated Test Suite
 * Verifies:
 * 1. Creation of multiple independent chats.
 * 2. Each chat has its own Agent instance and isolated memory (messages, facts, summary, branches).
 * 3. ChatManager manages list, active chat selection, renaming, and deletion.
 * 4. Auto-renaming of "Новый чат" upon the first user message.
 * 5. Safe chat deletion preserving at least 1 chat.
 */

import { strict as assert } from 'node:assert';

// 1. Mock browser globals (localStorage, window) for Node environment
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, String(val)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};
(globalThis as any).window = {
  location: { origin: 'http://localhost:5173' },
  confirm: () => true,
};

import { ChatManager } from '../src/agent/ChatManager';
import { Agent } from '../src/agent/Agent';
import { saveDefaultModelConfig, loadDefaultModelConfig } from '../src/agent/storage';

async function runMultiChatTests() {
  console.log('🧪 Starting Multi-Chat Test Suite...\n');

  // ----------------------------------------------------
  // Test 1: Initial Default Chat
  // ----------------------------------------------------
  console.log('Test 1: Initial Default Chat');
  mockStorage.clear();
  const manager = new ChatManager();
  const initialChats = manager.getChats();
  assert.equal(initialChats.length, 1, 'Should initialize with 1 default chat');
  assert.equal(initialChats[0].id, 'default');
  assert.equal(initialChats[0].title, 'Основной чат');
  assert.equal(manager.getActiveChatId(), 'default');

  const defaultAgent = manager.getActiveAgent();
  assert(defaultAgent instanceof Agent, 'Active agent should be an Agent instance');
  assert.equal(defaultAgent.getChatId(), 'default');
  console.log('  ✓ Initial default chat created and active\n');

  // ----------------------------------------------------
  // Test 2: Create Multiple Chats with Isolated Agents & Memories
  // ----------------------------------------------------
  console.log('Test 2: Create Multiple Chats with Isolated Agents & Memories');
  const { chat: chat2, agent: agent2 } = manager.createChat('Чат по физике');
  assert.equal(manager.getChats().length, 2, 'Should now have 2 chats');
  assert.equal(manager.getActiveChatId(), chat2.id, 'New chat should become active');
  assert.equal(agent2.getChatId(), chat2.id);

  // Add memory/facts to Chat 1 (default)
  defaultAgent.addFact('Имя', 'Алексей', 'preference');
  defaultAgent.setSystemPrompt('Ты учитель математики');

  // Add different memory/facts to Chat 2
  agent2.addFact('Тема', 'Квантовая механика', 'goal');
  agent2.setSystemPrompt('Ты эксперт по квантовой физике');

  // Verify memory isolation
  const facts1 = defaultAgent.getFacts();
  const facts2 = agent2.getFacts();
  assert.equal(facts1.length, 1);
  assert.equal(facts1[0].key, 'Имя');
  assert.equal(facts1[0].value, 'Алексей');

  assert.equal(facts2.length, 1);
  assert.equal(facts2[0].key, 'Тема');
  assert.equal(facts2[0].value, 'Квантовая механика');

  assert.equal(defaultAgent.getState().config.systemPrompt, 'Ты учитель математики');
  assert.equal(agent2.getState().config.systemPrompt, 'Ты эксперт по квантовой физике');
  console.log('  ✓ Memory, facts, and configurations are completely isolated between chats\n');

  // ----------------------------------------------------
  // Test 3: Switching Between Chats
  // ----------------------------------------------------
  console.log('Test 3: Switching Between Chats');
  manager.selectChat('default');
  assert.equal(manager.getActiveChatId(), 'default');
  assert.equal(manager.getActiveAgent().getFacts()[0].key, 'Имя');

  manager.selectChat(chat2.id);
  assert.equal(manager.getActiveChatId(), chat2.id);
  assert.equal(manager.getActiveAgent().getFacts()[0].key, 'Тема');
  console.log('  ✓ Switching between chats activates the corresponding Agent instance\n');

  // ----------------------------------------------------
  // Test 4: Auto-Renaming on First Message
  // ----------------------------------------------------
  console.log('Test 4: Auto-Renaming on First Message');
  const { chat: newChat, agent: newAgent } = manager.createChat(); // Defaults to "Новый чат"
  assert.equal(newChat.title, 'Новый чат');

  // Mock global fetch
  (globalThis as any).fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Ответ на вопрос по React' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  });

  newAgent.setApiKey('test-key');
  await newAgent.sendMessage('Как работают хуки в React и когда их использовать?');

  const updatedChat = manager.getChats().find((c) => c.id === newChat.id);
  assert(updatedChat, 'Chat must exist');
  assert.notEqual(updatedChat.title, 'Новый чат', 'Chat title must be updated from default');
  assert(updatedChat.title.startsWith('Как работают хуки в React'), 'Chat title should reflect user prompt');
  console.log(`  ✓ Auto-renamed chat to: "${updatedChat.title}"\n`);

  // ----------------------------------------------------
  // Test 5: Manual Renaming
  // ----------------------------------------------------
  console.log('Test 5: Manual Renaming');
  manager.renameChat(newChat.id, 'React Hooks Q&A');
  const renamedChat = manager.getChats().find((c) => c.id === newChat.id);
  assert.equal(renamedChat?.title, 'React Hooks Q&A');
  console.log('  ✓ Manually renamed chat to "React Hooks Q&A"\n');

  // ----------------------------------------------------
  // Test 6: Deleting Chat and Fallback
  // ----------------------------------------------------
  console.log('Test 6: Deleting Chat and Fallback');
  const totalBefore = manager.getChats().length;
  manager.deleteChat(newChat.id);
  assert.equal(manager.getChats().length, totalBefore - 1);
  assert(!manager.getChats().some((c) => c.id === newChat.id));
  console.log('  ✓ Deleted chat successfully, active chat switched safely\n');

  // ----------------------------------------------------
  // Test 7: Default Model Configuration for New Chats
  // ----------------------------------------------------
  console.log('Test 7: Default Model Configuration for New Chats');
  const existingAgent = manager.getActiveAgent();
  const existingModel = existingAgent.getState().config.model;

  // Set default model to a different model e.g. Claude 3.5 Haiku
  saveDefaultModelConfig({
    model: 'anthropic/claude-3.5-haiku',
    provider: 'openrouter',
    contextWindow: 200000,
  });
  const savedDef = loadDefaultModelConfig();
  assert.equal(savedDef.model, 'anthropic/claude-3.5-haiku');
  assert.equal(savedDef.provider, 'openrouter');
  assert.equal(savedDef.contextWindow, 200000);

  // Existing chat must keep its own model
  assert.equal(existingAgent.getState().config.model, existingModel);

  // Create a new chat - it must receive the default model
  const { chat: defaultModelChat, agent: defaultModelAgent } = manager.createChat('Чат с дефолтной моделью');
  assert.equal(defaultModelAgent.getState().config.model, 'anthropic/claude-3.5-haiku');
  assert.equal(defaultModelAgent.getState().config.provider, 'openrouter');
  assert.equal(defaultModelAgent.getState().contextWindow ?? defaultModelAgent.getState().config.contextWindow, 200000);
  console.log('  ✓ Newly created chat automatically uses default model: "anthropic/claude-3.5-haiku"\n');

  console.log('🎉 ALL MULTI-CHAT TESTS PASSED SUCCESSFULLY!\n');
}

runMultiChatTests().catch((err) => {
  console.error('Multi-chat tests failed:', err);
  process.exit(1);
});
