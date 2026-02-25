// file: libs/sdk/src/skill/flows/search-skills.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, normalizeToolRef } from '../../common';
import { z } from 'zod';
import { InvalidInputError } from '../../errors';
import { SkillSearchOptions, SkillSearchResult } from '../skill-storage.interface';

// Input schema matching MCP request format
const inputSchema = z.object({
  request: z.object({
    method: z.literal('skills/search'),
    params: z.object({
      query: z.string().min(1).describe('Search query to find relevant skills'),
      tags: z.array(z.string()).optional().describe('Filter by specific tags'),
      tools: z.array(z.string()).optional().describe('Filter by skills that use specific tools'),
      limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
      requireAllTools: z.boolean().default(false).describe('Only return skills where all tools are available'),
    }),
  }),
  ctx: z.unknown(),
});

// Output schema
const outputSchema = z.object({
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
});

type Input = z.input<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const stateSchema = z.object({
  query: z.string(),
  options: z.object({
    tags: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    topK: z.number().optional(),
    requireAllTools: z.boolean().optional(),
  }),
  results: z.array(z.any()),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput'],
  execute: ['search'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'skills:search': FlowRunOptions<
      SearchSkillsFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills:search' as const;
const { Stage } = FlowHooksOf<'skills:search'>(name);

/**
 * Flow for searching skills.
 *
 * This flow handles skill discovery by searching through both local
 * and external skill providers. Results include relevance scores
 * and tool availability information.
 *
 * @example MCP Request
 * ```json
 * {
 *   "method": "skills/search",
 *   "params": {
 *     "query": "review pull request",
 *     "tags": ["github"],
 *     "limit": 10
 *   }
 * }
 * ```
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class SearchSkillsFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SearchSkillsFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let params: Input['request']['params'];
    try {
      const inputData = inputSchema.parse(this.rawInput);
      params = inputData.request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    const { query, tags, tools, limit, requireAllTools } = params;

    const options: SkillSearchOptions = {
      tags,
      tools,
      topK: limit,
      requireAllTools,
    };

    this.state.set({ query, options });
    this.logger.verbose('parseInput:done');
  }

  @Stage('search')
  async search() {
    this.logger.verbose('search:start');
    const { query, options } = this.state.required;

    const skillRegistry = this.scope.skills;

    if (!skillRegistry || !skillRegistry.hasAny()) {
      this.state.set({ results: [] });
      this.logger.verbose('search:no-skills');
      return;
    }

    // Search for skills
    const results = await skillRegistry.search(query, options);
    this.state.set({ results });

    this.logger.verbose(`search:found ${results.length} skills`);
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { results, options } = this.state.required;

    // Store pre-filtered count for hasMore calculation
    const preFilteredCount = (results as SkillSearchResult[]).length;

    // Filter by MCP visibility (only 'mcp' or 'both' should be visible via MCP tools)
    const mcpVisibleResults = (results as SkillSearchResult[]).filter((result) => {
      const visibility = result.metadata.visibility ?? 'both';
      return visibility === 'mcp' || visibility === 'both';
    });

    // Transform results to output format
    const skills = mcpVisibleResults.map((result) => ({
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
    // - total: number of MCP-visible results returned
    // - hasMore: true if pre-filtered results hit the limit (more results may exist)
    // Note: We use preFilteredCount for hasMore because visibility filtering is post-search.
    // We can't know the exact total of matching skills without a full scan,
    // so we report the actual returned count and indicate if limit was reached.
    const limit = options.topK ?? 10;
    const total = skills.length;
    const hasMore = preFilteredCount >= limit;

    const output: Output = {
      skills,
      total,
      hasMore,
    };

    this.state.set({ output });
    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
