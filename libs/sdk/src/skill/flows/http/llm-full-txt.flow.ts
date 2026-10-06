// file: libs/sdk/src/skill/flows/http/llm-full-txt.flow.ts

/**
 * HTTP flow for GET /llm_full.txt endpoint.
 * Returns full skill content with instructions and tool schemas.
 */

import { z } from '@frontmcp/lazy-zod';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  httpRespond,
  HttpTextSchema,
  normalizeEntryPrefix,
  normalizeScopeBase,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../../common';
import { normalizeSkillsConfigOptions } from '../../../common/types/options/skills-http';
import { authorizeSkillHttpRequest } from '../../auth';
import { getSkillHttpCache } from '../../cache';
import { filterSkillsByAuthorities } from '../../skill-authorities.helper';
import { filterServableSkills, SKILLS_HTTP_SURFACE } from '../../skill-filter.helper';
import { formatSkillsForLlmFull } from '../../skill-http.utils';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  prefix: z.string(),
  /** The caller skill `authorities` are evaluated against. */
  authInfo: z.record(z.string(), z.unknown()),
});

const outputSchema = HttpTextSchema;

const plan = {
  pre: ['checkIpFilter', 'acquireQuota', 'checkEnabled'],
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

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
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

    const access = await authorizeSkillHttpRequest(this.scope, skillsConfig, this.rawInput.request, this.logger);
    if (!access.allowed) {
      this.respond({
        kind: 'text',
        status: access.status,
        body: access.error,
        contentType: 'text/plain; charset=utf-8',
        ...(access.headers ? { headers: access.headers } : {}),
      });
      return;
    }

    this.state.set({ prefix: options.prefix ?? '', authInfo: access.authInfo });
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

    // Leave out the skills the caller's authorities don't admit. The cached document lists every
    // skill, so it is only served to a caller the authorities and the `skills:filter` flow let see all of them.
    const allSkills = skillRegistry.getSkills(false);
    const skills = await filterServableSkills(
      this.scope,
      await filterSkillsByAuthorities(this.scope, allSkills, this.state.required.authInfo),
      undefined,
      SKILLS_HTTP_SURFACE,
    );
    const cache = skills.length === allSkills.length ? await getSkillHttpCache(this.scope) : undefined;
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
    const content = await formatSkillsForLlmFull(skillRegistry, toolRegistry, 'http', skills);

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
