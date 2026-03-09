import {
  DynamicPlugin,
  FlowCtxOf,
  FlowHooksOf,
  FRONTMCP_CONTEXT,
  ListToolsHook,
  ListResourcesHook,
  Plugin,
  ProviderScope,
  ProviderType,
  ToolHook,
} from '@frontmcp/sdk';

import type { FeatureFlagPluginOptions, FeatureFlagPluginOptionsInput, FeatureFlagRef } from './feature-flag.types';
import { FeatureFlagAdapterToken, FeatureFlagConfigToken, FeatureFlagAccessorToken } from './feature-flag.symbols';
import { StaticFeatureFlagAdapter } from './adapters/static.adapter';
import { createFeatureFlagAccessor } from './providers/feature-flag-accessor.provider';
import type { FeatureFlagAdapter } from './adapters/feature-flag-adapter.interface';

// Local hook references for prompts and skills flows.
// These flows register their ExtendFlows types in their own modules, which are not
// re-exported from the SDK barrel. We cast to bypass the type constraint at compile time.
const ListPromptsHook = (FlowHooksOf as any)('prompts:list-prompts');
const SearchSkillsHook = (FlowHooksOf as any)('skills:search');

/**
 * FeatureFlagPlugin - Dynamic capability gating for FrontMCP.
 *
 * Filters tools, resources, prompts, and skills based on feature flag evaluation.
 * Supports static flags, Split.io, LaunchDarkly, Unleash, and custom adapters.
 *
 * @example
 * ```typescript
 * @FrontMcp({
 *   plugins: [
 *     FeatureFlagPlugin.init({
 *       adapter: 'static',
 *       flags: { 'beta-tools': true, 'experimental-agent': false },
 *     }),
 *   ],
 * })
 * class MyServer {}
 * ```
 */
@Plugin({
  name: 'feature-flags',
  description: 'Feature flag-based capability filtering for MCP',
  providers: [],
  contextExtensions: [
    {
      property: 'featureFlags',
      token: FeatureFlagAccessorToken,
      errorMessage: 'FeatureFlagPlugin is not installed. Add FeatureFlagPlugin.init() to your plugins array.',
    },
  ],
})
export default class FeatureFlagPlugin extends DynamicPlugin<FeatureFlagPluginOptions, FeatureFlagPluginOptionsInput> {
  options: FeatureFlagPluginOptions;

  constructor(options: FeatureFlagPluginOptionsInput) {
    super();
    this.options = options;
  }

  /**
   * Dynamic providers based on plugin options.
   */
  static override dynamicProviders = (options: FeatureFlagPluginOptionsInput): ProviderType[] => {
    const providers: ProviderType[] = [];

    // ─────────────────────────────────────────────────────────────────────
    // Adapter Provider
    // ─────────────────────────────────────────────────────────────────────

    switch (options.adapter) {
      case 'static':
        providers.push({
          name: 'feature-flags:adapter:static',
          provide: FeatureFlagAdapterToken,
          useValue: new StaticFeatureFlagAdapter(options.flags),
        });
        break;

      case 'splitio':
        providers.push({
          name: 'feature-flags:adapter:splitio',
          provide: FeatureFlagAdapterToken,
          inject: () => [] as const,
          useFactory: async () => {
            const { SplitioFeatureFlagAdapter } = require('./adapters/splitio.adapter');
            const adapter = new SplitioFeatureFlagAdapter(options.config);
            await adapter.initialize();
            return adapter;
          },
        });
        break;

      case 'launchdarkly':
        providers.push({
          name: 'feature-flags:adapter:launchdarkly',
          provide: FeatureFlagAdapterToken,
          inject: () => [] as const,
          useFactory: async () => {
            const { LaunchDarklyFeatureFlagAdapter } = require('./adapters/launchdarkly.adapter');
            const adapter = new LaunchDarklyFeatureFlagAdapter(options.config);
            await adapter.initialize();
            return adapter;
          },
        });
        break;

      case 'unleash':
        providers.push({
          name: 'feature-flags:adapter:unleash',
          provide: FeatureFlagAdapterToken,
          inject: () => [] as const,
          useFactory: async () => {
            const { UnleashFeatureFlagAdapter } = require('./adapters/unleash.adapter');
            const adapter = new UnleashFeatureFlagAdapter(options.config);
            await adapter.initialize();
            return adapter;
          },
        });
        break;

      case 'custom':
        providers.push({
          name: 'feature-flags:adapter:custom',
          provide: FeatureFlagAdapterToken,
          useValue: options.adapterInstance,
        });
        break;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Config Provider
    // ─────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'feature-flags:config',
      provide: FeatureFlagConfigToken,
      useValue: options,
    });

    // ─────────────────────────────────────────────────────────────────────
    // FeatureFlagAccessor (Context-scoped)
    // ─────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'feature-flags:accessor',
      provide: FeatureFlagAccessorToken,
      scope: ProviderScope.CONTEXT,
      inject: () => [FeatureFlagAdapterToken, FRONTMCP_CONTEXT, FeatureFlagConfigToken] as const,
      useFactory: (adapter, ctx, cfg) => createFeatureFlagAccessor(adapter, ctx, cfg),
    });

    return providers;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Hooks for Capability Filtering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Filter tools from list_tools based on feature flags.
   * Runs after findTools but before resolveConflicts for fewer conflicts.
   */
  @ListToolsHook.Did('findTools', { priority: 50 })
  async filterListTools(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    const { tools } = flowCtx.state;
    if (!tools || tools.length === 0) return;

    const flaggedTools = this.collectFlagRefs(tools, (item) => (item.tool.metadata as any)?.featureFlag);
    if (flaggedTools.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedTools);

    const filtered = tools.filter((item) => {
      const ref = (item.tool.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('tools', filtered);
  }

  /**
   * Filter resources from list_resources based on feature flags.
   */
  @ListResourcesHook.Did('findResources', { priority: 50 })
  async filterListResources(flowCtx: FlowCtxOf<'resources:list-resources'>) {
    const { resources } = flowCtx.state;
    if (!resources || resources.length === 0) return;

    const flaggedResources = this.collectFlagRefs(resources, (item) => (item.resource.metadata as any)?.featureFlag);
    if (flaggedResources.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedResources);

    const filtered = resources.filter((item) => {
      const ref = (item.resource.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('resources', filtered);
  }

  /**
   * Filter prompts from list_prompts based on feature flags.
   */
  @ListPromptsHook.Did('findPrompts', { priority: 50 })
  async filterListPrompts(flowCtx: any) {
    const { prompts } = flowCtx.state;
    if (!prompts || prompts.length === 0) return;

    const flaggedPrompts = this.collectFlagRefs(prompts, (item: any) => (item.prompt.metadata as any)?.featureFlag);
    if (flaggedPrompts.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedPrompts);

    const filtered = prompts.filter((item: any) => {
      const ref = (item.prompt.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('prompts', filtered);
  }

  /**
   * Filter skills from skills:search based on feature flags.
   * Hooks after search stage, before finalize converts to output.
   */
  @SearchSkillsHook.Did('search', { priority: 50 })
  async filterSearchSkills(flowCtx: any) {
    const { results } = flowCtx.state;
    if (!results || results.length === 0) return;

    const flaggedSkills = this.collectFlagRefs(results, (item: any) => item.metadata?.featureFlag);
    if (flaggedSkills.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedSkills);

    const filtered = results.filter((item: any) => {
      const ref = item.metadata?.featureFlag as FeatureFlagRef | undefined;
      if (!ref) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('results', filtered);
  }

  /**
   * Execution gate: block direct tool/call when the tool's feature flag is off.
   * This prevents bypassing the list filter via direct tool invocation.
   */
  @ToolHook.Will('execute', { priority: 50 })
  async gateToolExecution(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (!tool) return;

    const ref = (tool.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
    if (!ref) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const key = typeof ref === 'string' ? ref : ref.key;
    const defaultValue = typeof ref === 'object' ? (ref.defaultValue ?? false) : false;

    let enabled: boolean;
    try {
      enabled = await adapter.isEnabled(key, {});
    } catch {
      enabled = defaultValue;
    }

    if (!enabled) {
      throw new Error(`Tool "${tool.metadata.name}" is disabled by feature flag "${key}"`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Collect unique flag keys from items that have a featureFlag metadata.
   */
  private collectFlagRefs<T>(items: T[], getRef: (item: T) => FeatureFlagRef | undefined): Map<string, FeatureFlagRef> {
    const refs = new Map<string, FeatureFlagRef>();
    for (const item of items) {
      const ref = getRef(item);
      if (ref) {
        const key = typeof ref === 'string' ? ref : ref.key;
        if (!refs.has(key)) {
          refs.set(key, ref);
        }
      }
    }
    return refs;
  }

  /**
   * Batch evaluate all collected flag refs via the adapter.
   */
  private async batchEvaluateRefs(
    adapter: FeatureFlagAdapter,
    refs: Map<string, FeatureFlagRef>,
  ): Promise<Map<string, boolean>> {
    const keys = Array.from(refs.keys());
    return adapter.evaluateFlags(keys, {});
  }

  /**
   * Determine if a feature flag ref is enabled given adapter results.
   * For object-style refs, `defaultValue` acts as a fallback when the adapter
   * returns false (i.e., the flag is unknown to the adapter).
   */
  private isRefEnabled(ref: FeatureFlagRef, flagResults: Map<string, boolean>): boolean {
    const key = typeof ref === 'string' ? ref : ref.key;
    const adapterResult = flagResults.get(key);
    const defaultValue = typeof ref === 'object' ? (ref.defaultValue ?? false) : false;
    if (adapterResult === true) return true;
    return defaultValue;
  }
}
