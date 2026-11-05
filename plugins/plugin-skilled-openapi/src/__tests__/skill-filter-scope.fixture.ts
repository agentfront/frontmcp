// A scope for unit tests: a skill registered under every id asked for, and a `skills:filter` flow that hides some of them.
import type { SkillEntry } from '@frontmcp/sdk';

import { visibleListingsWhenCalled, type SkillFilterScope, type VisibleListings } from '../security/skill-visibility';

export interface SkillFilterScopeFixture {
  scope: SkillFilterScope;
  /** The listings each call's skills:filter run keeps, as execute_action and the operation tools judge them. */
  visibleListings: VisibleListings;
  /** Every run of the scope's `skills:filter` flow, with the skills it was given. */
  filterRuns: jest.Mock<Promise<{ skills: SkillEntry[] }>, [string, { skills: SkillEntry[] }]>;
}

/** A scope with a registered skill for every id, whose `skills:filter` flow hides the skills `hiddenSkillIds` names. */
export function scopeHidingSkills(...hiddenSkillIds: string[]): SkillFilterScopeFixture {
  const registered = new Map<string, SkillEntry>();
  const skillWithId = (id: string): SkillEntry => {
    const known = registered.get(id);
    if (known) return known;
    const skill = { name: id, metadata: { id, name: id } } as unknown as SkillEntry;
    registered.set(id, skill);
    return skill;
  };
  const filterRuns: SkillFilterScopeFixture['filterRuns'] = jest.fn(async (_flow, input) => ({
    skills: input.skills.filter((skill) => !hiddenSkillIds.includes(skill.name)),
  }));
  const scope = {
    skills: {
      findByName: skillWithId,
      findByQualifiedName: () => undefined,
      getSkills: () => [...registered.values()],
    },
    runFlowForOutput: filterRuns,
  } as unknown as SkillFilterScope;
  return { scope, visibleListings: visibleListingsWhenCalled(scope), filterRuns };
}
