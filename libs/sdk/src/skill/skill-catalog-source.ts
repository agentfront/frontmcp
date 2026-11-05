// file: libs/sdk/src/skill/skill-catalog-source.ts

import type { Token } from '@frontmcp/di';

import type { ScopeEntry, SkillAction, SkillContent } from '../common';
import { DependencyNotFoundError, ProviderNotAvailableError, ProviderNotRegisteredError } from '../errors';
import { SkillBundleNotLoadedError } from './errors/skill-bundle-not-loaded.error';

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
 * {@link SkillCatalogSourceToken}. The `initialize` instructions and the SDK's skill surfaces wait for `ready()`, so
 * they count and list those skills, and the instructions use `pointers` in place of the default ones.
 */
export interface SkillCatalogSource {
  /** Resolves once the plugin has registered its skills. A rejection is logged, and the instructions don't wait. */
  ready(): Promise<void>;
  /**
   * Why the plugin's skills aren't loaded once `ready()` has settled, such as a first bundle pull that failed;
   * undefined once they are. While it gives a reason, `initialize` says the skills haven't loaded, and `skills/list`,
   * `skills/search` and `skill://index.json` answer the retryable {@link SkillBundleNotLoadedError} rather than as if
   * the server had no skills; `skills/load` and `skill://<path>/SKILL.md` answer it for a skill not found.
   */
  notLoadedReason?(): string | undefined;
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

/** The plugin skill source once it is ready, and why its skills aren't loaded when they aren't. */
export interface ReadySkillCatalog {
  source?: SkillCatalogSource;
  notLoadedReason?: string;
}

/**
 * Wait for the plugin skill source provided in the scope, if any, and read whether its skills loaded. A `ready()`
 * that rejects is logged: the skills registered so far are served.
 */
export async function readySkillCatalog(scope: SkillCatalogSourceScope): Promise<ReadySkillCatalog> {
  const source = findSkillCatalogSource(scope);
  if (!source) return {};
  try {
    await source.ready();
  } catch (error) {
    scope.logger.warn('a skill source failed to load; serving the skills registered so far', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { source, notLoadedReason: source.notLoadedReason?.() };
}

/**
 * Wait for the plugin skill source, and refuse with a retryable {@link SkillBundleNotLoadedError} while its skills
 * aren't loaded. A scope without a skill source passes.
 */
export async function assertSkillCatalogLoaded(scope: SkillCatalogSourceScope): Promise<void> {
  const { notLoadedReason } = await readySkillCatalog(scope);
  if (notLoadedReason !== undefined) throw new SkillBundleNotLoadedError(notLoadedReason);
}
