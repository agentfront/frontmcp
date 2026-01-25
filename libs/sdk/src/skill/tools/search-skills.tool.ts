// file: libs/sdk/src/skill/tools/search-skills.tool.ts

import { z } from 'zod';
import { Tool, ToolContext, normalizeToolRef } from '../../common';
import { SkillSearchResult } from '../skill-storage.interface';
import { generateSearchGuidance } from '../skill.utils';

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
      score: z.number().describe('Relevance score (0-1), higher means better match'),
      tags: z.array(z.string()).optional(),
      tools: z.array(
        z.object({
          name: z.string(),
          available: z.boolean().describe('Whether this tool is available on this server'),
        }),
      ),
      source: z.enum(['local', 'external']),
      canExecute: z.boolean().describe('True if all required tools are available'),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
  guidance: z.string().describe('Suggested next action based on search results'),
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
    'Discover available skills on this MCP server. Skills are pre-built workflows that guide you through ' +
    "complex multi-step tasks using the server's tools.\n\n" +
    '**This is the recommended starting point** when you need to:\n' +
    "- Accomplish a task you haven't done before on this server\n" +
    '- Find the right combination of tools for a complex workflow\n' +
    '- Learn what capabilities this MCP server offers\n\n' +
    '**How skills work:**\n' +
    '1. Search for skills matching your goal (this tool)\n' +
    '2. Load the full skill details with loadSkills\n' +
    '3. Follow the step-by-step instructions, calling the tools listed\n\n' +
    '**Search tips:**\n' +
    '- Use natural language: "review a pull request", "deploy to production"\n' +
    '- Filter by tags: tags: ["github", "devops"]\n' +
    '- Filter by required tools: tools: ["git_commit", "git_push"]\n' +
    '- Set requireAllTools: true to only see skills you can fully execute\n\n' +
    '**Output explained:**\n' +
    '- score: Relevance to your query (higher is better)\n' +
    "- tools[].available: Whether you can use this tool (true) or it's missing (false)\n" +
    '- canExecute: True if all tools are available for this skill\n' +
    '- Use the skill id or name with loadSkills to get full instructions',
  inputSchema,
  outputSchema,
  tags: ['skills', 'discovery', 'entry-point'],
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
        guidance: 'No skills are available on this server. You can still use individual tools directly.',
      };
    }

    // Search for skills
    const results = await skillRegistry.search(input.query, {
      tags: input.tags,
      tools: input.tools,
      topK: input.limit,
      requireAllTools: input.requireAllTools,
    });

    // Filter by MCP visibility (only 'mcp' or 'both' should be visible via MCP tools)
    const mcpVisibleResults = results.filter((result: SkillSearchResult) => {
      const visibility = result.metadata.visibility ?? 'both';
      return visibility === 'mcp' || visibility === 'both';
    });

    // Transform results to output format
    const skills = mcpVisibleResults.map((result: SkillSearchResult) => {
      const tools = (result.metadata.tools ?? []).map((t) => {
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
      });

      return {
        id: result.metadata.id ?? result.metadata.name,
        name: result.metadata.name,
        description: result.metadata.description,
        score: result.score,
        tags: result.metadata.tags,
        tools,
        source: result.source,
        canExecute: tools.every((t) => t.available),
      };
    });

    // Pagination info:
    // - total: number of results returned (search already filtered by query/tags/tools)
    // - hasMore: true if we hit the limit (indicating more results may exist)
    const total = skills.length;
    const hasMore = skills.length >= input.limit;

    // Generate guidance based on results
    const guidance = generateSearchGuidance(
      skills.map((s) => ({ name: s.name, score: s.score, canExecute: s.canExecute })),
      input.query,
    );

    return {
      skills,
      total,
      hasMore,
      guidance,
    };
  }
}
