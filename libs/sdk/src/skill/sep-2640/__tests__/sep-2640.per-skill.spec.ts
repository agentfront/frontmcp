/**
 * Tests for the per-skill concrete Resource registration helper.
 *
 * SEP-2640 §Resource Metadata says each `skill://<skill-path>/SKILL.md`
 * resource SHOULD carry frontmatter-derived `name`/`description` plus
 * `audience`/`priority` annotations. The per-skill registration emits
 * those — verified here.
 */

import 'reflect-metadata';

import type { FrontMcpLogger, ResourceFunctionRecord, ScopeEntry, SkillEntry } from '../../../common';
import { ResourceKind } from '../../../common/records/resource.record';
import type ResourceRegistry from '../../../resource/resource.registry';
import { SEP_2640_META_NAMESPACE, SKILL_MD_MIME_TYPE, SKILL_MD_PRIORITY } from '../sep-2640.constants';
import { buildPerSkillResourceRecord, registerPerSkillResources } from '../sep-2640.per-skill';

function makeSkill(overrides: Partial<SkillEntry> & { name: string; description: string }): SkillEntry {
  return {
    name: overrides.name,
    metadata: {
      name: overrides.name,
      description: overrides.description,
      ...(overrides as { metadata?: object }).metadata,
    },
    getSkillPathSegments: () => [overrides.name],
    getSkillPath: () => overrides.name,
    ...overrides,
  } as unknown as SkillEntry;
}

const fakeScope = {} as ScopeEntry;

describe('buildPerSkillResourceRecord', () => {
  it('emits a FUNCTION record with frontmatter-derived name and description', () => {
    const skill = makeSkill({ name: 'review-pr', description: 'Review a GitHub PR' });
    const rec = buildPerSkillResourceRecord(fakeScope, skill);

    expect(rec.kind).toBe(ResourceKind.FUNCTION);
    expect(rec.metadata.uri).toBe('skill://review-pr/SKILL.md');
    expect(rec.metadata.name).toBe('review-pr');
    expect(rec.metadata.description).toBe('Review a GitHub PR');
    expect(rec.metadata.mimeType).toBe(SKILL_MD_MIME_TYPE);
  });

  it('attaches audience: ["assistant"] and priority 0.8 annotations', () => {
    const skill = makeSkill({ name: 'a', description: 'A' });
    const rec = buildPerSkillResourceRecord(fakeScope, skill);

    expect(rec.metadata.annotations).toEqual({
      audience: ['assistant'],
      priority: SKILL_MD_PRIORITY,
    });
  });

  it('includes lastModified when supplied', () => {
    const skill = makeSkill({ name: 'a', description: 'A' });
    const rec = buildPerSkillResourceRecord(fakeScope, skill, {
      lastModified: '2026-05-05T12:00:00Z',
    });
    expect(rec.metadata.annotations?.lastModified).toBe('2026-05-05T12:00:00Z');
  });

  it('emits the SEP-2640 _meta namespace key for skill path', () => {
    const skill = makeSkill({ name: 'refunds', description: 'Process refunds' });
    Object.defineProperty(skill, 'getSkillPathSegments', {
      value: () => ['acme', 'billing', 'refunds'],
    });
    Object.defineProperty(skill, 'getSkillPath', { value: () => 'acme/billing/refunds' });

    const rec = buildPerSkillResourceRecord(fakeScope, skill);
    expect(rec.metadata.uri).toBe('skill://acme/billing/refunds/SKILL.md');
    expect(rec.metadata._meta?.[`${SEP_2640_META_NAMESPACE}path`]).toBe('acme/billing/refunds');
  });

  it('propagates the skill authorities onto the resource metadata so the resource flow enforces it', () => {
    const skill = makeSkill({
      name: 'admin-skill',
      description: 'Admin-only',
      metadata: { authorities: { roles: { any: ['admin'] } } },
    } as never);
    const rec = buildPerSkillResourceRecord(fakeScope, skill);
    expect((rec.metadata as unknown as Record<string, unknown>)['authorities']).toEqual({
      roles: { any: ['admin'] },
    });
  });

  it('carries metadata a plugin adds to the skill, so the plugin gates the resource like the skill', () => {
    const skill = makeSkill({
      name: 'beta-skill',
      description: 'Behind a flag',
      metadata: { name: 'beta-skill', description: 'Behind a flag', featureFlag: 'beta-skills' },
    } as never);
    const rec = buildPerSkillResourceRecord(fakeScope, skill);

    expect((rec.metadata as unknown as Record<string, unknown>)['featureFlag']).toBe('beta-skills');
  });

  it('copies neither core skill fields nor keys the resource sets itself', () => {
    const skill = makeSkill({
      name: 'core-skill',
      description: 'Core fields only',
      metadata: {
        name: 'core-skill',
        description: 'Core fields only',
        instructions: 'Secret steps',
        tags: ['internal'],
        visibility: 'mcp',
        mimeType: 'text/plain',
        title: 'Overridden',
      },
    } as never);
    const rec = buildPerSkillResourceRecord(fakeScope, skill);
    const metadata = rec.metadata as unknown as Record<string, unknown>;

    expect(metadata['instructions']).toBeUndefined();
    expect(metadata['tags']).toBeUndefined();
    expect(metadata['visibility']).toBeUndefined();
    expect(metadata['title']).toBeUndefined();
    expect(metadata['mimeType']).toBe(SKILL_MD_MIME_TYPE);
  });

  it('does not add an authorities key for a skill without authorities (default preserved)', () => {
    const skill = makeSkill({ name: 'public-skill', description: 'Open' });
    const rec = buildPerSkillResourceRecord(fakeScope, skill);
    expect('authorities' in (rec.metadata as object)).toBe(false);
  });
});

describe('registerPerSkillResources when a skill is replaced at the same path (#606)', () => {
  function setup(initial: SkillEntry) {
    let served: SkillEntry[] = [initial];
    const listeners: Array<() => void> = [];
    const records: ResourceFunctionRecord[] = [];
    const scope = {
      skills: {
        hasAny: () => true,
        getSkills: () => served,
        subscribe: (_options: unknown, listener: () => void) => {
          listeners.push(listener);
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
      },
    } as unknown as ScopeEntry;
    const resourceRegistry = {
      registerDynamicResource: (record: ResourceFunctionRecord) => records.push(record),
    } as unknown as ResourceRegistry;
    const logger = { verbose: jest.fn(), warn: jest.fn() } as unknown as FrontMcpLogger;

    return {
      register: () => registerPerSkillResources({ scope, resourceRegistry, skills: served, logger }),
      metadata: () => (records[0]?.metadata ?? {}) as unknown as Record<string, unknown>,
      replaceWith: (skill?: SkillEntry) => {
        served = skill ? [skill] : [];
        for (const listener of [...listeners]) listener();
      },
    };
  }

  const plain = makeSkill({ name: 'report', description: 'Open report' });
  const gated = makeSkill({
    name: 'report',
    description: 'Gated report',
    metadata: { name: 'report', description: 'Gated report', featureFlag: 'reports', authorities: 'admin' },
  } as never);

  it('takes the policy metadata of a replacement that adds it', async () => {
    const harness = setup(plain);
    await harness.register();

    harness.replaceWith(gated);

    expect(harness.metadata()).toMatchObject({ featureFlag: 'reports', authorities: 'admin' });
    expect(harness.metadata()['description']).toBe('Gated report');
  });

  it('drops the policy metadata of a skill a replacement no longer carries', async () => {
    const harness = setup(gated);
    await harness.register();

    harness.replaceWith(plain);

    expect('featureFlag' in harness.metadata()).toBe(false);
    expect('authorities' in harness.metadata()).toBe(false);
    expect(harness.metadata()).toMatchObject({ uri: 'skill://report/SKILL.md', description: 'Open report' });
  });

  it('keeps the last policy metadata while no skill serves the path', async () => {
    const harness = setup(gated);
    await harness.register();

    harness.replaceWith(undefined);

    expect(harness.metadata()).toMatchObject({ featureFlag: 'reports', authorities: 'admin' });
  });
});
