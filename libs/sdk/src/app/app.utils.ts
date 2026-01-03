import { Type, Token, depsOfClass, isClass, getMetadata } from '@frontmcp/di';
import { LocalAppMetadata, FrontMcpLocalAppTokens, AppType, AppRecord, AppKind } from '../common';
import { AppLocalInstance } from './instances';

export function collectAppMetadata(cls: AppType): LocalAppMetadata {
  return Object.entries(FrontMcpLocalAppTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as LocalAppMetadata);
}

/**
 * Normalize a raw app metadata list into useful maps/sets.
 * - tokens: all provided tokens
 * - defs: AppRecord by token
 * - graph: initialized adjacency map (empty sets)
 */
export function normalizeApp(item: AppType): AppRecord {
  if (isClass(item)) {
    const metadata = collectAppMetadata(item);
    return { kind: AppKind.LOCAL_CLASS, provide: item as Type<AppLocalInstance>, metadata };
  }
  if (item && typeof item === 'object') {
    const { provide, useValue, ...metadata } = item as any;
    if (!provide) {
      const name = (item as any)?.name ?? JSON.stringify(item) ?? '[object]';
      throw new Error(`App '${name}' is missing 'provide'.`);
    }

    if (useValue) {
      return {
        kind: AppKind.REMOTE_VALUE,
        provide,
        useValue,
        metadata,
      };
    }
  }
  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid app '${name}'. Expected a class or remote app config object.`);
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - REMOTE_VALUE: no deps
 * - LOCAL_CLASS: deps come from the class constructor
 */
export function appDiscoveryDeps(rec: AppRecord): Token[] {
  switch (rec.kind) {
    case AppKind.REMOTE_VALUE:
      return [];
    case AppKind.LOCAL_CLASS:
      return depsOfClass(rec.provide, 'discovery');
  }
}
