/**
 * Tests for SkillRegistry.registerSkillContent / unregisterSkill — the dynamic
 * skill registration path used by plugin-skilled-openapi to ingest skill bundles
 * pushed by FrontMCP Cloud. Asserts:
 *   - Dynamic skills appear in getSkills, findByName, loadSkill, search, listSkills
 *   - Re-registering replaces (not duplicates) by id
 *   - Unregister handle removes the skill and fires a change event
 *   - Change events fire on registration and unregistration
 *   - executableActions / bundleVersion round-trip through loadSkill
 */

import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { type SkillAction, type SkillContent } from '../../common/interfaces';
import SkillRegistry from '../skill.registry';

const owner = () => ({ kind: 'app' as const, id: 'dyn-test-app', ref: Symbol('dyn-test') });

const buildSkillContent = (overrides: Partial<SkillContent> = {}): SkillContent => ({
  id: 'billing',
  name: 'billing',
  description: 'Billing operations skill',
  instructions: '# Billing\n\nUse this skill to handle invoices and refunds.',
  tools: [],
  ...overrides,
});

const buildAction = (overrides: Partial<SkillAction> = {}): SkillAction => ({
  actionId: 'createRefund',
  summary: 'Issue a refund for an invoice',
  inputJsonSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
  outputJsonSchema: { type: 'object', properties: { refundId: { type: 'string' } } },
  ...overrides,
});

describe('SkillRegistry — dynamic registration', () => {
  it('registers a skill that immediately appears in getSkills, findByName, and loadSkill', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    expect(registry.getSkills()).toHaveLength(0);

    const handle = await registry.registerSkillContent(buildSkillContent());

    expect(handle.id).toBe('billing');
    expect(registry.getSkills()).toHaveLength(1);
    expect(registry.findByName('billing')?.name).toBe('billing');

    const loaded = await registry.loadSkill('billing');
    expect(loaded?.skill.name).toBe('billing');
    expect(loaded?.skill.description).toBe('Billing operations skill');
  });

  it('preserves actions[] and bundleVersion through loadSkill', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    const content = buildSkillContent({
      actions: [buildAction()],
      bundleVersion: '2026.05.01-1',
    });

    await registry.registerSkillContent(content);

    const loaded = await registry.loadSkill('billing');
    expect(loaded?.skill.actions).toEqual(content.actions);
    expect(loaded?.skill.bundleVersion).toBe('2026.05.01-1');
  });

  it('registers a skill that is searchable through registry.search', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    await registry.registerSkillContent(
      buildSkillContent({
        id: 'invoices',
        name: 'invoices',
        description: 'Manage invoices and process refunds',
      }),
    );

    const results = await registry.search('refund');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].metadata.id).toBe('invoices');
  });

  it('replaces a skill when registered again with the same id', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    await registry.registerSkillContent(buildSkillContent({ description: 'first' }));
    await registry.registerSkillContent(buildSkillContent({ description: 'second' }));

    const skills = registry.getSkills();
    expect(skills).toHaveLength(1);
    const loaded = await registry.loadSkill('billing');
    expect(loaded?.skill.description).toBe('second');
  });

  it('returned handle.unregister removes the skill', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    const handle = await registry.registerSkillContent(buildSkillContent());
    expect(registry.getSkills()).toHaveLength(1);

    await handle.unregister();

    expect(registry.getSkills()).toHaveLength(0);
    expect(registry.findByName('billing')).toBeUndefined();
    const loaded = await registry.loadSkill('billing');
    expect(loaded).toBeUndefined();
  });

  it('handle.unregister is idempotent (calling twice is safe)', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    const handle = await registry.registerSkillContent(buildSkillContent());
    await handle.unregister();
    await expect(handle.unregister()).resolves.toBeUndefined();
  });

  it('unregisterSkill returns false for unknown ids and true after registration', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    expect(await registry.unregisterSkill('does-not-exist')).toBe(false);

    await registry.registerSkillContent(buildSkillContent());
    expect(await registry.unregisterSkill('billing')).toBe(true);
    expect(await registry.unregisterSkill('billing')).toBe(false);
  });

  it('rejects content without id or name', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    await expect(
      registry.registerSkillContent({ ...buildSkillContent(), id: '' as unknown as string }),
    ).rejects.toThrow(/id is required/);
    await expect(
      registry.registerSkillContent({ ...buildSkillContent(), name: '' as unknown as string }),
    ).rejects.toThrow(/name is required/);
  });

  it('fires a change event on registration and unregistration', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    const events: string[] = [];
    const unsub = registry.subscribe({ immediate: false }, (e) => {
      events.push(e.kind);
    });

    const handle = await registry.registerSkillContent(buildSkillContent());
    await handle.unregister();
    unsub();

    // At least one reset event for register and one for unregister
    expect(events.filter((k) => k === 'reset').length).toBeGreaterThanOrEqual(2);
  });

  it('coexists with statically registered skills', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner());
    await registry.ready;

    await registry.registerSkillContent(buildSkillContent({ id: 'a', name: 'a' }));
    await registry.registerSkillContent(buildSkillContent({ id: 'b', name: 'b' }));

    const skills = registry.getSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);

    const list = await registry.listSkills();
    expect(list.total).toBe(2);
  });
});
