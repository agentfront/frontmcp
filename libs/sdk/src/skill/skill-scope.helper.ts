// file: libs/sdk/src/skill/skill-scope.helper.ts

/**
 * Helper for registering skill capabilities in scope.
 *
 * This module extracts skill-specific registration logic from scope.instance.ts
 * to maintain separation of concerns and improve maintainability.
 *
 * @module skill/skill-scope.helper
 */

import type { FrontMcpLogger } from '../common';
import type { SkillsConfigOptions } from '../common/types/options/skills-http';
import type FlowRegistry from '../flows/flow.registry';
import type ProviderRegistry from '../provider/provider.registry';
import type { ResourceType } from '../common/interfaces';
import type ResourceRegistry from '../resource/resource.registry';
import type SkillRegistry from './skill.registry';
import { SearchSkillsFlow, LoadSkillFlow, LlmTxtFlow, LlmFullTxtFlow, SkillsApiFlow } from './flows';
import { getSkillResources } from './resources';

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
 * This function handles:
 * - Registering MCP flows for skill discovery/loading (SearchSkillsFlow, LoadSkillFlow)
 * - Registering skill MCP resources (skills:// URI scheme) unless disabled
 * - Registering HTTP flows (llm.txt, llm_full.txt, /skills) when skillsConfig is enabled
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

  // Register skill MCP resources (skills:// URI scheme) unless disabled
  const shouldRegisterMcpResources = skillsConfig?.mcpResources !== false;

  if (shouldRegisterMcpResources) {
    await registerSkillMcpResources({ resourceRegistry, logger });
  } else {
    logger.verbose('Skill MCP resources disabled via skillsConfig.mcpResources=false');
  }

  // Register HTTP flows if skillsConfig is enabled
  if (skillsConfig?.enabled) {
    await flowRegistry.registryFlows([LlmTxtFlow, LlmFullTxtFlow, SkillsApiFlow]);
    logger.verbose('Registered skills HTTP flows (llm.txt, llm_full.txt, /skills API)');
  }
}

/**
 * Register skill MCP resources in the resource registry.
 *
 * @internal
 */
async function registerSkillMcpResources(options: {
  resourceRegistry: ResourceRegistry;
  logger: FrontMcpLogger;
}): Promise<void> {
  const { resourceRegistry, logger } = options;
  const skillResources = getSkillResources();

  for (const ResourceClass of skillResources) {
    try {
      resourceRegistry.registerDynamicResource(ResourceClass as ResourceType);
      const resourceName = typeof ResourceClass === 'function' ? ResourceClass.name : 'unknown';
      logger.verbose(`Registered skill resource: ${resourceName}`);
    } catch (error) {
      logger.warn(`Failed to register skill resource: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
