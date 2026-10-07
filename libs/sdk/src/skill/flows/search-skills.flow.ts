// file: libs/sdk/src/skill/flows/search-skills.flow.ts

import { z } from '@frontmcp/lazy-zod';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { extractToolNames } from '../../common/metadata/skill.metadata';
import { DependencyNotFoundError, InvalidInputError, ProviderNotAvailableError, PublicMcpError } from '../../errors';
import { SkillsSearchRequestSchema, SkillsSearchResultSchema } from '../../transport/mcp-handlers/skills-mcp.types';
import { filterDiscoverableSkillResults } from '../skill-filter.helper';
import { type SkillSearchOptions, type SkillSearchResult } from '../skill-storage.interface';

/**
 * Global symbol for the observability TelemetryAccessor token. Mirrors the
 * `Symbol.for('frontmcp:observability:telemetry-accessor')` declared by
 * `@frontmcp/observability` so we can probe for it without taking a hard
 * import dependency on that package (it's an optional peer dep).
 */
const TELEMETRY_ACCESSOR_TOKEN = Symbol.for('frontmcp:observability:telemetry-accessor');

/** Minimal duck-typed surface we use from TelemetryAccessor — keeps SDK isolated. */
interface FlowTelemetryAccessor {
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setAttributes(attrs: Record<string, string | number | boolean>): void;
}

/**
 * Probe for the observability TelemetryAccessor without taking a hard import
 * dependency. Returns undefined when ObservabilityPlugin is not installed.
 *
 * Only swallows the not-registered errors (`ProviderNotAvailableError`, `DependencyNotFoundError`) — any other error (DI
 * misconfiguration, circular deps, factory throws) propagates so real bugs
 * are surfaced rather than silently degrading telemetry.
 */
function tryGetTelemetry(flow: SearchSkillsFlow): FlowTelemetryAccessor | undefined {
  try {
    const t = flow.get(TELEMETRY_ACCESSOR_TOKEN as never) as unknown;
    if (t && typeof (t as FlowTelemetryAccessor).addEvent === 'function') {
      return t as FlowTelemetryAccessor;
    }
    return undefined;
  } catch (err) {
    if (err instanceof ProviderNotAvailableError || err instanceof DependencyNotFoundError) return undefined;
    throw err;
  }
}

const inputSchema = z.object({
  request: SkillsSearchRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = SkillsSearchResultSchema;

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

    let params: z.infer<typeof SkillsSearchRequestSchema>['params'];
    try {
      params = inputSchema.parse(this.rawInput).request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    const { query, tags, tools, limit = 10, requireAllTools } = params;
    const options: SkillSearchOptions = { tags, tools, topK: limit, requireAllTools };

    this.state.set({ query, options });
    this.logger.verbose('parseInput:done');
  }

  @Stage('search')
  async search() {
    this.logger.verbose('search:start');
    const { query, options } = this.state.required;

    const telemetry = tryGetTelemetry(this);
    const topK = options.topK ?? 10;
    // Privacy: emit ONLY non-identifying shape information about the query.
    // The raw query text is unbounded user/LLM-supplied free text and may
    // contain PII, tenant/customer identifiers, or confidential strings. It
    // must never appear in span attributes, since exporters route attributes
    // to vendor SaaS without redaction.
    telemetry?.addEvent('skill_search.query', {
      'query.length': query.length,
      topK,
      mcp_only: true,
    });

    const skillRegistry = this.scope.skills;
    if (!skillRegistry) {
      throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
    }

    const results = await skillRegistry.search(query, options);
    this.state.set({ results });

    // Same privacy rule applies to result events: emit only counts/booleans, never per-result IDs or scores.
    telemetry?.addEvent('skill_search.results', {
      count: results.length,
      truncated: results.length >= topK,
    });

    this.logger.verbose(`search:found ${results.length} skills`);
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { results, options } = this.state.required;
    const searchResults = results as SkillSearchResult[];

    // Only skills visible over MCP ('mcp' or 'both')
    const mcpVisibleResults = searchResults.filter((result) => {
      const visibility = result.metadata.visibility ?? 'both';
      return visibility === 'mcp' || visibility === 'both';
    });

    // Hide skills the caller can't discover: authority-gated ones (mirrors `filterByAuthorities` for
    // tools/resources; evaluated WITHOUT request input, so role/permission/claims-based authorities only),
    // then those the `skills:filter` flow drops.
    const registry = this.scope.skills;
    const ctx = this.input.ctx as { authInfo?: Record<string, unknown> } | undefined;
    const servableResults = registry
      ? await filterDiscoverableSkillResults(this.scope, registry, mcpVisibleResults, {
          authInfo: ctx?.authInfo ?? {},
          ctx,
        })
      : mcpVisibleResults;

    const skills = servableResults.map((result) => ({
      id: result.metadata.id ?? result.metadata.name,
      name: result.metadata.name,
      description: result.metadata.description ?? '',
      score: result.score,
      tags: result.metadata.tags,
      tools: extractToolNames(result.metadata).map((name) => ({
        name,
        available: result.availableTools.includes(name),
      })),
      source: result.source,
    }));

    // hasMore: the search filled its limit before visibility filtering, so more may exist
    const output: Output = {
      skills,
      total: skills.length,
      hasMore: searchResults.length >= (options.topK ?? 10),
      guidance:
        skills.length > 0
          ? `Found ${skills.length} matching skill(s). Use skills/load with skill IDs to load full content.`
          : 'No matching skills found. Try different search terms or list all skills with skills/list.',
    };

    this.state.set({ output });
    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
