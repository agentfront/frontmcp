// file: libs/sdk/src/skill/flows/http/skills-api.flow.ts

/**
 * HTTP flow for GET /skills/* API endpoints.
 * Provides JSON API for listing, searching, and loading skills.
 */

import { z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  normalizeEntryPrefix,
  normalizeScopeBase,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../../common';
import { extractToolNames } from '../../../common/metadata/skill.metadata';
import { normalizeSkillsConfigOptions } from '../../../common/types/options/skills-http';
import type ToolRegistry from '../../../tool/tool.registry';
import { createSkillHttpAuthValidator } from '../../auth';
import { formatSkillForLLMWithSchemas, skillToApiResponse } from '../../skill-http.utils';
import type { SkillRegistryInterface } from '../../skill.registry';
import { formatSkillForLLM } from '../../skill.utils';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  action: z.enum(['list', 'search', 'get']),
  skillId: z.string().optional(),
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  category: z.string().optional(),
  minRating: z.number().optional(),
  semanticQuery: z.string().optional(),
});

const outputSchema = HttpJsonSchema;

const plan = {
  pre: ['checkEnabled', 'parseRequest'],
  execute: ['handleRequest'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'skills-http:api': FlowRunOptions<
      SkillsApiFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills-http:api' as const;
const { Stage } = FlowHooksOf<'skills-http:api'>(name);

/**
 * Flow for serving skills via JSON API.
 *
 * Endpoints:
 * - GET /skills - List all skills
 * - GET /skills?query=X - Search skills
 * - GET /skills?tags=a,b - Filter by tags
 * - GET /skills/{id} - Get specific skill by ID/name
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public', // Will use endpoint-specific auth if configured
  middleware: {
    method: 'GET',
  },
})
export default class SkillsApiFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SkillsApiFlow');

  /**
   * Check if this flow should handle the request.
   * Matches GET requests to /skills or /skills/{id}.
   */
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    if (request.method !== 'GET') return false;

    const skillsConfig = scope.metadata.skillsConfig;
    if (!skillsConfig?.enabled) return false;

    const options = normalizeSkillsConfigOptions(skillsConfig);
    if (!options.normalizedApi.enabled) return false;

    const entryPrefix = normalizeEntryPrefix(scope.entryPath);
    const scopeBase = normalizeScopeBase(scope.routeBase);
    const basePath = `${entryPrefix}${scopeBase}`;
    const apiPath = options.normalizedApi.path ?? '/skills';

    const fullPath = `${basePath}${apiPath}`;
    const path = request.path;

    // Match /skills or /skills/{id}
    return path === apiPath || path.startsWith(`${apiPath}/`) || path === fullPath || path.startsWith(`${fullPath}/`);
  }

  @Stage('checkEnabled')
  async checkEnabled() {
    const skillsConfig = this.scope.metadata.skillsConfig;
    if (!skillsConfig?.enabled) {
      this.respond(
        httpRespond.json({ error: 'Not Found', message: 'Skills HTTP endpoints not enabled' }, { status: 404 }),
      );
      return;
    }

    const options = normalizeSkillsConfigOptions(skillsConfig);
    if (!options.normalizedApi.enabled) {
      this.respond(
        httpRespond.json({ error: 'Not Found', message: 'Skills API endpoint not enabled' }, { status: 404 }),
      );
      return;
    }

    // Validate auth if configured
    const authValidator = createSkillHttpAuthValidator(skillsConfig, this.logger);
    if (authValidator) {
      const { request } = this.rawInput;
      const authResult = await authValidator.validate({
        headers: request.headers as Record<string, string | string[] | undefined>,
      });

      if (!authResult.authorized) {
        this.respond(
          httpRespond.json(
            { error: 'Unauthorized', message: authResult.error ?? 'Authentication required' },
            { status: authResult.statusCode ?? 401 },
          ),
        );
        return;
      }
    }
  }

  @Stage('parseRequest')
  async parseRequest() {
    const { request } = this.rawInput;
    const skillsConfig = this.scope.metadata.skillsConfig;
    const options = normalizeSkillsConfigOptions(skillsConfig);

    const entryPrefix = normalizeEntryPrefix(this.scope.entryPath);
    const scopeBase = normalizeScopeBase(this.scope.routeBase);
    const basePath = `${entryPrefix}${scopeBase}`;
    const apiPath = options.normalizedApi.path ?? '/skills';
    const fullPath = `${basePath}${apiPath}`;

    // Extract skill ID from path if present
    let skillId: string | undefined;
    const path = request.path;

    if (path.startsWith(`${fullPath}/`)) {
      skillId = path.slice(fullPath.length + 1);
    } else if (path.startsWith(`${apiPath}/`)) {
      skillId = path.slice(apiPath.length + 1);
    }

    // Parse query parameters - handle arrays (take first element)
    const queryRaw = request.query?.['query'];
    const query = Array.isArray(queryRaw) ? queryRaw[0] : (queryRaw as string | undefined);

    // Normalize tags and tools arrays - handle both arrays and comma-separated strings
    const tagsParam = request.query?.['tags'];
    const tags = tagsParam
      ? Array.isArray(tagsParam)
        ? tagsParam.map((t) => String(t).trim()).filter(Boolean)
        : String(tagsParam)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
      : undefined;

    const toolsParam = request.query?.['tools'];
    const tools = toolsParam
      ? Array.isArray(toolsParam)
        ? toolsParam.map((t) => String(t).trim()).filter(Boolean)
        : String(toolsParam)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
      : undefined;

    // Parse limit/offset with validation - only accept valid numeric strings
    const limitRaw = request.query?.['limit'];
    const limitStr = Array.isArray(limitRaw) ? limitRaw[0] : limitRaw;
    const limit = limitStr && /^\d+$/.test(String(limitStr)) ? parseInt(String(limitStr), 10) : undefined;

    const offsetRaw = request.query?.['offset'];
    const offsetStr = Array.isArray(offsetRaw) ? offsetRaw[0] : offsetRaw;
    const offset = offsetStr && /^\d+$/.test(String(offsetStr)) ? parseInt(String(offsetStr), 10) : undefined;

    // category / min-rating / semantic-query — additive params; absence
    // keeps the legacy response byte-identical for existing clients.
    const categoryRaw = request.query?.['category'];
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : (categoryRaw as string | undefined);

    const minRatingRaw = request.query?.['min-rating'];
    const minRatingStr = Array.isArray(minRatingRaw) ? minRatingRaw[0] : minRatingRaw;
    const minRatingParsed =
      minRatingStr && /^\d+(\.\d+)?$/.test(String(minRatingStr))
        ? Math.max(0, Math.min(5, parseFloat(String(minRatingStr))))
        : undefined;

    const semanticRaw = request.query?.['semantic-query'];
    const semanticQuery = Array.isArray(semanticRaw) ? semanticRaw[0] : (semanticRaw as string | undefined);

    // Determine action
    let action: 'list' | 'search' | 'get';
    if (skillId) {
      action = 'get';
    } else if (query || semanticQuery) {
      action = 'search';
    } else {
      action = 'list';
    }

    this.state.set({
      action,
      skillId,
      query,
      tags,
      tools,
      limit,
      offset,
      category,
      minRating: minRatingParsed,
      semanticQuery,
    });
  }

  @Stage('handleRequest')
  async handleRequest() {
    const state = this.state.snapshot();
    const { action, skillId, query, tags, tools, limit, offset, category, minRating, semanticQuery } = state;
    const skillRegistry = this.scope.skills;
    const toolRegistry = this.scope.tools;

    if (!skillRegistry) {
      this.respond(
        httpRespond.json(
          { error: 'Skills not configured', message: 'No skill registry available on this server' },
          { status: 500 },
        ),
      );
      return;
    }

    switch (action) {
      case 'get':
        if (!skillId) {
          this.respond(
            httpRespond.json({ error: 'Bad Request', message: 'Missing skillId parameter' }, { status: 400 }),
          );
          return;
        }
        await this.handleGetSkill(skillId, skillRegistry, toolRegistry);
        break;
      case 'search':
        if (!query && !semanticQuery) {
          this.respond(httpRespond.json({ error: 'Bad Request', message: 'Missing query parameter' }, { status: 400 }));
          return;
        }
        await this.handleSearchSkills(
          query ?? semanticQuery!,
          { tags, tools, limit, category, minRating, semanticQuery },
          skillRegistry,
        );
        break;
      case 'list':
        await this.handleListSkills({ tags, tools, limit, offset, category, minRating }, skillRegistry);
        break;
    }
  }

  private async handleGetSkill(
    skillId: string,
    skillRegistry: SkillRegistryInterface,
    toolRegistry: ToolRegistry | null,
  ) {
    const loadResult = await skillRegistry.loadSkill(skillId);

    if (!loadResult) {
      this.respond(
        httpRespond.json({ error: 'Skill not found', message: `Skill "${skillId}" not found` }, { status: 404 }),
      );
      return;
    }

    const { skill, availableTools, missingTools, isComplete, warning } = loadResult;

    // Check visibility - look up by skill ID only for accurate matching
    const skillEntry = skillRegistry
      .getSkills(true)
      .find((s) => s.metadata.id === skill.id || (s.metadata.id === undefined && s.name === skill.id));
    if (skillEntry) {
      const visibility = skillEntry.metadata.visibility ?? 'both';
      if (visibility === 'mcp') {
        this.respond(
          httpRespond.json(
            { error: 'Skill not found', message: `Skill "${skillId}" not available via HTTP` },
            { status: 404 },
          ),
        );
        return;
      }
    }

    // Generate formatted content with tool schemas (use fallback if toolRegistry is null)
    const formattedContent = toolRegistry
      ? formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry)
      : formatSkillForLLM(skill, availableTools, missingTools);

    this.respond(
      httpRespond.json({
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          tools: skill.tools.map((t) => ({
            name: t.name,
            purpose: t.purpose,
            available: availableTools.includes(t.name),
          })),
          parameters: skill.parameters,
          examples: skill.examples,
        },
        availableTools,
        missingTools,
        isComplete,
        warning,
        formattedContent,
      }),
    );
  }

  private async handleSearchSkills(
    query: string,
    options: {
      tags?: string[];
      tools?: string[];
      limit?: number;
      category?: string;
      minRating?: number;
      semanticQuery?: string;
    },
    skillRegistry: SkillRegistryInterface,
  ) {
    const limit = options.limit ?? 10;
    let warning: { code: string; message: string } | undefined;
    let results: Array<{
      metadata: {
        id?: string;
        name: string;
        description: string;
        tags?: string[];
        tools?: unknown[];
        priority?: number;
        visibility?: string;
        rating?: number;
        category?: string;
      };
      score: number;
    }> = [];

    // Semantic search opt-in: when `semanticQuery` is set, look up the
    // optional provider via the DI container. Absent provider → fall back to
    // text search and surface a structured warning so clients can tell.
    if (options.semanticQuery) {
      const provider = this.tryGetSemanticProvider();
      if (provider) {
        const hits = await provider.search(options.semanticQuery, limit);
        const all = skillRegistry.getSkills(true);
        const requestedTags = options.tags;
        const requestedTools = options.tools;
        results = hits
          .map((h) => {
            const skill = all.find(
              (s) => s.metadata.id === h.skillId || (s.metadata.id === undefined && s.name === h.skillId),
            );
            return skill ? { metadata: skill.metadata, score: h.score } : undefined;
          })
          .filter((r): r is NonNullable<typeof r> => r !== undefined)
          .filter((r) => {
            // Mirror skillRegistry.search semantics: every requested tag must
            // be present, and at least one requested tool must be exposed.
            if (requestedTags?.length) {
              const tags = r.metadata.tags ?? [];
              if (!requestedTags.every((t) => tags.includes(t))) return false;
            }
            if (requestedTools?.length) {
              const refSet = new Set(extractToolNames(r.metadata));
              if (!requestedTools.some((t) => refSet.has(t))) return false;
            }
            return true;
          });
      } else {
        warning = {
          code: 'semantic-fallback',
          message: 'No SkillSemanticSearchProvider registered; falling back to text search.',
        };
        results = await skillRegistry.search(query, {
          topK: limit,
          tags: options.tags,
          tools: options.tools,
        });
      }
    } else {
      results = await skillRegistry.search(query, {
        topK: limit,
        tags: options.tags,
        tools: options.tools,
      });
    }

    // Filter by HTTP visibility
    let filteredResults = results.filter((r) => {
      const visibility = r.metadata.visibility ?? 'both';
      return visibility !== 'mcp';
    });

    // Optional new filters — additive, no-op when absent.
    if (options.category) {
      filteredResults = filteredResults.filter((r) => r.metadata.category === options.category);
    }
    if (options.minRating !== undefined) {
      filteredResults = filteredResults.filter((r) => (r.metadata.rating ?? 0) >= options.minRating!);
    }

    const headers = warning ? { Warning: '199 - "semantic-fallback"' } : undefined;
    this.respond(
      httpRespond.json(
        {
          skills: filteredResults.map((r) => ({
            id: r.metadata.id ?? r.metadata.name,
            name: r.metadata.name,
            description: r.metadata.description,
            score: r.score,
            tags: r.metadata.tags ?? [],
            tools: (r.metadata.tools ?? []).map((t) => (typeof t === 'string' ? t : (t as { name: string }).name)),
            priority: r.metadata.priority ?? 0,
            visibility: r.metadata.visibility ?? 'both',
            ...(r.metadata.rating !== undefined && { rating: r.metadata.rating }),
            ...(r.metadata.category && { category: r.metadata.category }),
          })),
          total: filteredResults.length,
          ...(warning && { warning }),
        },
        headers ? { headers } : undefined,
      ),
    );
  }

  /**
   * Lazily resolve the optional semantic-search provider. Wrapped in a
   * helper so the flow stays a single-class file and tests can stub the
   * provider via the scope DI container.
   */
  private tryGetSemanticProvider():
    | { search(q: string, limit: number): Promise<{ skillId: string; score: number }[]> }
    | undefined {
    try {
      // Late require to avoid a top-of-file circular when this file is the
      // first one importing semantic/.
      const { SkillSemanticSearchToken } = require('../../semantic/skill-semantic-search.interface');
      const providers = this.scope.providers as {
        tryGet?: <T>(t: unknown) => T | undefined;
        get?: <T>(t: unknown) => T;
      };
      if (typeof providers.tryGet === 'function') {
        return providers.tryGet(SkillSemanticSearchToken);
      }
      if (typeof providers.get === 'function') {
        try {
          return providers.get(SkillSemanticSearchToken);
        } catch (e) {
          // Fall back to text-search but leave a breadcrumb at debug level so
          // a misconfigured provider (e.g. constructor throws) is diagnosable
          // rather than silently masquerading as "no provider registered".
          this.logger.debug?.(
            `tryGetSemanticProvider: providers.get(SkillSemanticSearchToken) threw: ${(e as Error).message}`,
          );
          return undefined;
        }
      }
      return undefined;
    } catch (e) {
      this.logger.debug?.(
        `tryGetSemanticProvider: failed to resolve SkillSemanticSearchToken: ${(e as Error).message}`,
      );
      return undefined;
    }
  }

  private async handleListSkills(
    options: {
      tags?: string[];
      tools?: string[];
      limit?: number;
      offset?: number;
      category?: string;
      minRating?: number;
    },
    skillRegistry: SkillRegistryInterface,
  ) {
    // Get skills visible via HTTP
    const allSkills = skillRegistry.getSkills({ includeHidden: false, visibility: 'http' });

    // Apply tag filter if specified
    let filteredSkills = allSkills;
    if (options.tags && options.tags.length > 0) {
      filteredSkills = filteredSkills.filter((s) => {
        const skillTags = s.metadata.tags ?? [];
        return options.tags!.some((t) => skillTags.includes(t));
      });
    }

    // Apply tool filter if specified
    if (options.tools && options.tools.length > 0) {
      filteredSkills = filteredSkills.filter((s) => {
        const skillTools = (s.metadata.tools ?? []).map((t) =>
          typeof t === 'string' ? t : (t as { name: string }).name,
        );
        return options.tools!.some((t) => skillTools.includes(t));
      });
    }

    // Optional category / min-rating filters — additive, no-op when absent.
    if (options.category) {
      filteredSkills = filteredSkills.filter((s) => s.metadata.category === options.category);
    }
    if (options.minRating !== undefined) {
      filteredSkills = filteredSkills.filter((s) => (s.metadata.rating ?? 0) >= options.minRating!);
    }

    // Apply pagination
    const total = filteredSkills.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const paginatedSkills = filteredSkills.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    this.respond(
      httpRespond.json({
        skills: paginatedSkills.map((s) => skillToApiResponse(s)),
        total,
        hasMore,
        offset,
        limit,
      }),
    );
  }
}
