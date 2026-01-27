import { z } from 'zod';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

/**
 * Request schema for skills/list custom MCP method.
 */
const SkillsListRequestSchema = z.object({
  method: z.literal('skills/list'),
  params: z
    .object({
      offset: z.number().min(0).optional().describe('Number of skills to skip'),
      limit: z.number().min(1).max(100).optional().describe('Maximum skills to return'),
      tags: z.array(z.string()).optional().describe('Filter by specific tags'),
      sortBy: z.enum(['name', 'priority', 'createdAt']).optional().describe('Field to sort by'),
      sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort order'),
      includeHidden: z.boolean().optional().describe('Include hidden skills'),
    })
    .optional(),
});

type SkillsListRequest = z.infer<typeof SkillsListRequestSchema>;

/**
 * Response schema for skills/list.
 */
const SkillsListResultSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string()).optional(),
      priority: z.number().optional(),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
});

type SkillsListResult = z.infer<typeof SkillsListResultSchema>;

/**
 * MCP handler for skills/list custom method.
 *
 * Allows MCP clients to list all available skills.
 */
export default function skillsListRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsListRequest, SkillsListResult> {
  const logger = scope.logger.child('skills-list-request-handler');

  return {
    requestSchema: SkillsListRequestSchema,
    handler: async (request: SkillsListRequest) => {
      const params = request.params ?? {};
      const { offset, limit, tags, sortBy, sortOrder, includeHidden } = params;
      logger.verbose(`skills/list: offset=${offset}, limit=${limit}`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new Error('Skills capability not available');
      }

      // List skills using the registry
      const result = await skillRegistry.listSkills({
        offset,
        limit,
        tags,
        sortBy,
        sortOrder,
        includeHidden,
      });

      // Transform to response format
      const skills = result.skills.map((s) => ({
        id: s.id ?? s.name,
        name: s.name,
        description: s.description ?? '',
        tags: s.tags,
        priority: s.priority,
      }));

      return {
        skills,
        total: result.total,
        hasMore: result.hasMore,
      };
    },
  };
}
