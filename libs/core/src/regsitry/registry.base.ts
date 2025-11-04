import { RegistryKind, RegistryType, Token } from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';


export type RegistryBuildMapResult<Record> = {
  tokens: Set<Token>;
  defs: Map<Token, Record>;
  graph: Map<Token, Set<Token>>;
}

export abstract class RegistryAbstract<
  Interface,
  Record,
  MetadataType,
  ProviderRegistryType extends (ProviderRegistry | undefined) = ProviderRegistry
> {
  protected asyncTimeoutMs: 30000;


  ready: Promise<void>;

  protected providers: ProviderRegistryType;
  protected list: MetadataType;

  /** All tokens that are provided (graph nodes) */
  protected tokens: Set<Token>;
  /** Record definition by token */
  protected defs: Map<Token, Record>;
  /** Dependency graph by token */
  protected graph: Map<Token, Set<Token>>;


  /** All apps that are provided (graph nodes) */
  protected readonly instances: Map<Token<Interface>, Interface> = new Map();

  protected constructor(name: RegistryKind, providers: ProviderRegistryType, metadata: MetadataType, auto = true) {
    providers?.addRegistry(name, this as any as RegistryType);
    this.providers = providers;
    this.list = metadata;

    const { tokens, defs, graph } = this.buildMap(metadata);

    this.tokens = tokens;
    this.defs = defs;
    this.graph = graph;

    if (auto) {
      this.buildGraph();
      this.ready = this.initialize();
    }
  }

  protected abstract buildMap(list: MetadataType): RegistryBuildMapResult<Record>;

  protected abstract buildGraph(): void;

  protected abstract initialize(): Promise<void>;
}
