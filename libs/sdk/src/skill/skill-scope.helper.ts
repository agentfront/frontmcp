// file: libs/sdk/src/skill/skill-scope.helper.ts

/**
 * Helper for registering skill capabilities in scope.
 *
 * This module extracts skill-specific registration logic from scope.instance.ts
 * to maintain separation of concerns and improve maintainability.
 *
 * @module skill/skill-scope.helper
 */

import type { FrontMcpLogger, EntryOwnerRef } from '../common';
import type { SkillsConfigOptions } from '../common/types/options/skills-http';
import type FlowRegistry from '../flows/flow.registry';
import type ToolRegistry from '../tool/tool.registry';
import type ProviderRegistry from '../provider/provider.registry';
import type SkillRegistry from './skill.registry';
import { SearchSkillsFlow, LoadSkillFlow, LlmTxtFlow, LlmFullTxtFlow, SkillsApiFlow } from './flows';
import { getSkillTools } from './tools';
import { normalizeTool } from '../tool/tool.utils';
import { ToolInstance } from '../tool/tool.instance';

/**
 * Options for registering skill capabilities.
 */
export interface SkillScopeRegistrationOptions {
  /** Skill registry containing registered skills */
  skillRegistry: SkillRegistry;
  /** Flow registry for registering skill flows */
  flowRegistry: FlowRegistry;
  /** Tool registry for registering skill tools */
  toolRegistry: ToolRegistry;
  /** Provider registry for dependency injection */
  providers: ProviderRegistry;
  /** Skills configuration from @FrontMcp metadata */
  skillsConfig?: SkillsConfigOptions;
  /** Logger instance for logging */
  logger: FrontMcpLogger;
}

/**
 * Register skill-related flows and tools in the scope.
 *
 * This function handles:
 * - Registering MCP flows for skill discovery/loading (SearchSkillsFlow, LoadSkillFlow)
 * - Registering skill MCP tools (searchSkills, loadSkill) unless disabled
 * - Registering HTTP flows (llm.txt, llm_full.txt, /skills) when skillsConfig is enabled
 *
 * @param options - Registration options
 *
 * @example
 * ```typescript
 * await registerSkillCapabilities({
 *   skillRegistry: this.scopeSkills,
 *   flowRegistry: this.scopeFlows,
 *   toolRegistry: this.scopeTools,
 *   providers: this.scopeProviders,
 *   skillsConfig: this.metadata.skillsConfig,
 *   logger: this.logger,
 * });
 * ```
 */
export async function registerSkillCapabilities(options: SkillScopeRegistrationOptions): Promise<void> {
  const { skillRegistry, flowRegistry, toolRegistry, providers, skillsConfig, logger } = options;

  // Early exit if no skills registered
  if (!skillRegistry.hasAny()) {
    return;
  }

  // Always register MCP flows for skills
  await flowRegistry.registryFlows([SearchSkillsFlow, LoadSkillFlow]);

  // Register skill MCP tools (searchSkills, loadSkill) unless disabled
  const shouldRegisterMcpTools = skillsConfig?.mcpTools !== false;

  if (shouldRegisterMcpTools) {
    await registerSkillMcpTools({ toolRegistry, providers, logger });
  } else {
    logger.verbose('Skill MCP tools disabled via skillsConfig.mcpTools=false');
  }

  // Register HTTP flows if skillsConfig is enabled
  if (skillsConfig?.enabled) {
    await flowRegistry.registryFlows([LlmTxtFlow, LlmFullTxtFlow, SkillsApiFlow]);
    logger.verbose('Registered skills HTTP flows (llm.txt, llm_full.txt, /skills API)');
  }
}

/**
 * Register skill MCP tools in the tool registry.
 *
 * @internal
 */
async function registerSkillMcpTools(options: {
  toolRegistry: ToolRegistry;
  providers: ProviderRegistry;
  logger: FrontMcpLogger;
}): Promise<void> {
  const { toolRegistry, providers, logger } = options;
  const skillTools = getSkillTools();

  const ownerRef: EntryOwnerRef = {
    kind: 'scope',
    id: '_skills',
    ref: undefined as unknown as new (...args: unknown[]) => unknown,
  };

  for (const SkillToolClass of skillTools) {
    try {
      const toolRecord = normalizeTool(SkillToolClass);

      // Update owner ref for each tool
      ownerRef.ref = SkillToolClass;

      const toolEntry = new ToolInstance(toolRecord, providers, ownerRef);
      await toolEntry.ready;

      toolRegistry.registerToolInstance(toolEntry);
      logger.verbose(`Registered skill tool: ${toolRecord.metadata.name}`);
    } catch (error) {
      logger.warn(`Failed to register skill tool: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
