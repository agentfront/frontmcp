// file: libs/sdk/src/skill/flows/http/llm-txt.flow.ts

/**
 * HTTP flow for GET /llm.txt endpoint.
 * Returns compact skill summaries in plain text format.
 */

import {
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpTextSchema,
  httpRespond,
  ScopeEntry,
  ServerRequest,
  FlowHooksOf,
  normalizeEntryPrefix,
  normalizeScopeBase,
} from '../../../common';
import { z } from 'zod';
import { formatSkillsForLlmCompact } from '../../skill-http.utils';
import { normalizeSkillsConfigOptions } from '../../../common/types/options/skills-http';
import { createSkillHttpAuthValidator } from '../../auth';
import { getSkillHttpCache } from '../../cache';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  prefix: z.string(),
});

const outputSchema = HttpTextSchema;

const plan = {
  pre: ['checkEnabled'],
  execute: ['generateContent'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'skills-http:llm-txt': FlowRunOptions<
      LlmTxtFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills-http:llm-txt' as const;
const { Stage } = FlowHooksOf<'skills-http:llm-txt'>(name);

/**
 * Flow for serving skill summaries at /llm.txt.
 *
 * This endpoint provides a compact, LLM-friendly summary of all available skills.
 * Each skill is listed with its name, description, tools, and tags.
 *
 * @example Response format
 * ```
 * # review-pr
 * Review a GitHub pull request
 * Tools: github_get_pr, github_add_comment
 * Tags: github, code-review
 *
 * ---
 *
 * # deploy-app
 * Deploy application to production
 * ```
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
export default class LlmTxtFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('LlmTxtFlow');

  /**
   * Check if this flow should handle the request.
   * Matches GET requests to /llm.txt or configured path.
   */
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    if (request.method !== 'GET') return false;

    const skillsConfig = scope.metadata.skillsConfig;
    if (!skillsConfig?.enabled) return false;

    const options = normalizeSkillsConfigOptions(skillsConfig);
    if (!options.normalizedLlmTxt.enabled) return false;

    const entryPrefix = normalizeEntryPrefix(scope.entryPath);
    const scopeBase = normalizeScopeBase(scope.routeBase);
    const basePath = `${entryPrefix}${scopeBase}`;
    const endpointPath = options.normalizedLlmTxt.path ?? '/llm.txt';

    // Support both /llm.txt and {basePath}/llm.txt
    const paths = new Set([endpointPath, `${basePath}${endpointPath}`]);

    return paths.has(request.path);
  }

  @Stage('checkEnabled')
  async checkEnabled() {
    const skillsConfig = this.scope.metadata.skillsConfig;
    if (!skillsConfig?.enabled) {
      this.respond(httpRespond.notFound('Skills HTTP endpoints not enabled'));
      return;
    }

    const options = normalizeSkillsConfigOptions(skillsConfig);
    if (!options.normalizedLlmTxt.enabled) {
      this.respond(httpRespond.notFound('llm.txt endpoint not enabled'));
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
        this.respond({
          kind: 'text',
          status: authResult.statusCode ?? 401,
          body: authResult.error ?? 'Unauthorized',
          contentType: 'text/plain; charset=utf-8',
        });
        return;
      }
    }

    this.state.set({ prefix: options.prefix ?? '' });
  }

  @Stage('generateContent')
  async generateContent() {
    const skillRegistry = this.scope.skills;

    if (!skillRegistry || !skillRegistry.hasAny()) {
      this.respond({
        kind: 'text',
        status: 200,
        body: '# No skills available\n\nNo skills have been registered on this server.',
        contentType: 'text/plain; charset=utf-8',
      });
      return;
    }

    // Check cache first
    const cache = await getSkillHttpCache(this.scope);
    if (cache) {
      const cached = await cache.getLlmTxt();
      if (cached) {
        this.respond({
          kind: 'text',
          status: 200,
          body: cached,
          contentType: 'text/plain; charset=utf-8',
        });
        return;
      }
    }

    // Get skills visible via HTTP
    const skills = skillRegistry.getSkills({ includeHidden: false, visibility: 'http' });

    if (skills.length === 0) {
      this.respond({
        kind: 'text',
        status: 200,
        body: '# No skills available\n\nNo skills are visible via HTTP on this server.',
        contentType: 'text/plain; charset=utf-8',
      });
      return;
    }

    const content = formatSkillsForLlmCompact(skills);

    // Store in cache
    if (cache) {
      await cache.setLlmTxt(content);
    }

    this.respond({
      kind: 'text',
      status: 200,
      body: content,
      contentType: 'text/plain; charset=utf-8',
    });
  }
}
