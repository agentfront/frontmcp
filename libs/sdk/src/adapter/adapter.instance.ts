import { tokenName, type Ctor, type Reference } from '@frontmcp/di';

import {
  AdapterEntry,
  AdapterKind,
  FrontMcpLogger,
  type AdapterInterface,
  type AdapterRecord,
  type EntryOwnerRef,
  type FrontMcpAdapterResponse,
} from '../common';
import { adapterInitOptionsOf } from '../common/dynamic/dynamic.adapter';
import { InvalidEntityError, InvalidRegistryKindError, RegistryNotInitializedError } from '../errors';
import PromptRegistry from '../prompt/prompt.registry';
import type ProviderRegistry from '../provider/provider.registry';
import ResourceRegistry from '../resource/resource.registry';
import ToolRegistry from '../tool/tool.registry';

/** `useValue` adapters some registry has installed; a later registry builds its own from the `init()` options. */
const installedAdapterValues = new WeakSet<object>();

/** How many registries serve each adapter, so polling stops only when the last of them is disposed. */
const adapterServings = new WeakMap<AdapterInterface, number>();

export class AdapterInstance extends AdapterEntry {
  readonly deps: Set<Reference>;
  readonly globalProviders: ProviderRegistry;

  private adapterTools: ToolRegistry | null = null;
  private adapterResources: ResourceRegistry | null = null;
  private adapterPrompts: PromptRegistry | null = null;
  private logger?: FrontMcpLogger;
  private unsubscribeUpdate?: () => void;
  private servedAdapter?: AdapterInterface;

  constructor(record: AdapterRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(record);
    this.deps = deps;
    this.globalProviders = globalProviders;

    this.ready = this.initialize();
  }

  getTools(): ToolRegistry {
    if (!this.adapterTools) throw new RegistryNotInitializedError('AdapterInstance', 'tools');
    return this.adapterTools;
  }

  getResources(): ResourceRegistry {
    if (!this.adapterResources) throw new RegistryNotInitializedError('AdapterInstance', 'resources');
    return this.adapterResources;
  }

  getPrompts(): PromptRegistry {
    if (!this.adapterPrompts) throw new RegistryNotInitializedError('AdapterInstance', 'prompts');
    return this.adapterPrompts;
  }

  protected async initialize() {
    try {
      this.logger = this.globalProviders.get(FrontMcpLogger);
    } catch {
      // Logger not available - optional dependency
    }

    const depsTokens = [...this.deps];
    this.logger?.debug(`Resolving ${depsTokens.length} dependency(ies) for adapter`);

    const depsInstances = await Promise.all(depsTokens.map((t) => this.globalProviders.resolveBootstrapDep(t)));
    const rec = this.record;
    let adapter: AdapterInterface;
    if (rec.kind === AdapterKind.CLASS) {
      const klass = rec.useClass as any;
      adapter = new klass(...depsInstances);
    } else if (rec.kind === AdapterKind.CLASS_TOKEN) {
      const klass = rec.provide as any;
      adapter = new (klass as Ctor<any>)(...depsInstances);
    } else if (rec.kind === AdapterKind.FACTORY) {
      const deps = [...rec.inject()];
      const args: any[] = [];
      for (const d of deps) args.push(await this.globalProviders.resolveBootstrapDep(d));
      adapter = await rec.useFactory(...args);
    } else if (rec.kind === AdapterKind.VALUE) {
      adapter = adapterForThisRegistry(rec.useValue);
    } else {
      throw new InvalidRegistryKindError('adapter', (rec as { kind?: string }).kind);
    }

    if (!isAdapterInstance(adapter)) {
      // A factory that returns options instead of an adapter (a hand-written `{ provide, useFactory }`)
      // fails here, with an error that says so, instead of on the first property read (#678).
      throw new InvalidEntityError(
        'adapter',
        rec.metadata?.name ?? tokenName(rec.provide),
        'an adapter: an object with `options.name` and `fetch()`. ' +
          "To build one from options, use SomeAdapter.init({ name, inject, useFactory }) and return the adapter's options from useFactory",
      );
    }

    this.logger?.debug(`Adapter constructed (kind=${rec.kind})`);
    if (adapter.options['description']) {
      this.logger?.debug(`Adapter description: ${adapter.options['description']}`);
    }

    // Inject logger if adapter supports it
    if (typeof adapter.setLogger === 'function' && this.logger) {
      adapter.setLogger(this.logger.child(`adapter:${adapter.options.name}`));
    }

    this.logger?.debug(`Fetching adapter response from "${adapter.options.name}"`);
    const result = await adapter.fetch();

    const toolCount = result.tools?.length ?? 0;
    const resourceCount = result.resources?.length ?? 0;
    const promptCount = result.prompts?.length ?? 0;
    this.logger?.debug(
      `Adapter "${adapter.options.name}" returned ${toolCount} tool(s), ${resourceCount} resource(s), ${promptCount} prompt(s)`,
    );

    const owner: EntryOwnerRef = {
      kind: 'adapter',
      id: `${adapter.options.name}`,
      ref: rec.provide,
    };

    this.adapterTools = new ToolRegistry(this.globalProviders, result.tools ?? [], owner);
    this.adapterResources = new ResourceRegistry(this.globalProviders, result.resources ?? [], owner);
    this.adapterPrompts = new PromptRegistry(this.globalProviders, result.prompts ?? [], owner);

    await Promise.all([this.adapterTools.ready, this.adapterResources.ready, this.adapterPrompts.ready]);

    this.logger?.debug(`Adapter "${adapter.options.name}" registries initialized`);

    // Subscribe to adapter updates (e.g., OpenAPI spec polling)
    if (typeof adapter.onUpdate === 'function') {
      this.unsubscribeUpdate = adapter.onUpdate((response) => {
        this.handleAdapterUpdate(response, owner);
      });
    }

    const servings = (adapterServings.get(adapter) ?? 0) + 1;
    adapterServings.set(adapter, servings);
    this.servedAdapter = adapter;

    if (servings === 1 && typeof adapter.startPolling === 'function') {
      adapter.startPolling();
      this.logger?.debug(`Adapter "${adapter.options.name}" polling started`);
    }
  }

  /** Drop this registry's update subscription, and stop polling once no registry serves the adapter. */
  dispose(): void {
    const adapter = this.servedAdapter;
    if (!adapter) return;
    this.servedAdapter = undefined;
    const unsubscribeUpdate = this.unsubscribeUpdate;
    this.unsubscribeUpdate = undefined;
    try {
      unsubscribeUpdate?.();
    } finally {
      this.releaseServing(adapter);
    }
  }

  private releaseServing(adapter: AdapterInterface): void {
    const remaining = (adapterServings.get(adapter) ?? 1) - 1;
    if (remaining > 0) {
      adapterServings.set(adapter, remaining);
      return;
    }
    adapterServings.delete(adapter);
    if (typeof adapter.stopPolling === 'function') {
      adapter.stopPolling();
      this.logger?.debug(`Adapter "${adapter.options.name}" polling stopped`);
    }
  }

  /**
   * Handle adapter update (e.g., from spec polling).
   * Replaces all tools/resources/prompts in the child registries.
   */
  private handleAdapterUpdate(response: FrontMcpAdapterResponse, owner: EntryOwnerRef): void {
    this.logger?.debug(`Adapter update received: ${response.tools?.length ?? 0} tool(s)`);

    if (response.tools && this.adapterTools) {
      this.adapterTools.replaceAll(response.tools, owner);
    }
    if (response.resources && this.adapterResources) {
      this.adapterResources.replaceAll(response.resources, owner);
    }
    if (response.prompts && this.adapterPrompts) {
      this.adapterPrompts.replaceAll(response.prompts, owner);
    }
  }
}

/** The first registry keeps an `init()` adapter; each later one builds its own from the same options. */
function adapterForThisRegistry(value: AdapterInterface): AdapterInterface {
  if (!isAdapter(value)) return value;
  const initOptions = installedAdapterValues.has(value) ? adapterInitOptionsOf(value) : undefined;
  installedAdapterValues.add(value);
  if (!initOptions) return value;
  const AdapterClass = value.constructor as new (options: object) => AdapterInterface;
  return new AdapterClass(initOptions);
}

/** Whether a constructed or produced value is an adapter the registry can start. */
function isAdapter(value: unknown): value is AdapterInterface {
  if (!value || typeof value !== 'object') return false;
  const { options, fetch } = value as Partial<AdapterInterface>;
  return !!options && typeof options === 'object' && typeof options.name === 'string' && typeof fetch === 'function';
}
