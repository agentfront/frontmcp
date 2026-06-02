/**
 * Tests for the per-skill concrete Resource registration helper.
 *
 * SEP-2640 §Resource Metadata says each `skill://<skill-path>/SKILL.md`
 * resource SHOULD carry frontmatter-derived `name`/`description` plus
 * `audience`/`priority` annotations. The per-skill registration emits
 * those — verified here.
 */

import 'reflect-metadata';

import type { ScopeEntry, SkillEntry } from '../../../common';
import { ResourceKind } from '../../../common/records/resource.record';
import { SEP_2640_META_NAMESPACE, SKILL_MD_MIME_TYPE, SKILL_MD_PRIORITY } from '../sep-2640.constants';
import { buildPerSkillResourceRecord } from '../sep-2640.per-skill';

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

  it('does not add an authorities key for a skill without authorities (default preserved)', () => {
    const skill = makeSkill({ name: 'public-skill', description: 'Open' });
    const rec = buildPerSkillResourceRecord(fakeScope, skill);
    expect('authorities' in (rec.metadata as object)).toBe(false);
  });
});
