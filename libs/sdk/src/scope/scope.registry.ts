import 'reflect-metadata';

import { tokenName, type Token } from '@frontmcp/di';

import { normalizeApp } from '../app/app.utils';
import {
  FrontMcpLogger,
  ScopeKind,
  type AppType,
  type FrontMcpConfigType,
  type ScopeEntry,
  type ScopeRecord,
} from '../common';
import { InvalidRegistryKindError, RegistryDependencyNotRegisteredError } from '../errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import type ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import { Scope } from './scope.instance';
import { normalizeAppScope, normalizeMultiAppScope, scopeDiscoveryDeps } from './scope.utils';

export class ScopeRegistry extends RegistryAbstract<ScopeEntry, ScopeRecord, FrontMcpConfigType> {
  private logger?: FrontMcpLogger;

  constructor(globalProviders: ProviderRegistry) {
    const metadata = globalProviders.get(FrontMcpConfig);
    super('ScopeRegistry', globalProviders, metadata);
    this.logger = globalProviders.get(FrontMcpLogger)?.child('ScopeRegistry');
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
          throw new RegistryDependencyNotRegisteredError('Scope', tokenName(token), tokenName(d));
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  protected async initialize() {
    this.logger?.verbose(`ScopeRegistry: initializing ${this.tokens.size} scope(s)`);
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
          throw new InvalidRegistryKindError('scope', String((rec as { kind: string }).kind));
      }

      await scope.ready;
      this.instances.set(token, scope);
      this.logger?.verbose(`ScopeRegistry: initialized scope '${tokenName(token)}'`);
    }
    this.logger?.verbose(`ScopeRegistry: initialization complete (${this.instances.size} scope(s))`);
  }

  /**
   * Get all initialized scope instances.
   * Useful for graph visualization and introspection.
   */
  getScopes(): ScopeEntry[] {
    return [...this.instances.values()];
  }
}
