import { Token, depsOfClass } from '@frontmcp/di';
import {
  AppScopeMetadata,
  AppType,
  FrontMcpMultiAppConfig,
  FrontMcpSplitByAppConfig,
  MultiAppScopeMetadata,
  ScopeRecord,
  ScopeKind,
} from '../common';
import { normalizeApp } from '../app/app.utils';
import { Scope } from './scope.instance';
import { ScopeConfigurationError } from '../errors';

/**
 * Normalize a raw scope metadata list into useful maps/sets.
 * - tokens: all provided tokens
 * - defs: AdapterRecord by token
 * - graph: initialized adjacency map (empty sets)
 */

export function normalizeAppScope(
  appItem: AppType,
  metadata: FrontMcpMultiAppConfig | FrontMcpSplitByAppConfig,
): ScopeRecord {
  const app = normalizeApp(appItem);
  const appMetadata = app.metadata;

  /**
   *  Explicitly check for true for splitByApp scope.
   */
  // noinspection PointlessBooleanExpressionJS
  if (metadata.splitByApp === true && appMetadata.standalone === 'includeInParent') {
    throw new ScopeConfigurationError('standalone: includeInParent is not supported for splitByApp scope');
  }
  const scopeId = appMetadata.id ?? appMetadata.name;
  const token: Token<AppType> = Symbol(scopeId);
  return {
    kind: ScopeKind.SPLIT_BY_APP,
    provide: token,
    metadata: {
      ...metadata,
      id: scopeId,
      apps: [appItem],
      auth: appMetadata.auth,
    } as AppScopeMetadata,
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
      return []; // no deps for splitByApp scope;
  }
}
