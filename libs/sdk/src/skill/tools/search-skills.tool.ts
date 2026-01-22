// file: libs/sdk/src/skill/tools/search-skills.tool.ts

import { z } from 'zod';
import { Tool, ToolContext, normalizeToolRef } from '../../common';
import { SkillSearchResult } from '../skill-storage.interface';

/**
 * Input schema for searchSkills tool.
 */
const inputSchema = {
  query: z.string().min(1).describe('Search query to find relevant skills'),
  tags: z.array(z.string()).optional().describe('Filter by specific tags'),
  tools: z.array(z.string()).optional().describe('Filter by skills that use specific tools'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
  requireAllTools: z.boolean().default(false).describe('Only return skills where all tools are available'),
};

/**
 * Output schema for searchSkills tool.
 */
const outputSchema = {
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      score: z.number(),
      tags: z.array(z.string()).optional(),
      tools: z.array(
        z.object({
          name: z.string(),
          available: z.boolean(),
        }),
      ),
      source: z.enum(['local', 'external']),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

/**
 * Tool for searching skills in the registry.
 *
 * This tool allows LLMs to discover skills based on natural language queries,
 * tags, or required tools. Results include relevance scores and tool availability.
 *
 * @example
 * ```typescript
 * // Search for PR review skills
 * const result = await searchSkills({ query: 'review pull request' });
 *
 * // Filter by tags
 * const result = await searchSkills({ query: 'deploy', tags: ['devops'] });
 *
 * // Only skills with all tools available
 * const result = await searchSkills({ query: 'git', requireAllTools: true });
 * ```
 */
@Tool({
  name: 'searchSkills',
  description:
    'Search for skills that can help with multi-step tasks. ' +
    'Skills are workflow guides that combine multiple tools. ' +
    'Use this to find relevant skills before starting complex tasks.',
  inputSchema,
  outputSchema,
  tags: ['skills', 'discovery'],
  annotations: {
    title: 'Search Skills',
    readOnlyHint: true,
  },
})
export class SearchSkillsTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    const skillRegistry = this.scope.skills;

    if (!skillRegistry || !skillRegistry.hasAny()) {
      return {
        skills: [],
        total: 0,
        hasMore: false,
      };
    }

    // Search for skills
    const results = await skillRegistry.search(input.query, {
      tags: input.tags,
      tools: input.tools,
      topK: input.limit,
      requireAllTools: input.requireAllTools,
    });

    // Transform results to output format
    const skills = results.map((result: SkillSearchResult) => ({
      id: result.metadata.id ?? result.metadata.name,
      name: result.metadata.name,
      description: result.metadata.description,
      score: result.score,
      tags: result.metadata.tags,
      tools: (result.metadata.tools ?? []).map((t) => {
        // Use normalizeToolRef to correctly handle all tool reference types
        // including class-based refs where t.name would be the class name
        try {
          const normalized = normalizeToolRef(t);
          return {
            name: normalized.name,
            available: result.availableTools.includes(normalized.name),
          };
        } catch {
          // Fallback for edge cases
          const toolName = typeof t === 'string' ? t : ((t as { name?: string }).name ?? 'unknown');
          return {
            name: toolName,
            available: result.availableTools.includes(toolName),
          };
        }
      }),
      source: result.source,
    }));

    // Pagination info:
    // - total: number of results returned (search already filtered by query/tags/tools)
    // - hasMore: true if we hit the limit (indicating more results may exist)
    const total = skills.length;
    const hasMore = skills.length >= input.limit;

    return {
      skills,
      total,
      hasMore,
    };
  }
}
