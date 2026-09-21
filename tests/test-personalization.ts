/**
 * Automated test suite for Agent Personalization (Day 12):
 * 1. Built-in Profile Presets (Junior Frontend, Senior Architect, Tech Writer/PM)
 * 2. Profile Switching (Profile A vs Profile B prompt comparison)
 * 3. Categorized Preferences (Style, Format, Constraints) & Compliance Directive
 * 4. Multi-Chat Profile Isolation (Chat 1 vs Chat 2 active profiles)
 * 5. Custom Profile CRUD, Duplication & Reset Protection
 * 6. Token Breakdown & Recalculation upon Profile Switch
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
import {
  BUILTIN_PROFILES,
  loadUserProfiles,
  saveUserProfiles,
  loadActiveProfileId,
  saveActiveProfileId,
  resetBuiltinProfiles,
} from '../src/agent/storage';

export async function runPersonalizationTests() {
  console.log('\n🔥 Starting Day 12: Personalization & User Profiles Test Suite...\n');

  // Clear mock storage
  mockStorage.clear();

  // ----------------------------------------------------
  // Test P1: Built-in Presets Initialization
  // ----------------------------------------------------
  console.log('Test P1: Built-in profile presets loading and structure');
  const agent1 = new Agent('chat-p1');
  const profiles = agent1.getAllProfiles();

  assert.equal(profiles.length >= 3, true, 'At least 3 builtin profiles must exist');
  const junior = profiles.find((p) => p.id === 'junior_frontend');
  const senior = profiles.find((p) => p.id === 'senior_architect');
  const pm = profiles.find((p) => p.id === 'tech_writer_pm');

  assert.ok(junior, 'Junior Frontend preset must exist');
  assert.ok(senior, 'Senior Architect preset must exist');
  assert.ok(pm, 'Tech Writer / PM preset must exist');

  assert.equal(junior.isBuiltin, true);
  assert.equal(senior.isBuiltin, true);
  assert.equal(pm.isBuiltin, true);

  // Check structured categories (Style, Format, Constraints)
  assert.ok(junior.style && junior.style.length > 0, 'Junior style must be defined');
  assert.ok(junior.format && junior.format.length > 0, 'Junior format must be defined');
  assert.ok(junior.constraints && junior.constraints.length >= 3, 'Junior must have constraints');

  assert.ok(senior.style && senior.style.length > 0, 'Senior style must be defined');
  assert.ok(senior.format && senior.format.length > 0, 'Senior format must be defined');
  assert.ok(senior.constraints && senior.constraints.length >= 3, 'Senior must have constraints');

  assert.ok(pm.style && pm.style.length > 0, 'PM style must be defined');
  assert.ok(pm.format && pm.format.length > 0, 'PM format must be defined');
  assert.ok(pm.constraints && pm.constraints.length >= 3, 'PM must have constraints');

  console.log('  ✓ 3 distinct contrast presets verified with Style, Format and Constraints');
  console.log('  PASSED: Test P1.\n');

  // ----------------------------------------------------
  // Test P2: Profile Switching & Context Prompt Comparison
  // ----------------------------------------------------
  console.log('Test P2: Profile switching & prompt modification (Profile A vs Profile B)');
  
  // Set to Junior Dev
  agent1.setActiveProfile('junior_frontend');
  const juniorPrompt = agent1.formatLongTermMemoryPrompt();

  assert.ok(juniorPrompt.includes('Junior Frontend Developer'), 'Prompt must contain Junior role');
  assert.ok(juniorPrompt.includes('React / JavaScript'), 'Prompt must contain React/JS');
  assert.ok(juniorPrompt.includes('Communication Style:'), 'Prompt must include Communication Style header');
  assert.ok(juniorPrompt.includes('Response Format:'), 'Prompt must include Response Format header');
  assert.ok(juniorPrompt.includes('Strict Constraints:'), 'Prompt must include Strict Constraints header');
  assert.ok(juniorPrompt.includes('[PERSONALIZATION COMPLIANCE MANDATE]'), 'Prompt must include compliance mandate');

  // Switch to Senior Architect
  agent1.setActiveProfile('senior_architect');
  const seniorPrompt = agent1.formatLongTermMemoryPrompt();

  assert.ok(seniorPrompt.includes('Senior Software Architect'), 'Prompt must contain Senior role');
  assert.ok(seniorPrompt.includes('TypeScript strict'), 'Prompt must contain TypeScript strict');
  assert.ok(!seniorPrompt.includes('Junior Frontend Developer'), 'Senior prompt must not contain Junior role');
  assert.ok(seniorPrompt.includes('Никакой воды'), 'Prompt must contain Senior constraints');

  console.log('  ✓ Switching active profile instantly updates the LLM system prompt');
  console.log('  PASSED: Test P2.\n');

  // ----------------------------------------------------
  // Test P3: Compliance Directive Validation
  // ----------------------------------------------------
  console.log('Test P3: Compliance directive enforcement');
  agent1.setActiveProfile('senior_architect');
  const promptWithDirective = agent1.formatLongTermMemoryPrompt();

  assert.ok(
    promptWithDirective.includes('Ты обязан строго адаптировать свой тон, форматирование и глубину ответа'),
    'Must include base compliance instruction'
  );
  assert.ok(
    promptWithDirective.includes('ВНИМАНИЕ: Не нарушай указанные ограничения ни при каких условиях'),
    'Must include strict non-violation warning'
  );
  assert.ok(
    promptWithDirective.includes('Ограничения профиля имеют наивысший приоритет'),
    'Must assert highest priority of constraints'
  );

  console.log('  ✓ Compliance directive strictly mandates tone, format, and constraint adherence');
  console.log('  PASSED: Test P3.\n');

  // ----------------------------------------------------
  // Test P4: Multi-Chat Profile Isolation
  // ----------------------------------------------------
  console.log('Test P4: Multi-chat active profile isolation');
  const chatAgentA = new Agent('chat-alpha');
  const chatAgentB = new Agent('chat-beta');

  chatAgentA.setActiveProfile('junior_frontend');
  chatAgentB.setActiveProfile('tech_writer_pm');

  assert.equal(chatAgentA.getActiveProfileId(), 'junior_frontend');
  assert.equal(chatAgentB.getActiveProfileId(), 'tech_writer_pm');

  const promptA = chatAgentA.formatLongTermMemoryPrompt();
  const promptB = chatAgentB.formatLongTermMemoryPrompt();

  assert.ok(promptA.includes('Junior Frontend'), 'Chat Alpha must use Junior profile');
  assert.ok(promptB.includes('Technical Writer & Product Manager'), 'Chat Beta must use PM profile');

  // Verify persistence under isolated chat storage keys
  const persistedA = loadActiveProfileId('chat-alpha');
  const persistedB = loadActiveProfileId('chat-beta');
  assert.equal(persistedA, 'junior_frontend');
  assert.equal(persistedB, 'tech_writer_pm');

  console.log('  ✓ Each chat maintains its own independent active profile selection');
  console.log('  PASSED: Test P4.\n');

  // ----------------------------------------------------
  // Test P5: Custom Profile CRUD, Duplication & Safety
  // ----------------------------------------------------
  console.log('Test P5: Custom profile creation, duplication, deletion, and preset reset');

  // Create custom profile
  const customProfile = agent1.createProfile({
    name: 'Игорь',
    role: 'Staff Site Reliability Engineer (Kubernetes / SRE)',
    style: 'Экстремально сухой, сфокусированный на метриках и инцидентах',
    format: 'Post-mortem отчеты, alert-правила, YAML-манифесты',
    constraints: [
      'Никакого GUI кода',
      'Только Linux CLI и kubectl команды',
      'Все решения проверять на SLO 99.99%',
    ],
    customNotes: 'Дежурный инженер on-call.',
  });

  assert.ok(customProfile.id.startsWith('profile-'));
  assert.equal(agent1.getActiveProfileId(), customProfile.id);
  assert.equal(customProfile.isBuiltin, false);

  const customPrompt = agent1.formatLongTermMemoryPrompt();
  assert.ok(customPrompt.includes('Staff Site Reliability Engineer'));
  assert.ok(customPrompt.includes('SLO 99.99%'));

  // Duplicate profile
  const duplicate = agent1.duplicateProfile(customProfile.id);
  assert.ok(duplicate, 'Duplicate must succeed');
  assert.notEqual(duplicate?.id, customProfile.id);
  assert.ok(duplicate?.name.includes('(Копия)'));
  assert.equal(duplicate?.isBuiltin, false);

  // Attempt to delete builtin profile (should be disallowed)
  const deleteBuiltinResult = agent1.deleteProfile('junior_frontend');
  assert.equal(deleteBuiltinResult, false, 'Builtin profiles must not be deleted');

  // Delete custom profile
  const deleteCustomResult = agent1.deleteProfile(customProfile.id);
  assert.equal(deleteCustomResult, true, 'Custom profile must be deleted');

  // Reset builtin profiles
  agent1.resetProfilesToDefault();
  const resetProfiles = agent1.getAllProfiles();
  const juniorReset = resetProfiles.find((p) => p.id === 'junior_frontend');
  assert.equal(juniorReset?.name, 'Денис');

  console.log('  ✓ Custom profile lifecycle, duplication and protection verified');
  console.log('  PASSED: Test P5.\n');

  // ----------------------------------------------------
  // Test P6: Token Stats Breakdown & Notification on Switch
  // ----------------------------------------------------
  console.log('Test P6: Token calculation and listener notifications');
  let notifiedCount = 0;
  const unsubscribe = agent1.subscribe(() => {
    notifiedCount++;
  });

  const breakdownBefore = agent1.getState().memoryTokensBreakdown;
  assert.ok(breakdownBefore.longTermTokens > 0, 'Long-term tokens must account for user profile');

  // Switch profile
  agent1.setActiveProfile('senior_architect');
  const breakdownAfter = agent1.getState().memoryTokensBreakdown;

  assert.ok(breakdownAfter.longTermTokens > 0);
  assert.ok(notifiedCount > 0, 'Observer listener must be notified upon profile change');
  unsubscribe();

  console.log('  ✓ Token calculation and reactive observer notifications verified');
  console.log('  PASSED: Test P6.\n');

  console.log('🎉 ALL DAY 12 PERSONALIZATION TESTS PASSED SUCCESSFULLY!\n');
}

// Run if directly executed
runPersonalizationTests().catch((err) => {
  console.error('❌ Personalization tests failed:', err);
  process.exit(1);
});
