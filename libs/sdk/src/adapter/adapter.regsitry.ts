import 'reflect-metadata';
import { Token, tokenName } from '@frontmcp/di';
import { AdapterEntry, AdapterRecord, AdapterRegistryInterface, AdapterType, EntryOwnerRef } from '../common';
import { adapterDiscoveryDeps, normalizeAdapter } from './adapter.utils';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { AdapterInstance } from './adapter.instance';
import type { Scope } from '../scope';

export default class AdapterRegistry
  extends RegistryAbstract<AdapterInstance, AdapterRecord, AdapterType[]>
  implements AdapterRegistryInterface
{
  private readonly scope: Scope;
  private readonly owner?: EntryOwnerRef;

  constructor(providers: ProviderRegistry, list: AdapterType[], owner?: EntryOwnerRef) {
    super('AdapterRegistry', providers, list);
    this.scope = providers.getActiveScope();
    this.owner = owner;
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
    this.emitAdapterTraceEvent('reset');
  }

  /**
   * Emit a trace event for adapter registry changes (for TUI display)
   */
  private emitAdapterTraceEvent(kind: 'reset' | 'added' | 'removed') {
    try {
      // Build adapter entries with name and owner
      const adapterEntries: Array<{ name: string; description?: string }> = [];

      for (const token of this.tokens) {
        const rec = this.defs.get(token);
        if (rec) {
          adapterEntries.push({
            name: rec.metadata.name,
            description: rec.metadata.description,
          });
        }
      }

      this.scope.logger.trace(`registry:adapter:${kind}`, {
        registryType: 'adapter',
        changeKind: kind,
        changeScope: 'global',
        entries: adapterEntries,
        owner: this.owner ? { kind: this.owner.kind, id: this.owner.id } : undefined,
        snapshotCount: adapterEntries.length,
      });
    } catch {
      // Ignore trace errors - don't break registry operations
    }
  }

  getAdapters(): AdapterEntry[] {
    return [...this.instances.values()];
  }
}
