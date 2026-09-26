// file: libs/sdk/src/skill/skill-filter.helper.ts

/**
 * Runs skills through the hookable `skills:filter` flow before a surface serves them.
 *
 * Every skill surface calls one of these helpers, so a plugin that hooks the flow (the
 * feature-flag plugin, for one) gates skills on all of them at once. A skill the flow drops is
 * treated as absent: left out of listings and not found when named.
 */

import type { ScopeEntry, SkillEntry } from '../common';
import { filterSkillsByAuthorities } from './skill-authorities.helper';
import { createSkillEntryResolver, skillResultId, type SkillEntryLookup } from './skill-entry.resolver';

type SkillFilterScope = Pick<ScopeEntry, 'runFlowForOutput'>;

type SkillDiscoveryScope = SkillFilterScope &
  Pick<ScopeEntry, 'authoritiesEngine' | 'authoritiesContextBuilder' | 'authoritiesScopeMapping'>;

/**
 * The skills, in their order, that the `skills:filter` flow lets the current caller see.
 *
 * `ctx` is the MCP handler context (`{ authInfo }`) of a surface that runs outside a flow, so the
 * filter judges that caller. Surfaces already inside a flow (resource reads, tool calls, HTTP) omit it.
 */
export async function filterServableSkills<T extends SkillEntry>(
  scope: SkillFilterScope,
  skills: readonly T[],
  ctx?: unknown,
): Promise<T[]> {
  if (skills.length === 0) return [];
  const { skills: servable } = await scope.runFlowForOutput('skills:filter', { skills: [...skills], ctx });
  const servableSkills = new Set<SkillEntry>(servable);
  return skills.filter((skill) => servableSkills.has(skill));
}

/** Whether the `skills:filter` flow lets the current caller see or load this skill. */
export async function isSkillServable(scope: SkillFilterScope, skill: SkillEntry, ctx?: unknown): Promise<boolean> {
  const servable = await filterServableSkills(scope, [skill], ctx);
  return servable.length === 1;
}

/** The caller a discovery surface filters for. */
export interface SkillDiscoveryCaller {
  /** Request AuthInfo the skill authorities are evaluated against. */
  authInfo?: Record<string, unknown>;
  /** The MCP handler context, for a surface that runs outside a flow (see {@link filterServableSkills}). */
  ctx?: unknown;
}

/**
 * Filter search or list results, whose projected metadata only carries an id and name, down to the
 * skills the caller may discover. Each result is resolved to its registered entry once, and the skill
 * authorities and then the `skills:filter` flow judge that same entry. Results without a registered
 * entry (external skills) are kept, as they carry no metadata a gate could judge.
 */
export async function filterDiscoverableSkillResults<T extends { metadata: { id?: string; name: string } }>(
  scope: SkillDiscoveryScope,
  registry: SkillEntryLookup,
  results: readonly T[],
  caller: SkillDiscoveryCaller = {},
): Promise<T[]> {
  const resolve = createSkillEntryResolver(registry);
  const entries = results.map((result) => resolve(skillResultId(result)));
  const registered = [...new Set(entries.filter((entry): entry is SkillEntry => entry !== undefined))];
  const authorized = await filterSkillsByAuthorities(scope, registered, caller.authInfo ?? {});
  const servable = new Set<SkillEntry>(await filterServableSkills(scope, authorized, caller.ctx));
  return results.filter((_, index) => {
    const entry = entries[index];
    return entry === undefined || servable.has(entry);
  });
}
