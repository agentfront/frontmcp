import 'reflect-metadata';
import { Token, tokenName } from '@frontmcp/di';
import { AdapterEntry, AdapterRecord, AdapterRegistryInterface, AdapterType, FrontMcpLogger } from '../common';
import { adapterDiscoveryDeps, normalizeAdapter } from './adapter.utils';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { AdapterInstance } from './adapter.instance';
import {
  RegistryDefinitionNotFoundError,
  RegistryGraphEntryNotFoundError,
  RegistryDependencyNotRegisteredError,
} from '../errors';

export default class AdapterRegistry
  extends RegistryAbstract<AdapterInstance, AdapterRecord, AdapterType[]>
  implements AdapterRegistryInterface
{
  private logger?: FrontMcpLogger;

  constructor(providers: ProviderRegistry, list: AdapterType[]) {
    super('AdapterRegistry', providers, list, false);
    try {
      this.logger = providers.get(FrontMcpLogger);
    } catch {
      // Logger not available - optional dependency
    }
    this.logger?.debug(`AdapterRegistry: ${list.length} adapter(s) registered`);
    this.buildGraph();
    this.ready = this.initialize();
  }

  protected override buildMap(list: AdapterType[]): RegistryBuildMapResult<AdapterRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, AdapterRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeAdapter(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new RegistryDefinitionNotFoundError('AdapterRegistry', tokenName(token));
      }
      const deps = adapterDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new RegistryDependencyNotRegisteredError('Adapter', tokenName(token), tokenName(d));
        }
        const graphEntry = this.graph.get(token);
        if (!graphEntry) {
          throw new RegistryGraphEntryNotFoundError('AdapterRegistry', tokenName(token));
        }
        graphEntry.add(d);
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {
    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new RegistryDefinitionNotFoundError('AdapterRegistry', tokenName(token));
      }
      const deps = this.graph.get(token);
      if (!deps) {
        throw new RegistryGraphEntryNotFoundError('AdapterRegistry', tokenName(token));
      }

      const instance = new AdapterInstance(rec, deps, this.providers);

      this.instances.set(token, instance);
      readyArr.push(instance.ready);
    }
    await Promise.all(readyArr);
    this.logger?.debug('AdapterRegistry: initialization complete');
  }

  getAdapters(): AdapterEntry[] {
    return [...this.instances.values()];
  }
}
