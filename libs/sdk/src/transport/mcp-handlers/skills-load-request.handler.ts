import { PublicMcpError } from '../../errors';
import { assertSkillAuthorized } from '../../skill/skill-authorities.helper';
import { formatSkillForLLMWithSchemas } from '../../skill/skill-http.utils';
import { formatSkillForLLM } from '../../skill/skill.utils';
import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import {
  SkillsLoadRequestSchema,
  SkillsLoadResultSchema,
  type SkillsLoadRequest,
  type SkillsLoadResult,
} from './skills-mcp.types';

/**
 * Tool information entry with availability and optional schemas.
 * Used in the skills/load response to describe each tool.
 */
interface ToolInfoEntry {
  name: string;
  purpose?: string;
  available: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

/**
 * MCP handler for skills/load custom method.
 *
 * Allows MCP clients to load skills by ID with full content.
 */
export default function skillsLoadRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsLoadRequest, SkillsLoadResult> {
  const logger = scope.logger.child('skills-load-request-handler');

  return {
    requestSchema: SkillsLoadRequestSchema,
    responseSchema: SkillsLoadResultSchema,
    handler: async (request: SkillsLoadRequest, ctx) => {
      const { skillIds, format } = request.params;
      logger.verbose(`skills/load: [${skillIds.join(', ')}]`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
      }

      // Entry-level authorities: deny direct load of a gated skill the caller
      // can't access (throws AuthorityDeniedError, MCP code -32003 — same as a
      // denied tool call). No-op for ungated skills or when no engine exists.
      const authInfo = (ctx?.authInfo ?? {}) as Record<string, unknown>;

      const toolRegistry = scope.tools;

      const loadedSkills: SkillsLoadResult['skills'] = [];
      const warnings: string[] = [];
      const allToolNames = new Set<string>();
      let allToolsAvailable = true;

      // Build tool lookup map once before iteration (performance optimization)
      const toolsByName = new Map<string, { getInputJsonSchema: () => unknown }>();
      if (toolRegistry && format !== 'instructions-only') {
        const allTools = toolRegistry.getTools(false);
        for (const tool of allTools) {
          toolsByName.set(tool.name, tool);
        }
      }

      for (const skillId of skillIds) {
        const loadResult = await skillRegistry.loadSkill(skillId);
        if (!loadResult) {
          warnings.push(`Skill "${skillId}" not found`);
          continue;
        }

        // Resolve the backing entry to evaluate its authorities (only when an
        // authorities engine is configured — otherwise behaviour is unchanged).
        // Matches by the requested id, then the resolved content id, then
        // display name — covering id/name/qualified-name lookups loadSkill
        // accepts.
        if (scope.authoritiesEngine) {
          const entry =
            skillRegistry.findByName(skillId) ??
            skillRegistry.findByQualifiedName(skillId) ??
            skillRegistry.findByName(loadResult.skill.id) ??
            skillRegistry
              .getSkills(true)
              .find(
                (s) => (s.metadata.id ?? s.name) === loadResult.skill.id || s.metadata.name === loadResult.skill.id,
              );
          if (entry) {
            try {
              await assertSkillAuthorized(scope, entry, authInfo);
            } catch (err) {
              // Surface AuthorityDeniedError as the MCP FORBIDDEN code (-32003)
              // via its toJsonRpcError(), matching a denied tools/call. Without
              // this the generic dispatch would flatten it to -32603.
              throw toSdkMcpError(err);
            }
          }
        }

        const { skill, availableTools, missingTools, isComplete, warning } = loadResult;

        if (warning) {
          warnings.push(warning);
        }
        if (!isComplete) {
          allToolsAvailable = false;
        }

        // Track all tools
        for (const tool of skill.tools) {
          allToolNames.add(tool.name);
        }

        // Generate formatted content
        const formattedContent = toolRegistry
          ? formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry)
          : formatSkillForLLM(skill, availableTools, missingTools);

        // Build tool info with schemas
        const toolsWithSchemas: ToolInfoEntry[] = skill.tools.map((t) => {
          const available = availableTools.includes(t.name);
          const toolInfo: ToolInfoEntry = {
            name: t.name,
            purpose: t.purpose,
            available,
          };

          // Include schemas in full format
          if (format !== 'instructions-only' && available) {
            const toolEntry = toolsByName.get(t.name);
            if (toolEntry) {
              toolInfo.inputSchema = toolEntry.getInputJsonSchema();
            }
          }

          return toolInfo;
        });

        loadedSkills.push({
          id: skill.id,
          name: skill.name,
          description: skill.description ?? '',
          instructions: skill.instructions,
          tools: toolsWithSchemas,
          parameters: skill.parameters?.map((p) => ({
            name: p.name,
            description: p.description,
            required: p.required,
            type: p.type,
          })),
          availableTools,
          missingTools,
          isComplete,
          formattedContent,
          // Session activation not implemented yet in DirectClient
          session: undefined,
        });
      }

      const summary = {
        totalSkills: loadedSkills.length,
        totalTools: allToolNames.size,
        allToolsAvailable,
        combinedWarnings: warnings.length > 0 ? warnings : undefined,
      };

      const nextSteps =
        loadedSkills.length > 0
          ? `Loaded ${loadedSkills.length} skill(s). Follow the instructions to complete the task.`
          : 'No skills were loaded. Check the skill IDs and try again.';

      const result = {
        skills: loadedSkills,
        summary,
        nextSteps,
      };

      // Validate result against schema
      return SkillsLoadResultSchema.parse(result);
    },
  };
}
