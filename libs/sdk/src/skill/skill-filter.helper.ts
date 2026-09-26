// file: libs/sdk/src/skill/skill-filter.helper.ts

/**
 * Runs skills through the hookable `skills:filter` flow before a surface serves them.
 *
 * Every skill surface calls one of these helpers, so a plugin that hooks the flow (the
 * feature-flag plugin, for one) gates skills on all of them at once. A skill the flow drops is
 * treated as absent: left out of listings and not found when named.
 */

import type { ScopeEntry, SkillEntry } from '../common';
import type { SkillRegistryInterface } from './skill.registry';

type SkillFilterScope = Pick<ScopeEntry, 'runFlowForOutput'>;

/** The skills, in their order, that the `skills:filter` flow lets the current caller see. */
export async function filterServableSkills<T extends SkillEntry>(
  scope: SkillFilterScope,
  skills: readonly T[],
): Promise<T[]> {
  if (skills.length === 0) return [];
  const { skills: servable } = await scope.runFlowForOutput('skills:filter', { skills: [...skills] });
  const servableSkills = new Set<SkillEntry>(servable);
  return skills.filter((skill) => servableSkills.has(skill));
}

/** Whether the `skills:filter` flow lets the current caller see or load this skill. */
export async function isSkillServable(scope: SkillFilterScope, skill: SkillEntry): Promise<boolean> {
  const servable = await filterServableSkills(scope, [skill]);
  return servable.length === 1;
}

/**
 * Filter search or list results, whose projected metadata only carries an id and name, through the
 * `skills:filter` flow by resolving each result's registered skill entry. Results without a
 * registered entry (external skills) are kept, as they carry no metadata a hook could gate on.
 */
export async function filterServableSkillResults<T extends { metadata: { id?: string; name: string } }>(
  scope: SkillFilterScope,
  registry: SkillRegistryInterface,
  results: readonly T[],
): Promise<T[]> {
  const entries = results.map((result) => findSkillEntry(registry, result.metadata.id ?? result.metadata.name));
  const registered = entries.filter((entry): entry is SkillEntry => entry !== undefined);
  const servable = new Set(await filterServableSkills(scope, registered));
  return results.filter((_, index) => {
    const entry = entries[index];
    return entry === undefined || servable.has(entry);
  });
}

function findSkillEntry(registry: SkillRegistryInterface, id: string): SkillEntry | undefined {
  return (
    registry.findByName(id) ??
    registry.getSkills(true).find((skill) => (skill.metadata.id ?? skill.name) === id || skill.metadata.name === id)
  );
}
