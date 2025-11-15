import 'reflect-metadata';
import {
  AppType,
  FrontMcpConfigType,
  ScopeEntry,
  ScopeRecord,
  ScopeKind,
  Token,
} from '../common';
import {RegistryAbstract, RegistryBuildMapResult} from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import {FrontMcpConfig} from '../front-mcp/front-mcp.tokens';
import {normalizeApp} from '../app/app.utils';
import {normalizeAppScope, normalizeMultiAppScope, scopeDiscoveryDeps} from './scope.utils';
import {tokenName} from '../utils/token.utils';
import {Scope} from "./scope.instance";

export class ScopeRegistry extends RegistryAbstract<ScopeEntry, ScopeRecord, FrontMcpConfigType> {

  constructor(globalProviders: ProviderRegistry) {
    const metadata = globalProviders.get(FrontMcpConfig);
    super('ScopeRegistry', globalProviders, metadata);
  }

  protected override buildMap(metadata: FrontMcpConfigType): RegistryBuildMapResult<ScopeRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ScopeRecord>();
    const graph = new Map<Token, Set<Token>>();

    if (metadata.splitByApp) {
      for (const raw of metadata.apps) {
        const rec = normalizeAppScope(raw, metadata);
        const provide = rec.provide;
        tokens.add(provide);
        defs.set(provide, rec);
        graph.set(provide, new Set());
      }
    } else {
      const includeInParent: AppType[] = [];

      for (const raw of metadata.apps) {
        const app = normalizeApp(raw);
        const appMetadata = app.metadata;
        if (appMetadata.standalone === false) {
          includeInParent.push(raw);
          // default include in parent scope
          continue;
        }

        if (appMetadata.standalone === 'includeInParent') {
          includeInParent.push(raw);
          // include in the parent scope and continue to create a standalone app scope
        }

        const appScopeRec = normalizeAppScope(raw, metadata);
        const provide = appScopeRec.provide;
        tokens.add(provide);
        defs.set(provide, appScopeRec);
        graph.set(provide, new Set());
      }

      const rec = normalizeMultiAppScope(includeInParent, metadata);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return {
      tokens,
      defs,
      graph,
    };
  }

  protected override buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = scopeDiscoveryDeps(rec).slice(1);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`Adapter ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  protected async initialize() {

    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      let scope: ScopeEntry;
      switch (rec.kind) {
        case ScopeKind.SPLIT_BY_APP:
          scope = new Scope(rec, this.providers);
          break;
        case ScopeKind.MULTI_APP:
          scope = new rec.provide(rec, this.providers);
          break;
        default:
          throw new Error(`Invalid scope kind ${rec}`);
      }

      await scope.ready;
      this.instances.set(token, scope);
    }
  }

}
