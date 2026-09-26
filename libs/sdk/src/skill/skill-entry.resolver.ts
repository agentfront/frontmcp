// file: libs/sdk/src/skill/skill-entry.resolver.ts

/**
 * Maps a skill id to its registered entry, the same way on every skill surface.
 *
 * Search and list results, `skills/load` and `GET /skills/{id}` requests, and loaded skill content
 * all name a skill by an id. Every surface resolves it here, so the skill authorities and the
 * `skills:filter` flow judge the same entry for the same id. Each id is tried as a registry name,
 * then a qualified name, then a skill id or display name.
 */

import type { SkillEntry } from '../common';
import type { SkillRegistryInterface } from './skill.registry';

/** The registry lookups the resolver needs. */
export type SkillEntryLookup = Pick<SkillRegistryInterface, 'findByName' | 'findByQualifiedName' | 'getSkills'>;

/** Returns the entry the first of `ids` that names a registered skill resolves to. */
export type SkillEntryResolver = (...ids: Array<string | undefined>) => SkillEntry | undefined;

/** The id a search or list result names its skill by. */
export function skillResultId(result: { metadata: { id?: string; name: string } }): string {
  return result.metadata.id ?? result.metadata.name;
}

/**
 * Create a resolver for one request. The fallback index over every registered skill is built on the
 * first id the registry lookups miss, and reused for every later one.
 */
export function createSkillEntryResolver(registry: SkillEntryLookup): SkillEntryResolver {
  let fallback: Map<string, SkillEntry> | undefined;

  const fallbackEntry = (id: string): SkillEntry | undefined => {
    if (!fallback) {
      const skills = registry.getSkills(true);
      fallback = new Map();
      for (const skill of skills) {
        const skillId = skill.metadata.id ?? skill.name;
        if (!fallback.has(skillId)) fallback.set(skillId, skill);
      }
      for (const skill of skills) {
        if (!fallback.has(skill.metadata.name)) fallback.set(skill.metadata.name, skill);
      }
    }
    return fallback.get(id);
  };

  const lookup = (id: string): SkillEntry | undefined =>
    registry.findByName(id) ??
    // Qualified names always carry an owner prefix, so plain ids skip that scan.
    (id.includes(':') ? registry.findByQualifiedName(id) : undefined) ??
    fallbackEntry(id);

  return (...ids) => {
    for (const id of ids) {
      if (!id) continue;
      const entry = lookup(id);
      if (entry) return entry;
    }
    return undefined;
  };
}
