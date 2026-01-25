// file: libs/sdk/src/skill/flows/http/skills-api.flow.ts

/**
 * HTTP flow for GET /skills/* API endpoints.
 * Provides JSON API for listing, searching, and loading skills.
 */

import {
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  ScopeEntry,
  ServerRequest,
  FlowHooksOf,
  normalizeEntryPrefix,
  normalizeScopeBase,
} from '../../../common';
import { z } from 'zod';
import { skillToApiResponse, formatSkillForLLMWithSchemas } from '../../skill-http.utils';
import { normalizeSkillsConfigOptions } from '../../../common/types/options/skills-http';
import { createSkillHttpAuthValidator } from '../../auth';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  action: z.enum(['list', 'search', 'get']),
  skillId: z.string().optional(),
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
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

    // Parse query parameters
    const query = request.query?.['query'] as string | undefined;
    const tagsParam = request.query?.['tags'] as string | string[] | undefined;
    const toolsParam = request.query?.['tools'] as string | string[] | undefined;
    const limitParam = request.query?.['limit'] as string | undefined;
    const offsetParam = request.query?.['offset'] as string | undefined;

    // Normalize tags and tools arrays
    const tags = tagsParam ? (Array.isArray(tagsParam) ? tagsParam : tagsParam.split(',')) : undefined;
    const tools = toolsParam ? (Array.isArray(toolsParam) ? toolsParam : toolsParam.split(',')) : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

    // Determine action
    let action: 'list' | 'search' | 'get';
    if (skillId) {
      action = 'get';
    } else if (query) {
      action = 'search';
    } else {
      action = 'list';
    }

    this.state.set({ action, skillId, query, tags, tools, limit, offset });
  }

  @Stage('handleRequest')
  async handleRequest() {
    const state = this.state.snapshot();
    const { action, skillId, query, tags, tools, limit, offset } = state;
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
        await this.handleGetSkill(skillId!, skillRegistry, toolRegistry);
        break;
      case 'search':
        await this.handleSearchSkills(query!, { tags, tools, limit }, skillRegistry);
        break;
      case 'list':
        await this.handleListSkills({ tags, tools, limit, offset }, skillRegistry);
        break;
    }
  }

  private async handleGetSkill(skillId: string, skillRegistry: any, toolRegistry: any) {
    const loadResult = await skillRegistry.loadSkill(skillId);

    if (!loadResult) {
      this.respond(
        httpRespond.json({ error: 'Skill not found', message: `Skill "${skillId}" not found` }, { status: 404 }),
      );
      return;
    }

    const { skill, availableTools, missingTools, isComplete, warning } = loadResult;

    // Check visibility
    const skillEntry = skillRegistry
      .getSkills(true)
      .find((s: any) => s.name === skill.name || s.metadata.id === skill.id);
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

    // Generate formatted content with tool schemas
    const formattedContent = formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry);

    this.respond(
      httpRespond.json({
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          tools: skill.tools.map((t: any) => ({
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
    options: { tags?: string[]; tools?: string[]; limit?: number },
    skillRegistry: any,
  ) {
    const results = await skillRegistry.search(query, {
      topK: options.limit ?? 10,
      tags: options.tags,
      tools: options.tools,
    });

    // Filter by HTTP visibility
    const filteredResults = results.filter((r: any) => {
      const visibility = r.metadata.visibility ?? 'both';
      return visibility !== 'mcp';
    });

    this.respond(
      httpRespond.json({
        skills: filteredResults.map((r: any) => ({
          id: r.metadata.id ?? r.metadata.name,
          name: r.metadata.name,
          description: r.metadata.description,
          score: r.score,
          tags: r.metadata.tags ?? [],
          tools: (r.metadata.tools ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
          priority: r.metadata.priority ?? 0,
          visibility: r.metadata.visibility ?? 'both',
        })),
        total: filteredResults.length,
      }),
    );
  }

  private async handleListSkills(
    options: { tags?: string[]; tools?: string[]; limit?: number; offset?: number },
    skillRegistry: any,
  ) {
    // Get skills visible via HTTP
    const allSkills = skillRegistry.getSkills({ includeHidden: false, visibility: 'http' });

    // Apply tag filter if specified
    let filteredSkills = allSkills;
    if (options.tags && options.tags.length > 0) {
      filteredSkills = filteredSkills.filter((s: any) => {
        const skillTags = s.metadata.tags ?? [];
        return options.tags!.some((t) => skillTags.includes(t));
      });
    }

    // Apply tool filter if specified
    if (options.tools && options.tools.length > 0) {
      filteredSkills = filteredSkills.filter((s: any) => {
        const skillTools = (s.metadata.tools ?? []).map((t: any) => (typeof t === 'string' ? t : t.name));
        return options.tools!.some((t) => skillTools.includes(t));
      });
    }

    // Apply pagination
    const total = filteredSkills.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const paginatedSkills = filteredSkills.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    this.respond(
      httpRespond.json({
        skills: paginatedSkills.map((s: any) => skillToApiResponse(s)),
        total,
        hasMore,
        offset,
        limit,
      }),
    );
  }
}
