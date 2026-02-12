import { Ctor, Reference } from '@frontmcp/di';
import { AdapterEntry, AdapterInterface, AdapterKind, AdapterRecord, EntryOwnerRef, FrontMcpLogger } from '../common';
import ProviderRegistry from '../provider/provider.registry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import PromptRegistry from '../prompt/prompt.registry';
import { InvalidRegistryKindError } from '../errors';

export class AdapterInstance extends AdapterEntry {
  readonly deps: Set<Reference>;
  readonly globalProviders: ProviderRegistry;

  private adapterTools!: ToolRegistry;
  private adapterResources!: ResourceRegistry;
  private adapterPrompts!: PromptRegistry;
  private logger?: FrontMcpLogger;

  constructor(record: AdapterRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(record);
    this.deps = deps;
    this.globalProviders = globalProviders;

    this.ready = this.initialize();
  }

  getTools(): ToolRegistry {
    return this.adapterTools;
  }

  getResources(): ResourceRegistry {
    return this.adapterResources;
  }

  getPrompts(): PromptRegistry {
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
      adapter = rec.useFactory(...args);
    } else if (rec.kind === AdapterKind.VALUE) {
      adapter = rec.useValue;
    } else {
      throw new InvalidRegistryKindError('adapter', (rec as { kind?: string }).kind);
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
  }
}
