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

  // Early exit if no skills registered
  if (!skillRegistry.hasAny()) {
    return;
  }

  // Always register MCP flows for skills
  await flowRegistry.registryFlows([SearchSkillsFlow, LoadSkillFlow]);

  // Register SEP-2640 `skill://` resources unless explicitly disabled.
  const shouldRegisterResources = skillsConfig?.mcpResources !== false;
  if (shouldRegisterResources) {
    await registerSep2640Resources({ resourceRegistry, logger });

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
  } else {
    logger.verbose('SEP-2640 skill:// resources disabled via skillsConfig.mcpResources=false');
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
