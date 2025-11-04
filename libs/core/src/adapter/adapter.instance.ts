import {
  AdapterEntry,
  AdapterInterface,
  AdapterKind,
  AdapterRecord,
  Ctor,
  Reference,
} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import PromptRegistry from '../prompt/prompt.registry';

export class AdapterInstance extends AdapterEntry {
  readonly deps: Set<Reference>;
  readonly globalProviders: ProviderRegistry;

  private tools: ToolRegistry;
  private resources: ResourceRegistry;
  private prompts: PromptRegistry;

  constructor(record: AdapterRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(record);
    this.deps = deps;
    this.globalProviders = globalProviders;

    this.ready = this.initialize();
  }

  protected async initialize() {

    const depsTokens = [...this.deps];
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
      throw Error('Invalid adapter kind');
    }

    const result = await adapter.fetch();

    this.tools = new ToolRegistry(this.globalProviders, result.tools ?? [], {
      kind: 'adapter',
      id: `${adapter.options.name}`,
      ref: rec.provide,
    });

    // this.resources = new ResourceRegistry(this.globalProviders, result.resources ?? [], {
    //   kind: 'adapter',
    //   id: rec.metadata.id ?? rec.metadata.name,
    //   ref: rec.provide,
    // });

    // this.prompts = new PromptRegistry(this.globalProviders, result.prompts ?? [], {
    //   kind: 'adapter',
    //   id: rec.metadata.id ?? rec.metadata.name,
    //   ref: rec.provide,
    // });

    await this.tools.ready;

  }
}