/**
 * SEP-2640 SkillRegistry conformance tests.
 *
 * Verifies that the registry declares the SEP-2640 extension capability
 * when skills are present, and that the index hooks (templates / archives /
 * instruction URIs) round-trip cleanly.
 */

import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../../__test-utils__/fixtures/scope.fixtures';
import { skill } from '../../../common/decorators/skill.decorator';
import SkillRegistry from '../../skill.registry';
import { SEP_2640_EXTENSION_ID } from '../sep-2640.constants';

describe('SkillRegistry — SEP-2640 conformance', () => {
  const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

  it('declares no extensions when empty', async () => {
    const providers = await createProviderRegistryWithScope();
    const registry = new SkillRegistry(providers, [], owner);
    await registry.ready;

    const caps = registry.getCapabilities();
    expect(caps).toEqual({});
  });

  it('declares SEP-2640 extension under both `experimental` and `extensions` when skills exist', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({
      name: 'demo',
      description: 'Demo',
      instructions: 'Do a thing',
    });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    const caps = registry.getCapabilities() as Record<string, Record<string, unknown>>;
    expect(caps['experimental']).toEqual({ [SEP_2640_EXTENSION_ID]: {} });
    expect(caps['extensions']).toEqual({ [SEP_2640_EXTENSION_ID]: {} });
  });

  it('returns empty index template / archive arrays by default', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({ name: 'a', description: 'A', instructions: 'x' });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    expect(registry.getSep2640IndexTemplates()).toEqual([]);
    expect(registry.getSep2640IndexArchives()).toEqual([]);
    expect(registry.getSep2640InstructionUris()).toEqual([]);
  });

  it('records template entries via addSep2640IndexTemplate', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({ name: 'a', description: 'A', instructions: 'x' });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    registry.addSep2640IndexTemplate({
      type: 'mcp-resource-template',
      description: 'Per-product docs',
      url: 'skill://docs/{product}/SKILL.md',
    });

    const templates = registry.getSep2640IndexTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].type).toBe('mcp-resource-template');
  });

  it('rejects template entries with the wrong type', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({ name: 'a', description: 'A', instructions: 'x' });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    expect(() =>
      registry.addSep2640IndexTemplate({
        type: 'skill-md',
        name: 'bogus',
        description: 'wrong type',
        url: 'skill://bogus/SKILL.md',
      }),
    ).toThrow(/must be "mcp-resource-template"/);
  });

  it('records archive entries via addSep2640IndexArchive', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({ name: 'a', description: 'A', instructions: 'x' });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    registry.addSep2640IndexArchive({
      type: 'archive',
      name: 'bundled',
      description: 'Packed bundle',
      url: 'skill://bundled.zip',
    });

    const archives = registry.getSep2640IndexArchives();
    expect(archives).toHaveLength(1);
    expect(archives[0].url).toBe('skill://bundled.zip');
  });

  it('records instruction URIs without duplicates', async () => {
    const providers = await createProviderRegistryWithScope();
    const aSkill = skill({ name: 'a', description: 'A', instructions: 'x' });
    const registry = new SkillRegistry(providers, [aSkill], owner);
    await registry.ready;

    registry.addSep2640InstructionUri('skill://a/SKILL.md');
    registry.addSep2640InstructionUri('skill://a/SKILL.md'); // duplicate ignored
    registry.addSep2640InstructionUri('skill://b/SKILL.md');

    expect(registry.getSep2640InstructionUris()).toEqual(['skill://a/SKILL.md', 'skill://b/SKILL.md']);
  });
});
