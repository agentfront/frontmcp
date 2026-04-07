/**
 * Authorities Enforcement Plugin
 *
 * Built-in plugin that enforces `authorities` metadata on all entry types.
 * Hooks into tool/resource/prompt flows to check RBAC/ABAC/ReBAC policies.
 *
 * @example
 * ```typescript
 * import { AuthoritiesPlugin } from '@frontmcp/sdk';
 *
 * @FrontMcp({
 *   plugins: [
 *     AuthoritiesPlugin.init({
 *       claimsMapping: { roles: 'realm_access.roles' },
 *       profiles: { admin: { roles: { any: ['admin'] } } },
 *     }),
 *   ],
 * })
 * ```
 */

import {
  AuthoritiesEngine,
  AuthoritiesContextBuilder,
  AuthoritiesProfileRegistry,
  AuthoritiesEvaluatorRegistry,
  AuthorityDeniedError,
} from '@frontmcp/auth';
import type { AuthoritiesMetadata } from '@frontmcp/auth';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { Plugin } from '../../common/decorators/plugin.decorator';
import { FlowHooksOf } from '../../common/decorators/hook.decorator';
import type { AuthoritiesPluginOptions } from './authorities.plugin.options';

const ToolCallHook = FlowHooksOf('tools:call-tool');
const ListToolsHook = FlowHooksOf('tools:list-tools');
const ResourceReadHook = FlowHooksOf('resources:read-resource');
const ListResourcesHook = FlowHooksOf('resources:list-resources');
const PromptGetHook = FlowHooksOf('prompts:get-prompt');
const ListPromptsHook = FlowHooksOf('prompts:list-prompts');

/**
 * Safely extract the `authorities` field from entry metadata.
 * Uses bracket notation to access the extended metadata field.
 */
function getAuthorities(metadata: unknown): AuthoritiesMetadata | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (metadata as Record<string, unknown>)['authorities'] as AuthoritiesMetadata | undefined;
}

@Plugin({
  name: 'authorities',
  description: 'Built-in RBAC/ABAC/ReBAC enforcement for entry metadata',
})
export default class AuthoritiesPlugin extends DynamicPlugin<AuthoritiesPluginOptions> {
  private readonly engine: AuthoritiesEngine;
  private readonly contextBuilder: AuthoritiesContextBuilder;

  constructor(options: AuthoritiesPluginOptions = {}) {
    super();

    // Set up profile registry
    const profileRegistry = new AuthoritiesProfileRegistry();
    if (options.profiles) {
      profileRegistry.registerAll(options.profiles);
    }

    // Set up custom evaluator registry
    const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
    if (options.evaluators) {
      evaluatorRegistry.registerAll(options.evaluators);
    }

    this.engine = new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
    this.contextBuilder = new AuthoritiesContextBuilder({
      claimsMapping: options.claimsMapping,
      claimsResolver: options.claimsResolver,
      relationshipResolver: options.relationshipResolver,
    });
  }

  // ============================================
  // Tool Hooks
  // ============================================

  @ToolCallHook.Will('checkToolAuthorization', { priority: 1000 })
  async enforceToolAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const tool = state?.['tool'] as Record<string, unknown> | undefined;
    if (!tool) return;

    const authorities = getAuthorities(tool['metadata']);
    if (!authorities) return;

    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;
    const params = rawInput?.['params'] as Record<string, unknown> | undefined;
    const input = (params?.['arguments'] ?? {}) as Record<string, unknown>;

    const evalCtx = this.contextBuilder.build(authInfo, input);
    const result = await this.engine.evaluate(authorities, evalCtx);

    if (!result.granted) {
      throw new AuthorityDeniedError({
        entryType: 'Tool',
        entryName: (tool['fullName'] as string) ?? (tool['name'] as string) ?? 'unknown',
        deniedBy: result.deniedBy ?? 'policy denied',
      });
    }
  }

  @ListToolsHook.Did('findTools')
  async filterToolsByAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const stateReq = state?.['required'] as Record<string, unknown> | undefined;
    const tools = (stateReq?.['tools'] ?? []) as Array<Record<string, unknown>>;
    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const filtered = await this.filterByAuthorities(tools, 'tool', authInfo);

    const setState = state?.['set'] as ((key: string, value: unknown) => void) | undefined;
    if (setState) setState('tools', filtered);
  }

  // ============================================
  // Resource Hooks
  // ============================================

  @ResourceReadHook.Will('execute', { priority: 1000 })
  async enforceResourceAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const resource = state?.['resource'] as Record<string, unknown> | undefined;
    if (!resource) return;

    const authorities = getAuthorities(resource['metadata']);
    if (!authorities) return;

    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const evalCtx = this.contextBuilder.build(authInfo);
    const result = await this.engine.evaluate(authorities, evalCtx);

    if (!result.granted) {
      throw new AuthorityDeniedError({
        entryType: 'Resource',
        entryName: (resource['fullName'] as string) ?? (resource['name'] as string) ?? 'unknown',
        deniedBy: result.deniedBy ?? 'policy denied',
      });
    }
  }

  @ListResourcesHook.Did('findResources')
  async filterResourcesByAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const stateReq = state?.['required'] as Record<string, unknown> | undefined;
    const resources = (stateReq?.['resources'] ?? []) as Array<Record<string, unknown>>;
    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const filtered = await this.filterByAuthorities(resources, 'resource', authInfo);

    const setState = state?.['set'] as ((key: string, value: unknown) => void) | undefined;
    if (setState) setState('resources', filtered);
  }

  // ============================================
  // Prompt Hooks
  // ============================================

  @PromptGetHook.Will('execute', { priority: 1000 })
  async enforcePromptAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const prompt = state?.['prompt'] as Record<string, unknown> | undefined;
    if (!prompt) return;

    const authorities = getAuthorities(prompt['metadata']);
    if (!authorities) return;

    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const evalCtx = this.contextBuilder.build(authInfo);
    const result = await this.engine.evaluate(authorities, evalCtx);

    if (!result.granted) {
      throw new AuthorityDeniedError({
        entryType: 'Prompt',
        entryName: (prompt['fullName'] as string) ?? (prompt['name'] as string) ?? 'unknown',
        deniedBy: result.deniedBy ?? 'policy denied',
      });
    }
  }

  @ListPromptsHook.Did('findPrompts')
  async filterPromptsByAuthorities(flowCtx: Record<string, unknown>): Promise<void> {
    const state = flowCtx['state'] as Record<string, unknown> | undefined;
    const stateReq = state?.['required'] as Record<string, unknown> | undefined;
    const prompts = (stateReq?.['prompts'] ?? []) as Array<Record<string, unknown>>;
    const rawInput = flowCtx['rawInput'] as Record<string, unknown> | undefined;
    const ctx = rawInput?.['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const filtered = await this.filterByAuthorities(prompts, 'prompt', authInfo);

    const setState = state?.['set'] as ((key: string, value: unknown) => void) | undefined;
    if (setState) setState('prompts', filtered);
  }

  // ============================================
  // Shared Filtering Helper
  // ============================================

  private async filterByAuthorities(
    entries: Array<Record<string, unknown>>,
    entryKey: string,
    authInfo: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const results = await Promise.all(
      entries.map(async (item) => {
        const entry = item[entryKey] as Record<string, unknown> | undefined;
        const authorities = getAuthorities(entry?.['metadata']);
        if (!authorities) return item;

        const evalCtx = this.contextBuilder.build(authInfo);
        const result = await this.engine.evaluate(authorities, evalCtx);
        return result.granted ? item : null;
      }),
    );

    return results.filter((item): item is Record<string, unknown> => item !== null);
  }
}
