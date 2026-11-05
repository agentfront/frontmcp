import 'reflect-metadata';

import type { ResolvedBundle } from '@frontmcp/adapters/skills';
import type { ScopeEntry, SkillEntry } from '@frontmcp/sdk';

import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkillVisibility, visibleListingsAtStart, visibleListingsWhenCalled } from '../security/skill-visibility';

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

describe('the listings of an action the caller may run', () => {
  const listing = (skillId: string, operationId = 'getInvoice') =>
    ({ skillId, op: { operationId } }) as unknown as HiddenOpEntry;

  /** A scope whose registry holds `entries` as they are when read, and whose skills:filter flow drops `flagged-off`. */
  function filteringScope(entries: SkillEntry[]) {
    const runFlowForOutput = jest.fn(async (_flow: string, input: { skills: SkillEntry[] }) => ({
      skills: input.skills.filter((skill) => skill.name !== 'flagged-off'),
    }));
    return { scope: scopeWith(entries, { runFlowForOutput }), runFlowForOutput };
  }

  it('keeps, when a call is made, the listings whose registered skill the skills:filter flow shows', async () => {
    const entries = [entry('flagged-off'), entry('invoices')];
    const { scope, runFlowForOutput } = filteringScope(entries);
    const visibleListings = visibleListingsWhenCalled(scope);
    const listings = [listing('flagged-off'), listing('invoices'), listing('unregistered')];

    expect(await visibleListings(listings)).toEqual([listings[1]]);
    entries.splice(1, 1);
    expect(await visibleListings(listings)).toEqual([]);
    expect(runFlowForOutput).toHaveBeenCalledTimes(2);
  });

  it("judges every listing of a workflow's operations once, as it starts, whatever a later swap removes", async () => {
    const entries = [entry('flagged-off'), entry('invoices'), entry('reports')];
    const { scope, runFlowForOutput } = filteringScope(entries);
    const hiddenOps = new HiddenOpRegistry();
    const invoices = listing('invoices');
    const reports = listing('reports', 'getRevenueReport');
    for (const operationListing of [listing('flagged-off'), invoices, reports]) hiddenOps.set(operationListing);

    const visibleListings = await visibleListingsAtStart(scope, hiddenOps.snapshot());
    entries.length = 0;

    expect(await visibleListings([listing('flagged-off'), invoices])).toEqual([invoices]);
    expect(await visibleListings([reports])).toEqual([reports]);
    expect(runFlowForOutput).toHaveBeenCalledTimes(1);
    expect(runFlowForOutput.mock.calls[0][1].skills.map((skill) => skill.name)).toEqual([
      'flagged-off',
      'invoices',
      'reports',
    ]);
  });
});
