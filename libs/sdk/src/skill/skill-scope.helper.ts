// file: libs/sdk/src/skill/skill-scope.helper.ts

/**
 * Helper for registering skill capabilities in scope.
 *
 * This module extracts skill-specific registration logic from
 * `scope.instance.ts` to maintain separation of concerns.
 *
 * Skill resources are registered exclusively under the SEP-2640
 * `skill://` URI scheme. The legacy plural `skills://` scheme has been
 * removed.
 *
 * @module skill/skill-scope.helper
 */

import type { FrontMcpLogger } from '../common';
import type { ResourceType } from '../common/interfaces';
import type { SkillsConfigOptions } from '../common/types/options/skills-http';
import type FlowRegistry from '../flows/flow.registry';
import type ProviderRegistry from '../provider/provider.registry';
import type ResourceRegistry from '../resource/resource.registry';
import { LlmFullTxtFlow, LlmTxtFlow, LoadSkillFlow, SearchSkillsFlow, SkillsApiFlow } from './flows';
import { getSep2640Resources } from './sep-2640/resources';
import { resolveLastModifiedForSkill } from './sep-2640/sep-2640.last-modified';
import { registerPerSkillResources } from './sep-2640/sep-2640.per-skill';
import { registerSkillAuditWriter } from './skill-audit.helper';
import type SkillRegistry from './skill.registry';

/**
 * Options for registering skill capabilities.
 */
export interface SkillScopeRegistrationOptions {
  /** Skill registry containing registered skills */
  skillRegistry: SkillRegistry;
  /** Flow registry for registering skill flows */
  flowRegistry: FlowRegistry;
  /** Resource registry for registering skill resource templates */
  resourceRegistry: ResourceRegistry;
  /** Provider registry for dependency injection */
  providers: ProviderRegistry;
  /** Skills configuration from @FrontMcp metadata */
  skillsConfig?: SkillsConfigOptions;
  /** Logger instance for logging */
  logger: FrontMcpLogger;
}

/**
 * Register skill-related flows and resources in the scope.
 *
 * Handles:
 * - MCP flows for skill discovery/loading (SearchSkillsFlow, LoadSkillFlow)
 * - SEP-2640 conformant `skill://` resources unless disabled via
 *   `skillsConfig.mcpResources: false`
 * - HTTP flows (`/llm.txt`, `/llm_full.txt`, `/skills`) when
 *   `skillsConfig.enabled` is true
 *
 * @param options - Registration options
 *
 * @example
 * ```typescript
 * await registerSkillCapabilities({
 *   skillRegistry: this.scopeSkills,
 *   flowRegistry: this.scopeFlows,
 *   resourceRegistry: this.scopeResources,
 *   providers: this.scopeProviders,
 *   skillsConfig: this.metadata.skillsConfig,
 *   logger: this.logger,
 * });
 * ```
 */
export async function registerSkillCapabilities(options: SkillScopeRegistrationOptions): Promise<void> {
  const { skillRegistry, flowRegistry, resourceRegistry, providers, skillsConfig, logger } = options;

  // Register the skill audit writer first — registration is independent of
  // whether any skills are present at scope-init time. Plugins that mount
  // skills dynamically (e.g. plugin-skilled-openapi loading bundles after
  // boot) still need the writer wired up; gating on `hasAny()` would silently
  // disable audit logging in that scenario.
  registerSkillAuditWriter({ providers, audit: skillsConfig?.audit, logger });

  // The skills feature is "in use" when skills are already present OR the feature
  // is explicitly enabled (so a bundle mounted later still counts). A bare server
  // with no skills and no skillsConfig registers nothing here, keeping
  // `resources/list` empty (#407).
  const skillsInUse = skillRegistry.hasAny() || skillsConfig?.enabled === true;
  const shouldRegisterResources = skillsInUse && skillsConfig?.mcpResources !== false;

  // Register the STATIC SEP-2640 `skill://` resources FIRST — and crucially NOT
  // gated on `skillRegistry.hasAny()`. The discovery `skill://index.json`
  // enumerates the registry at READ time, and the `SKILL.md`/file entries are URI
  // TEMPLATES; neither depends on any skill being present right now. Plugins that
  // mount skills AFTER boot (e.g. plugin-skilled-openapi syncing a bundle on a
  // stateless V8 worker, where the registry is empty at scope-init) would
  // otherwise have their `skill://` resources permanently hidden from
  // `resources/list` / `resources/templates/list` even once the bundle loads.
  if (shouldRegisterResources) {
    await registerSep2640Resources({ resourceRegistry, logger });

    // Keep the per-skill concrete `resources/list` entries in sync with skills
    // that mount AFTER scope-init — a lazily-synced bundle on a stateless worker
    // (the registry is empty here, then fills on the first `ensureReady()`), or a
    // hot-swap. `registerDynamicResource` is idempotent (re-registering an
    // existing `skill://<name>/SKILL.md` is a no-op) AND emits the change event
    // that drives `resources/listChanged`, so re-running it on every skill change
    // simply adds the new entries. Registration runs SYNCHRONOUSLY (no
    // `resolveLastModified`): the callback fires inside the change-emitting
    // context (the bundle apply, a request on a worker), where a deferred
    // microtask may never complete after the response. Skills present at
    // scope-init are registered (with the `lastModified` hint) just below.
    skillRegistry.subscribe({ immediate: false }, () => {
      // Defensive: the subscriber runs synchronously inside the skill registry's
      // emit (i.e. inside `bundle apply`); a throw here must NOT abort the apply.
      try {
        const visibleSkills = skillRegistry.getSkills({ visibility: 'mcp' });
        if (visibleSkills.length === 0) return;
        void registerPerSkillResources({
          scope: providers.getActiveScope(),
          resourceRegistry,
          skills: visibleSkills,
          logger,
        });
      } catch (err) {
        logger.warn(
          `Failed to sync SEP-2640 per-skill resources on skill change: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  } else if (skillsInUse) {
    logger.verbose('SEP-2640 skill:// resources disabled via skillsConfig.mcpResources=false');
  }

  // Everything below operates on skills PRESENT at scope-init — skip when the
  // registry is still empty (skills that mount later are handled by the
  // subscription above).
  if (!skillRegistry.hasAny()) {
    return;
  }

  // Always register MCP flows for skills
  await flowRegistry.registryFlows([SearchSkillsFlow, LoadSkillFlow]);

  if (shouldRegisterResources) {
    // SEP-2640 §Resource Metadata: each `skill://<skill-path>/SKILL.md`
    // SHOULD surface in `resources/list` with frontmatter-derived `name`
    // and `description`. The template alone covers `resources/read` but
    // doesn't enumerate; per-skill concrete records fill that gap.
    const scope = providers.getActiveScope();
    const visibleSkills = skillRegistry.getSkills({ visibility: 'mcp' });
    if (visibleSkills.length > 0) {
      await registerPerSkillResources({
        scope,
        resourceRegistry,
        skills: visibleSkills,
        logger,
        resolveLastModified: resolveLastModifiedForSkill,
      });
    }
  }

  // Register HTTP flows if skillsConfig is enabled
  if (skillsConfig?.enabled) {
    await flowRegistry.registryFlows([LlmTxtFlow, LlmFullTxtFlow, SkillsApiFlow]);
    logger.verbose('Registered skills HTTP flows (llm.txt, llm_full.txt, /skills API)');
  }
}

/**
 * Register SEP-2640 (Skills Extension) conformance resources:
 *   - `skill://index.json`               — discovery index
 *   - `skill://{+skillPath}/SKILL.md`    — raw SKILL.md
 *   - `skill://{+skillPath}/{+filePath}` — generic sub-files
 *
 * Order matches `getSep2640Resources()` so the more-specific SKILL.md
 * template is registered before the generic file template.
 *
 * @internal
 */
async function registerSep2640Resources(options: {
  resourceRegistry: ResourceRegistry;
  logger: FrontMcpLogger;
}): Promise<void> {
  const { resourceRegistry, logger } = options;
  const resources = getSep2640Resources();

  for (const ResourceClass of resources) {
    try {
      resourceRegistry.registerDynamicResource(ResourceClass as ResourceType);
      const resourceName = typeof ResourceClass === 'function' ? ResourceClass.name : 'unknown';
      logger.verbose(`Registered SEP-2640 resource: ${resourceName}`);
    } catch (error) {
      logger.warn(`Failed to register SEP-2640 resource: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
