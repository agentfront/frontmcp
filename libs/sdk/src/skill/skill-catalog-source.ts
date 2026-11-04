// file: libs/sdk/src/skill/skill-catalog-source.ts

import type { Token } from '@frontmcp/di';

/**
 * How the skill catalog tells a model to load and find skills: the catalog's heading, the hint that ends a truncated
 * catalog, and the `'compact'` instructions line. By default they point to the `skill://index.json` resource, or to
 * the `skills/load` and `skills/search` requests when `skillsConfig.mcpResources` is false.
 */
export interface SkillCatalogPointers {
  /** The catalog's heading, such as "Available skills (load one by name with `load_skill`):". */
  header: string;
  /** Ends the footer of a truncated catalog, such as "use `search_skill` to find the rest". */
  truncationHint: string;
  /** Follows "This server has 2 skills: " in the `'compact'` instructions. */
  compact: string;
}

/**
 * Skills a plugin registers at runtime, such as Skilled OpenAPI's bundle skills, provided under
 * {@link SkillCatalogSourceToken}. The `initialize` instructions wait for `ready()`, so they count and list those
 * skills, and use `pointers` in place of the default ones.
 */
export interface SkillCatalogSource {
  /** Resolves once the plugin has registered its skills. A rejection is logged, and the instructions don't wait. */
  ready(): Promise<void>;
  /** How the catalog tells a model to load and find skills, when the plugin serves them through tools of its own. */
  pointers?: SkillCatalogPointers;
}

/** DI token for a plugin's {@link SkillCatalogSource}. Optional: without one, the instructions use the defaults. */
export const SkillCatalogSourceToken: Token<SkillCatalogSource> = Symbol.for(
  'frontmcp:SKILL_CATALOG_SOURCE',
) as Token<SkillCatalogSource>;
