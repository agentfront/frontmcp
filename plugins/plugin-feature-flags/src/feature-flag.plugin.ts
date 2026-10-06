import {
  DynamicPlugin,
  FlowHooksOf,
  FRONTMCP_CONTEXT,
  FrontMcpContextStorage,
  isEntryGatedBy,
  ListResourcesHook,
  ListResourceTemplatesHook,
  ListToolsHook,
  Plugin,
  ProviderScope,
  ScopeEntry,
  ToolHook,
  type FlowCtxOf,
  type HookGatedEntry,
  type PromptEntry,
  type ProviderType,
} from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from './adapters/feature-flag-adapter.interface';
import { StaticFeatureFlagAdapter } from './adapters/static.adapter';
import { buildFeatureFlagContext } from './feature-flag.context';
import { FeatureFlagConfigurationError, FeatureFlagDisabledError } from './feature-flag.errors';
import { FeatureFlagAccessorToken, FeatureFlagAdapterToken, FeatureFlagConfigToken } from './feature-flag.symbols';
import type {
  FeatureFlagContext,
  FeatureFlagPluginOptions,
  FeatureFlagPluginOptionsInput,
  FeatureFlagRef,
} from './feature-flag.types';
import { createFeatureFlagAccessor } from './providers/feature-flag-accessor.provider';

// Local hook references for prompts, resource reads and completion flows.
// These flows register their ExtendFlows types in their own modules, which are not
// re-exported from the SDK barrel. We cast to bypass the type constraint at compile time.
const ListPromptsHook = (FlowHooksOf as any)('prompts:list-prompts');
const ReadResourceHook = (FlowHooksOf as any)('resources:read-resource');
const GetPromptHook = (FlowHooksOf as any)('prompts:get-prompt');
const CompleteHook = (FlowHooksOf as any)('completion:complete');

const FilterSkillsHook = FlowHooksOf('skills:filter');

const SUPPORTED_ADAPTERS: readonly string[] = ['static', 'splitio', 'launchdarkly', 'unleash', 'custom'];

/** The adapter methods the plugin and `this.featureFlags` call on every request. */
const REQUIRED_ADAPTER_METHODS = ['isEnabled', 'getVariant', 'evaluateFlags'] as const;

/**
 * `adapter: 'custom'` serves flags from `adapterInstance`. Without a usable one the server started
 * and answered every request with 500 (#678); it fails at `init()` (or, for `init({ useFactory })`,
 * at startup) instead, naming the option.
 */
function assertCustomAdapter(adapterInstance: unknown): asserts adapterInstance is FeatureFlagAdapter {
  let problem: string | undefined;
  if (typeof adapterInstance !== 'object' || adapterInstance === null) {
    problem = `got ${adapterInstance === undefined ? 'undefined' : JSON.stringify(adapterInstance)}`;
  } else {
    const instance = adapterInstance as Record<string, unknown>;
    const missing = REQUIRED_ADAPTER_METHODS.filter((method) => typeof instance[method] !== 'function');
    if (missing.length > 0) problem = `missing ${missing.map((m) => `${m}()`).join(', ')}`;
  }
  if (problem === undefined) return;

  throw new FeatureFlagConfigurationError(
    "FeatureFlagPlugin.init({ adapter: 'custom' }) requires an `adapterInstance` option: an object " +
      `implementing FeatureFlagAdapter (${REQUIRED_ADAPTER_METHODS.map((m) => `${m}()`).join(', ')}); ${problem}.`,
  );
}

/** An adapter whose `initialize()` and `destroy()` may be missing: `assertCustomAdapter` never required them. */
type AdapterWithOptionalLifecycle = Omit<FeatureFlagAdapter, 'initialize' | 'destroy'> &
  Partial<Pick<FeatureFlagAdapter, 'initialize' | 'destroy'>>;

/**
 * The adapter for one server: initialized before the server serves, destroyed when the server is
 * disposed (`dispose()` on what `create()` returns, or `Scope.dispose()`).
 */
function adapterProvider(kind: string, createAdapter: () => AdapterWithOptionalLifecycle): ProviderType {
  return {
    name: `feature-flags:adapter:${kind}`,
    provide: FeatureFlagAdapterToken,
    inject: () => [ScopeEntry] as const,
    useFactory: async (scope: ScopeEntry) => {
      const adapter = createAdapter();
      await adapter.initialize?.();
      scope.onDispose(async () => {
        await adapter.destroy?.();
      });
      return adapter;
    },
  };
}

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
  // A server where an entry declares `featureFlag` and none of these gates reaches it refuses to start.
  enforcesMetadata: ['featureFlag'],
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

    if (!SUPPORTED_ADAPTERS.includes(options?.adapter as string)) {
      throw new FeatureFlagConfigurationError(
        `FeatureFlagPlugin.init() requires an \`adapter\` option, got ${JSON.stringify(options?.adapter)}. ` +
          `Supported adapters: ${SUPPORTED_ADAPTERS.map((a) => `"${a}"`).join(', ')}.`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Adapter Provider
    // ─────────────────────────────────────────────────────────────────────

    switch (options.adapter) {
      case 'static':
        providers.push(adapterProvider('static', () => new StaticFeatureFlagAdapter(options.flags)));
        break;

      case 'splitio':
        providers.push(
          adapterProvider('splitio', () => {
            const { SplitioFeatureFlagAdapter } = require('./adapters/splitio.adapter');
            return new SplitioFeatureFlagAdapter(options.config);
          }),
        );
        break;

      case 'launchdarkly':
        providers.push(
          adapterProvider('launchdarkly', () => {
            const { LaunchDarklyFeatureFlagAdapter } = require('./adapters/launchdarkly.adapter');
            return new LaunchDarklyFeatureFlagAdapter(options.config);
          }),
        );
        break;

      case 'unleash':
        providers.push(
          adapterProvider('unleash', () => {
            const { UnleashFeatureFlagAdapter } = require('./adapters/unleash.adapter');
            return new UnleashFeatureFlagAdapter(options.config);
          }),
        );
        break;

      case 'custom': {
        const { adapterInstance } = options;
        assertCustomAdapter(adapterInstance);
        providers.push(adapterProvider('custom', () => adapterInstance));
        break;
      }
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

    // Only the tools this plugin's own gate judges, so a tool is listed and called on one answer.
    const judged = this.judgedItems(tools, (item) => ({ tool: item.tool }));
    const flaggedTools = this.collectFlagRefs(judged, (item) => item.tool.metadata.featureFlag);
    if (flaggedTools.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedTools);

    const filtered = tools.filter((item) => {
      const ref = (item.tool.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref || !judged.has(item)) return true;
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

    const judged = this.judgedItems(resources, (item) => ({ resource: item.resource }));
    const flaggedResources = this.collectFlagRefs(judged, (item) => item.resource.metadata.featureFlag);
    if (flaggedResources.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedResources);

    const filtered = resources.filter((item) => {
      const ref = (item.resource.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref || !judged.has(item)) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('resources', filtered);
  }

  /**
   * Filter resource templates from resources/templates/list based on feature flags.
   *
   * GHSA-gf7p-j3hr-h5h4: templates were listed even when their flag was off.
   */
  @ListResourceTemplatesHook.Did('findTemplates', { priority: 50 })
  async filterListResourceTemplates(flowCtx: FlowCtxOf<'resources:list-resource-templates'>) {
    const { templates } = flowCtx.state;
    if (!templates || templates.length === 0) return;

    const judged = this.judgedItems(templates, (item) => ({ resource: item.template }));
    const flaggedTemplates = this.collectFlagRefs(judged, (item) => item.template.metadata.featureFlag);
    if (flaggedTemplates.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedTemplates);

    const filtered = templates.filter((item) => {
      const ref = item.template.metadata.featureFlag;
      if (!ref || !judged.has(item)) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('templates', filtered);
  }

  /**
   * Filter prompts from list_prompts based on feature flags.
   */
  @ListPromptsHook.Did('findPrompts', { priority: 50 })
  async filterListPrompts(flowCtx: any) {
    const { prompts } = flowCtx.state;
    if (!prompts || prompts.length === 0) return;

    const judged = this.judgedItems(prompts as ReadonlyArray<{ prompt: PromptEntry }>, (item) => ({
      prompt: item.prompt,
    }));
    const flaggedPrompts = this.collectFlagRefs(judged, (item) => item.prompt.metadata.featureFlag);
    if (flaggedPrompts.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedPrompts);

    const filtered = prompts.filter((item: any) => {
      const ref = (item.prompt.metadata as any)?.featureFlag as FeatureFlagRef | undefined;
      if (!ref || !judged.has(item)) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('prompts', filtered);
  }

  /**
   * Filter skills in the `skills:filter` flow, which every skill surface runs: MCP
   * `skills/search`, `skills/list` and `skills/load`, SEP-2640 `skill://` resources, and the HTTP
   * `/skills`, `/llm.txt` and `/llm_full.txt` endpoints. A skill removed here is absent from
   * listings and not found when named.
   *
   * GHSA-gf7p-j3hr-h5h4: the only skill hook sat on `skills:search`, which the `skills/search`
   * handler never ran and whose results carry no `featureFlag`, so no skill surface was gated.
   */
  @FilterSkillsHook.Did('filterSkills', { priority: 50, appliesTo: 'uncovered-apps' })
  async filterSkills(flowCtx: FlowCtxOf<'skills:filter'>) {
    const { skills } = flowCtx.state;
    if (!skills || skills.length === 0) return;

    // This flow runs every plugin's hook for every skill, so each plugin judges the skills of the
    // app it covers: its own, and (`appliesTo: 'uncovered-apps'`) those of apps without the plugin.
    const judged = this.judgedItems(skills, (skill) => ({ skill }));
    const flaggedSkills = this.collectFlagRefs(judged, (skill) => skill.metadata.featureFlag);
    if (flaggedSkills.size === 0) return;

    const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
    const flagResults = await this.batchEvaluateRefs(adapter, flaggedSkills);

    const filtered = skills.filter((skill) => {
      const ref = skill.metadata.featureFlag;
      if (!ref || !judged.has(skill)) return true;
      return this.isRefEnabled(ref, flagResults);
    });

    flowCtx.state.set('skills', filtered);
  }

  /**
   * Execution gate: block direct tool/call when the tool's feature flag is off.
   * This prevents bypassing the list filter via direct tool invocation.
   */
  @ToolHook.Will('execute', { priority: 50, appliesTo: 'uncovered-apps' })
  async gateToolExecution(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    await this.gateEntryExecution('Tool', flowCtx.state.tool);
  }

  /**
   * Execution gate: block resources/read when the resource's feature flag is off.
   *
   * GHSA-gf7p-j3hr-h5h4: only tools had this gate, so a flagged resource was merely absent
   * from resources/list and still readable by URI. Hiding a capability from a listing is not
   * the same as withholding it — clients cache listings and hold URIs from earlier sessions.
   */
  @ReadResourceHook.Will('execute', { priority: 50, appliesTo: 'uncovered-apps' })
  async gateResourceRead(flowCtx: any) {
    await this.gateEntryExecution('Resource', flowCtx.state.resource);
  }

  /**
   * Execution gate: block prompts/get when the prompt's feature flag is off.
   *
   * The same gap as resources (GHSA-gf7p-j3hr-h5h4): filtering prompts/list left the prompt
   * retrievable by name.
   */
  @GetPromptHook.Will('execute', { priority: 50, appliesTo: 'uncovered-apps' })
  async gatePromptGet(flowCtx: any) {
    await this.gateEntryExecution('Prompt', flowCtx.state.prompt);
  }

  /**
   * Execution gate: block completion/complete for a prompt or resource whose feature flag is off.
   *
   * GHSA-gf7p-j3hr-h5h4: completion looked the entry up and ran its argument completers without
   * a gate, so a disabled resource template still suggested its values.
   */
  @CompleteHook.Will('complete', { priority: 50, appliesTo: 'uncovered-apps' })
  async gateCompletion(flowCtx: any) {
    const { prompt, resource } = flowCtx.state;
    if (prompt) await this.gateEntryExecution('Prompt', prompt);
    if (resource) await this.gateEntryExecution('Resource', resource);
  }

  /**
   * Shared execution gate for tools, resources and prompts.
   *
   * One implementation on purpose: the advisory existed because the tool path had a gate and
   * the other two did not, and three copies would drift apart the same way.
   */
  private async gateEntryExecution(kind: string, entry: { metadata?: unknown } | undefined): Promise<void> {
    if (!entry) return;

    const metadata = entry.metadata as { name?: string; featureFlag?: FeatureFlagRef } | undefined;
    const ref = metadata?.featureFlag;
    if (!ref) return;

    const key = typeof ref === 'string' ? ref : ref.key;
    const defaultValue = typeof ref === 'object' ? (ref.defaultValue ?? false) : false;

    let enabled: boolean;
    try {
      // The same batch call the list hooks make, so the gate and the listing cannot reach
      // different answers, and so an omitted (unknown) key falls back to `defaultValue`
      // rather than reading as a disable.
      const adapter = this.get(FeatureFlagAdapterToken) as FeatureFlagAdapter;
      const results = await adapter.evaluateFlags([key], this.currentFlagContext());
      enabled = this.isRefEnabled(ref, results);
    } catch {
      enabled = defaultValue;
    }

    if (!enabled) {
      throw new FeatureFlagDisabledError(kind, metadata?.name, key);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The listed items this plugin instance judges: those whose gate (tools/call, resources/read,
   * prompts/get, or `skills:filter` for skills) runs this instance's hook when the entry is served.
   *
   * List flows run every app's plugin over every app's entries, while a call is judged only by the
   * plugin that covers the entry's app. With a FeatureFlagPlugin on each of two apps, filtering
   * everything let one app's flags hide the other app's entries, which its own plugin still served
   * by name. When the scope can't be read (a plugin used outside a server), every item is judged.
   */
  private judgedItems<T>(items: readonly T[], entryOf: (item: T) => HookGatedEntry): Set<T> {
    let scope: ScopeEntry | undefined;
    try {
      scope = this.get(ScopeEntry) as ScopeEntry | undefined;
    } catch {
      scope = undefined;
    }
    if (!scope?.hooks) return new Set(items);
    const judgingScope = scope;
    return new Set(items.filter((item) => isEntryGatedBy(judgingScope, entryOf(item), this)));
  }

  /**
   * Collect unique flag keys from items that have a featureFlag metadata.
   */
  private collectFlagRefs<T>(
    items: Iterable<T>,
    getRef: (item: T) => FeatureFlagRef | undefined,
  ): Map<string, FeatureFlagRef> {
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
    return adapter.evaluateFlags(keys, this.currentFlagContext());
  }

  /**
   * The caller's evaluation context.
   *
   * Passing `{}` here asked the adapter "is this flag on for nobody in particular", which a
   * targeted adapter can answer differently from "is it on for THIS caller" — enabling access
   * the caller should not have. The context comes from the same `FrontMcpContext` the
   * context-scoped accessor reads, so hooks and `this.featureFlags` agree.
   */
  private currentFlagContext(): FeatureFlagContext {
    try {
      const ctx = this.get(FrontMcpContextStorage)?.getStore();
      if (!ctx) return {};
      return buildFeatureFlagContext(ctx, this.options);
    } catch {
      // No context storage bound (unit tests, non-request paths) — evaluate anonymously.
      return {};
    }
  }

  /**
   * Determine if a feature flag ref is enabled given adapter results.
   * For object-style refs, `defaultValue` acts as a fallback when the adapter
   * returns false (i.e., the flag is unknown to the adapter).
   */
  private isRefEnabled(ref: FeatureFlagRef, flagResults: Map<string, boolean>): boolean {
    const key = typeof ref === 'string' ? ref : ref.key;
    const defaultValue = typeof ref === 'object' ? (ref.defaultValue ?? false) : false;

    // An answer from the adapter wins, `false` included: the operator disabled the flag.
    // An ABSENT key means the adapter has never heard of it, and only then does the ref's
    // `defaultValue` apply. Both the list hooks and `gateEntryExecution` go through here, so
    // a capability cannot be listed and then refused on access.
    if (flagResults.has(key)) return flagResults.get(key) === true;
    return defaultValue;
  }
}
