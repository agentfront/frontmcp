/**
 * `findSkillByPath` resolves a `skill://<skill-path>/SKILL.md` path: the exact path first, then the
 * name, and then, for a single segment, the id of a skill addressed by its name. `skills/list` and
 * the Skilled OpenAPI meta-tools report skills by id, and a bundle skill's id (`invoices`) is not
 * its name (`Invoices`).
 */
import type { ScopeEntry, SkillEntry } from '../../../common';
import { findSkillByPath } from '../sep-2640.resource-helpers';

function skill(metadata: { id?: string; name: string; skillPath?: string[] }): SkillEntry {
  const segments = metadata.skillPath?.length ? metadata.skillPath : [metadata.name];
  return {
    // As SkillInstance does: an entry's name is its id when it has one.
    name: metadata.id ?? metadata.name,
    metadata,
    getSkillPath: () => segments.join('/'),
  } as unknown as SkillEntry;
}

function scopeWith(skills: SkillEntry[]): ScopeEntry {
  return { skills: { hasAny: () => skills.length > 0, getSkills: () => skills } } as unknown as ScopeEntry;
}

describe('findSkillByPath', () => {
  const invoices = skill({ id: 'invoices', name: 'Invoices' });
  const refunds = skill({ id: 'refunds', name: 'refunds', skillPath: ['acme', 'billing', 'refunds'] });
  const plain = skill({ name: 'git-workflow' });
  const scope = scopeWith([invoices, refunds, plain]);

  it('finds a skill by the path skill://index.json lists', () => {
    expect(findSkillByPath(scope, 'Invoices')).toBe(invoices);
    expect(findSkillByPath(scope, 'acme/billing/refunds')).toBe(refunds);
    expect(findSkillByPath(scope, 'git-workflow')).toBe(plain);
  });

  it('finds a skill addressed by its name at the same URI with its id', () => {
    expect(findSkillByPath(scope, 'invoices')).toBe(invoices);
  });

  it('does not take an id for a skill with an explicit skillPath, or in a multi-segment path', () => {
    const other = skill({ id: 'ledger', name: 'refunds-ledger', skillPath: ['acme', 'ledger'] });
    const scoped = scopeWith([other, invoices]);

    expect(findSkillByPath(scoped, 'ledger')).toBeUndefined();
    expect(findSkillByPath(scoped, 'acme/invoices')).toBeUndefined();
  });

  it('prefers a skill whose path is the segment over one whose id is', () => {
    const named = skill({ name: 'reports' });
    const aliased = skill({ id: 'reports', name: 'Reports' });

    expect(findSkillByPath(scopeWith([aliased, named]), 'reports')).toBe(named);
  });

  it('finds nothing for an unknown path', () => {
    expect(findSkillByPath(scope, 'nothing-here')).toBeUndefined();
  });
});
