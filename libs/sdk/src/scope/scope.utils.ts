import { depsOfClass, type Token } from '@frontmcp/di';

import { normalizeApp } from '../app/app.utils';
import {
  ScopeKind,
  type AppScopeMetadata,
  type AppType,
  type FrontMcpMultiAppConfig,
  type FrontMcpSplitByAppConfig,
  type MultiAppScopeMetadata,
  type ScopeRecord,
} from '../common';
import { ScopeConfigurationError } from '../errors';
import { Scope } from './scope.instance';

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
      // For a splitByApp scope, auth (and any auth.ui paths) come from `@App`, so
      // anchor on the App's captured source dir. Fall back to the server's.
      // `__sourceDir` lives on LocalAppMetadata only; read it defensively.
      __sourceDir: (appMetadata as { __sourceDir?: string }).__sourceDir ?? metadata.__sourceDir,
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
