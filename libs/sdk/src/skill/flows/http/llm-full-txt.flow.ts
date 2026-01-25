// file: libs/sdk/src/skill/flows/http/llm-full-txt.flow.ts

/**
 * HTTP flow for GET /llm_full.txt endpoint.
 * Returns full skill content with instructions and tool schemas.
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
import { formatSkillsForLlmFull } from '../../skill-http.utils';
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
    'skills-http:llm-full-txt': FlowRunOptions<
      LlmFullTxtFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills-http:llm-full-txt' as const;
const { Stage } = FlowHooksOf<'skills-http:llm-full-txt'>(name);

/**
 * Flow for serving full skill content at /llm_full.txt.
 *
 * This endpoint provides complete skill information including:
 * - Full instructions
 * - Complete tool schemas (input/output)
 * - Parameters
 * - Examples
 *
 * Useful for multi-agent architectures where planner agents need
 * comprehensive skill information to create execution plans.
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
export default class LlmFullTxtFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('LlmFullTxtFlow');

  /**
   * Check if this flow should handle the request.
   * Matches GET requests to /llm_full.txt or configured path.
   */
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    if (request.method !== 'GET') return false;

    const skillsConfig = scope.metadata.skillsConfig;
    if (!skillsConfig?.enabled) return false;

    const options = normalizeSkillsConfigOptions(skillsConfig);
    if (!options.normalizedLlmFullTxt.enabled) return false;

    const entryPrefix = normalizeEntryPrefix(scope.entryPath);
    const scopeBase = normalizeScopeBase(scope.routeBase);
    const basePath = `${entryPrefix}${scopeBase}`;
    const endpointPath = options.normalizedLlmFullTxt.path ?? '/llm_full.txt';

    // Support both /llm_full.txt and {basePath}/llm_full.txt
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
    if (!options.normalizedLlmFullTxt.enabled) {
      this.respond(httpRespond.notFound('llm_full.txt endpoint not enabled'));
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
    const toolRegistry = this.scope.tools;

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
      const cached = await cache.getLlmFullTxt();
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

    // Generate full content with tool schemas
    const content = await formatSkillsForLlmFull(skillRegistry, toolRegistry, 'http');

    if (!content || content.trim() === '') {
      this.respond({
        kind: 'text',
        status: 200,
        body: '# No skills available\n\nNo skills are visible via HTTP on this server.',
        contentType: 'text/plain; charset=utf-8',
      });
      return;
    }

    // Store in cache
    if (cache) {
      await cache.setLlmFullTxt(content);
    }

    this.respond({
      kind: 'text',
      status: 200,
      body: content,
      contentType: 'text/plain; charset=utf-8',
    });
  }
}
