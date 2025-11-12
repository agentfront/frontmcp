import 'reflect-metadata';
import { AdapterEntry, AdapterRecord, AdapterRegistryInterface, AdapterType, Token } from '../common';
import { adapterDiscoveryDeps, normalizeAdapter } from './adapter.utils';
import { tokenName } from '../utils/token.utils';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { AdapterInstance } from './adapter.instance';

export default class AdapterRegistry extends RegistryAbstract<AdapterInstance, AdapterRecord, AdapterType[]> implements AdapterRegistryInterface {

  constructor(
    providers: ProviderRegistry,
    list: AdapterType[],
  ) {
    super('AdapterRegistry', providers, list);
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
      const rec = this.defs.get(token)!;
      const deps = adapterDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`Adapter ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {

    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = this.graph.get(token)!;

      const instance = new AdapterInstance(rec, deps, this.providers);

      this.instances.set(token, instance);
      readyArr.push(instance.ready);
    }
    await Promise.all(readyArr);

  }

  getAdapters(): AdapterEntry[] {
    return [...this.instances.values()];
  }
}
