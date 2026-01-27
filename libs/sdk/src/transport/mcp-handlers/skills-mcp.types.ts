import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Skills Search Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Request schema for skills/search custom MCP method.
 */
export const SkillsSearchRequestSchema = z.object({
  method: z.literal('skills/search'),
  params: z.object({
    query: z.string().describe('Search query string'),
    tags: z.array(z.string()).optional().describe('Filter by specific tags'),
    tools: z.array(z.string()).optional().describe('Filter by specific tools'),
    limit: z.number().min(1).max(50).optional().describe('Maximum results (1-50, default: 10)'),
    requireAllTools: z.boolean().optional().describe('Require all specified tools'),
  }),
});

export type SkillsSearchRequest = z.infer<typeof SkillsSearchRequestSchema>;

/**
 * Response schema for skills/search validation.
 */
export const SkillsSearchResultSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      score: z.number(),
      tags: z.array(z.string()).optional(),
      tools: z.array(z.object({ name: z.string(), available: z.boolean() })),
      source: z.enum(['local', 'external']),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
  guidance: z.string(),
});

export type SkillsSearchResult = z.infer<typeof SkillsSearchResultSchema> & {
  [key: string]: unknown;
};

// ═══════════════════════════════════════════════════════════════════════════
// Skills Load Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Request schema for skills/load custom MCP method.
 */
export const SkillsLoadRequestSchema = z.object({
  method: z.literal('skills/load'),
  params: z.object({
    skillIds: z.array(z.string()).min(1).describe('Array of skill IDs to load'),
    format: z.enum(['full', 'instructions-only']).optional().describe('Content format'),
    activateSession: z.boolean().optional().describe('Whether to activate a skill session'),
    policyMode: z.enum(['strict', 'approval', 'permissive']).optional().describe('Policy mode for session'),
  }),
});

export type SkillsLoadRequest = z.infer<typeof SkillsLoadRequestSchema>;

/**
 * Response schema for skills/load validation.
 */
export const SkillsLoadResultSchema = z.object({
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

export type SkillsLoadResult = z.infer<typeof SkillsLoadResultSchema> & {
  [key: string]: unknown;
};

// ═══════════════════════════════════════════════════════════════════════════
// Skills List Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Request schema for skills/list custom MCP method.
 */
export const SkillsListRequestSchema = z.object({
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

export type SkillsListRequest = z.infer<typeof SkillsListRequestSchema>;

/**
 * Response schema for skills/list validation.
 */
export const SkillsListResultSchema = z.object({
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

export type SkillsListResult = z.infer<typeof SkillsListResultSchema> & {
  [key: string]: unknown;
};
