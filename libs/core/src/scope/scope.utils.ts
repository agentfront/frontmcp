import {
  AppScopeMetadata,
  AppType,
  FrontMcpMultiAppConfig,
  FrontMcpSplitByAppConfig,
  MultiAppScopeMetadata,
  Token,
  ScopeRecord,
  ScopeKind,
} from '@frontmcp/sdk';
import {normalizeApp} from '../app/app.utils';
import {depsOfClass} from '../utils/token.utils';
import {Scope} from './scope.instance';

/**
 * Normalize a raw scope metadata list into useful maps/sets.
 * - tokens: all provided tokens
 * - defs: AdapterRecord by token
 * - graph: initialized adjacency map (empty sets)
 */

export function normalizeAppScope(appItem: AppType, metadata: FrontMcpMultiAppConfig | FrontMcpSplitByAppConfig): ScopeRecord {
  const app = normalizeApp(appItem);
  const appMetadata = app.metadata;

  /**
   *  Explicitly check for true for splitByApp scope.
   */
  // noinspection PointlessBooleanExpressionJS
  if (metadata.splitByApp === true && appMetadata.standalone === 'includeInParent') {
    throw new Error('standalone: includeInParent is not supported for splitByApp scope');
  }
  return {
    kind: ScopeKind.SPLIT_BY_APP,
    provide: Scope,
    metadata: {
      ...metadata,
      id: appMetadata.id ?? appMetadata.name,
      apps: [appItem],
      auth: appMetadata.auth
    } as any as AppScopeMetadata,
  };
}

export function normalizeMultiAppScope(includedApps: AppType[], metadata: FrontMcpMultiAppConfig): ScopeRecord {
  return {
    kind: ScopeKind.MULTI_APP,
    provide: Scope,
    metadata: {
      ...metadata,
      id: 'root',
      apps: includedApps,
    } as MultiAppScopeMetadata,
  };
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 */
export function scopeDiscoveryDeps(rec: ScopeRecord): Token[] {
  switch (rec.kind) {
    case ScopeKind.MULTI_APP:
      return depsOfClass(rec.provide, 'discovery').slice(1);
    case ScopeKind.SPLIT_BY_APP:
      return depsOfClass(rec.provide, 'discovery').slice(1);
  }
}