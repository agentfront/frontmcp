import 'reflect-metadata';

import type { ResolvedBundle } from '@frontmcp/adapters/skills';
import type { ScopeEntry, SkillEntry } from '@frontmcp/sdk';

import { AuthorityGuard } from '../security/authority-guard';
import { SkillVisibility } from '../security/skill-visibility';

const bundle = {
  skills: [
    { id: 'admin', requiredAuthorities: { roles: { any: ['admin'] } } },
    { id: 'open', requiredAuthorities: null },
  ],
} as unknown as ResolvedBundle;

const entry = (id: string, authorities?: unknown): SkillEntry =>
  ({ name: id, metadata: { id, name: id, ...(authorities ? { authorities } : {}) } }) as unknown as SkillEntry;

function scopeWith(entries: SkillEntry[], extra: Record<string, unknown> = {}): ScopeEntry {
  return {
    skills: {
      findByName: (name: string) => entries.find((e) => e.name === name),
      findByQualifiedName: () => undefined,
      getSkills: () => entries,
    },
    runFlowForOutput: async (_flow: string, input: { skills: SkillEntry[] }) => ({ skills: input.skills }),
    ...extra,
  } as unknown as ScopeEntry;
}

const viewer = { user: { sub: 'u', roles: ['viewer'] } };

describe('SkillVisibility', () => {
  it('judges an id with no registered skill (an external skill) by the bundle rule alone', async () => {
    const visibility = new SkillVisibility({
      scope: scopeWith([]),
      guard: new AuthorityGuard(),
      bundle,
      unprotectedOps: 'allow',
      authInfo: viewer,
    });

    expect(await visibility.filterVisible(['admin', 'open', 'external'], (id) => id)).toEqual(['open', 'external']);
  });

  it('hides a registered skill the skills:filter flow drops', async () => {
    const hidden = entry('flagged-off');
    const visibility = new SkillVisibility({
      scope: scopeWith([hidden], {
        runFlowForOutput: async (_flow: string, input: { skills: SkillEntry[] }) => ({
          skills: input.skills.filter((s) => s !== hidden),
        }),
      }),
      guard: new AuthorityGuard(),
      bundle: undefined,
      unprotectedOps: 'allow',
      authInfo: viewer,
    });

    expect(await visibility.isVisible('flagged-off')).toBe(false);
  });

  it("hides an @Skill whose authorities evaluation throws, and applies them only with the server's engine", async () => {
    const gated = entry('gated', { roles: { any: ['admin'] } });
    const throwing = {
      authoritiesEngine: {
        evaluate: async () => {
          throw new Error('boom');
        },
      },
      authoritiesContextBuilder: { build: () => ({}) },
    };

    const withEngine = new SkillVisibility({
      scope: scopeWith([gated], throwing),
      guard: new AuthorityGuard(),
      bundle: undefined,
      unprotectedOps: 'allow',
      authInfo: undefined,
    });
    const withoutEngine = new SkillVisibility({
      scope: scopeWith([gated]),
      guard: new AuthorityGuard(),
      bundle: undefined,
      unprotectedOps: 'allow',
      authInfo: viewer,
    });

    expect(await withEngine.isVisible('gated')).toBe(false);
    expect(await withoutEngine.isVisible('gated')).toBe(true);
  });

  it('has nothing to resolve without a skill registry', async () => {
    const visibility = new SkillVisibility({
      scope: { runFlowForOutput: jest.fn() } as unknown as ScopeEntry,
      guard: new AuthorityGuard(),
      bundle,
      unprotectedOps: 'allow',
      authInfo: viewer,
    });

    expect(await visibility.filterVisible([], (id: string) => id)).toEqual([]);
    expect(await visibility.isVisible('open')).toBe(true);
    expect(await visibility.isVisible('admin')).toBe(false);
  });
});
