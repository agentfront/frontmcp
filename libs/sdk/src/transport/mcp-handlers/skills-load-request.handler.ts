import { z } from 'zod';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { formatSkillForLLMWithSchemas } from '../../skill/skill-http.utils';
import { formatSkillForLLM } from '../../skill/skill.utils';

/**
 * Request schema for skills/load custom MCP method.
 */
const SkillsLoadRequestSchema = z.object({
  method: z.literal('skills/load'),
  params: z.object({
    skillIds: z.array(z.string()).min(1).describe('Array of skill IDs to load'),
    format: z.enum(['full', 'instructions-only']).optional().describe('Content format'),
    activateSession: z.boolean().optional().describe('Whether to activate a skill session'),
    policyMode: z.enum(['strict', 'approval', 'permissive']).optional().describe('Policy mode for session'),
  }),
});

type SkillsLoadRequest = z.infer<typeof SkillsLoadRequestSchema>;

/**
 * Response schema for skills/load.
 */
const SkillsLoadResultSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
      tools: z.array(
        z.object({
          name: z.string(),
          purpose: z.string().optional(),
          available: z.boolean(),
          inputSchema: z.unknown().optional(),
          outputSchema: z.unknown().optional(),
        }),
      ),
      parameters: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            required: z.boolean().optional(),
            type: z.string().optional(),
          }),
        )
        .optional(),
      availableTools: z.array(z.string()),
      missingTools: z.array(z.string()),
      isComplete: z.boolean(),
      formattedContent: z.string(),
      session: z
        .object({
          activated: z.boolean(),
          sessionId: z.string().optional(),
          policyMode: z.string().optional(),
          allowedTools: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  summary: z.object({
    totalSkills: z.number(),
    totalTools: z.number(),
    allToolsAvailable: z.boolean(),
    combinedWarnings: z.array(z.string()).optional(),
  }),
  nextSteps: z.string(),
});

type SkillsLoadResult = z.infer<typeof SkillsLoadResultSchema>;

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
    handler: async (request: SkillsLoadRequest) => {
      const { skillIds, format } = request.params;
      logger.verbose(`skills/load: [${skillIds.join(', ')}]`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new Error('Skills capability not available');
      }

      const toolRegistry = scope.tools;

      const loadedSkills: SkillsLoadResult['skills'] = [];
      const warnings: string[] = [];
      const allToolNames = new Set<string>();
      let allToolsAvailable = true;

      for (const skillId of skillIds) {
        const loadResult = await skillRegistry.loadSkill(skillId);
        if (!loadResult) {
          warnings.push(`Skill "${skillId}" not found`);
          continue;
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

        // Get tool schemas if full format is requested
        // Build a lookup map from tool registry if available
        const toolsByName = new Map<string, { getInputJsonSchema: () => unknown }>();
        if (toolRegistry && format !== 'instructions-only') {
          const allTools = toolRegistry.getTools(false);
          for (const tool of allTools) {
            toolsByName.set(tool.name, tool);
          }
        }

        const toolsWithSchemas = skill.tools.map((t) => {
          const available = availableTools.includes(t.name);
          const toolInfo: {
            name: string;
            purpose?: string;
            available: boolean;
            inputSchema?: unknown;
            outputSchema?: unknown;
          } = {
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

      return {
        skills: loadedSkills,
        summary,
        nextSteps,
      };
    },
  };
}
