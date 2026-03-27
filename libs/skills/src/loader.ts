/**
 * Skills catalog loader and filtering helpers.
 *
 * Provides functions to query the catalog manifest by target, category, and bundle.
 *
 * @module skills/loader
 */

import * as path from 'node:path';
import type { SkillCatalogEntry, SkillManifest } from './manifest';

/**
 * Load the skills manifest from the catalog directory.
 *
 * @param catalogDir - Absolute path to the catalog directory. Defaults to the bundled catalog.
 * @returns The parsed skills manifest
 */
export function loadManifest(catalogDir?: string): SkillManifest {
  const dir = catalogDir ?? path.resolve(__dirname, '..', 'catalog');
  const manifestPath = path.join(dir, 'skills-manifest.json');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(manifestPath) as SkillManifest;
}

/**
 * Filter skills by deployment target.
 * Returns skills that include the given target or 'all'.
 */
export function getSkillsByTarget(skills: SkillCatalogEntry[], target: string): SkillCatalogEntry[] {
  return skills.filter(
    (s) => s.targets.includes('all') || s.targets.includes(target as SkillCatalogEntry['targets'][number]),
  );
}

/**
 * Filter skills by category.
 */
export function getSkillsByCategory(skills: SkillCatalogEntry[], category: string): SkillCatalogEntry[] {
  return skills.filter((s) => s.category === category);
}

/**
 * Filter skills by bundle membership.
 */
export function getSkillsByBundle(skills: SkillCatalogEntry[], bundle: string): SkillCatalogEntry[] {
  return skills.filter((s) =>
    s.bundle?.includes(bundle as SkillCatalogEntry['bundle'] extends (infer U)[] | undefined ? U : never),
  );
}

/**
 * Get only instruction-only skills (no scripts/, references/, or assets/ directories).
 * These are safe to use with `instructions: { file: ... }` wrappers.
 */
export function getInstructionOnlySkills(skills: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return skills.filter((s) => !s.hasResources);
}

/**
 * Get only resource-carrying skills (have scripts/, references/, or assets/).
 * These need full directory loading via `skillDir()`.
 */
export function getResourceSkills(skills: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return skills.filter((s) => s.hasResources);
}

/**
 * Resolve the absolute path to a skill directory.
 *
 * @param entry - The catalog entry
 * @param catalogDir - Absolute path to the catalog directory
 * @returns Absolute path to the skill directory
 */
export function resolveSkillPath(entry: SkillCatalogEntry, catalogDir?: string): string {
  const dir = catalogDir ?? path.resolve(__dirname, '..', 'catalog');
  return path.resolve(dir, entry.path);
}
