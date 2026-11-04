// file: libs/sdk/src/skill/skill-catalog-source.ts

import type { Token } from '@frontmcp/di';

import type { ScopeEntry, SkillAction, SkillContent } from '../common';
import { DependencyNotFoundError, ProviderNotAvailableError, ProviderNotRegisteredError } from '../errors';

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

/** How a skill's `SKILL.md` resource lists the actions of the plugin's skills. */
export interface SkillCatalogActions {
  /** Opens the "Actions" section: how to run an action, such as "Run an action with `run_workflow`". */
  hint: string;
  /** The actions of `skill` the caller may run, judged by the plugin's rules. */
  visibleTo(skill: SkillContent, authInfo: unknown): Promise<SkillAction[]>;
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
  /** Lists a skill's actions in its `SKILL.md` resource. Without it, `SKILL.md` lists none. */
  actions?: SkillCatalogActions;
}

/** DI token for a plugin's {@link SkillCatalogSource}. Optional: without one, the instructions use the defaults. */
export const SkillCatalogSourceToken: Token<SkillCatalogSource> = Symbol.for(
  'frontmcp:SKILL_CATALOG_SOURCE',
) as Token<SkillCatalogSource>;

type SkillCatalogSourceScope = Pick<ScopeEntry, 'logger'> & { readonly providers?: ScopeEntry['providers'] };

/**
 * The plugin skill source provided in the scope, if any. Not registered is the usual case and means none; a provider
 * that fails to build is logged and treated as none, so the request it serves still answers.
 */
export function findSkillCatalogSource(scope: SkillCatalogSourceScope): SkillCatalogSource | undefined {
  if (!scope.providers) return undefined;
  try {
    return scope.providers.get(SkillCatalogSourceToken);
  } catch (error) {
    if (
      error instanceof ProviderNotRegisteredError ||
      error instanceof ProviderNotAvailableError ||
      error instanceof DependencyNotFoundError
    ) {
      return undefined;
    }
    scope.logger.warn('the skill source provider failed; serving skills without it', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
