import { depsOfClass, getMetadata, isClass, type Token, type Type } from '@frontmcp/di';
import { idFromString, isValidMcpUri } from '@frontmcp/utils';

import {
  AppKind,
  FrontMcpLocalAppTokens,
  lazyAppMetadataSchema,
  type AppEntry,
  type AppRecord,
  type AppType,
  type LocalAppMetadata,
  type RemoteAppMetadata,
} from '../common';
import { InvalidEntityError, LazyAppConfigurationError, MissingProvideError } from '../errors';
import { type AppLocalInstance } from './instances';

export function collectAppMetadata(cls: AppType): LocalAppMetadata {
  return Object.entries(FrontMcpLocalAppTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as LocalAppMetadata);
}

/** The id an app is known by: its own `id`, else one derived from its `name`. */
export function appIdOf(metadata: { id?: string; name: string }): string {
  return metadata.id ?? idFromString(metadata.name);
}

/**
 * Check if an object is a remote app configuration.
 * For npm/esm urlTypes the url is a package specifier (no scheme required).
 * For url/worker urlTypes the url must have a valid URI scheme per RFC 3986.
 */
function isRemoteAppConfig(item: unknown): item is RemoteAppMetadata {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj['urlType'] !== 'string' || typeof obj['url'] !== 'string' || typeof obj['name'] !== 'string') {
    return false;
  }
  // For npm/esm urlTypes, url is a package specifier (no scheme required)
  if (obj['urlType'] === 'npm' || obj['urlType'] === 'esm') {
    return true;
  }
  // For url/worker types, require a valid URI scheme
  if (obj['urlType'] === 'url' || obj['urlType'] === 'worker') {
    return isValidMcpUri(obj['url']);
  }
  // Unknown urlType — reject
  return false;
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

  if (item && typeof item === 'object' && 'lazy' in item) {
    return normalizeLazyApp(item);
  }

  // Check for remote app configuration (has urlType, url, and name)
  if (isRemoteAppConfig(item)) {
    const metadata = item; // Type guard already narrows to RemoteAppMetadata
    const appId = metadata.id ?? metadata.name;
    const provide: Token = Symbol(`remote:${appId}`);

    return {
      kind: AppKind.REMOTE_VALUE,
      provide,
      // Placeholder: Remote instances are created in AppRegistry.initialize
      // The null is replaced with actual AppRemoteInstance during initialization
      useValue: null as unknown as AppEntry,
      metadata,
    };
  }

  if (item && typeof item === 'object') {
    const { provide, useValue, ...metadata } = item as any;
    if (!provide) {
      const name = (item as any)?.name ?? JSON.stringify(item) ?? '[object]';
      throw new MissingProvideError('App', name);
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
  throw new InvalidEntityError('app', name, 'a class or remote app config object');
}

/** A lazy app `{ name, lazy: () => import(...) }`, validated; its code is not imported here. */
function normalizeLazyApp(item: object): AppRecord {
  const parsed = lazyAppMetadataSchema.safeParse(item);
  if (!parsed.success) {
    const name = (item as { name?: unknown }).name;
    const label = typeof name === 'string' ? `Lazy app "${name}"` : 'A lazy app';
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join('.') || (issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : '');
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    throw new LazyAppConfigurationError(
      `${label} is invalid (${issues.join('; ')}). A lazy app takes id, name, description, enabled and lazy; ` +
        'declare everything else on the @App class it imports.',
    );
  }
  const metadata = { ...parsed.data, standalone: false as const };
  return { kind: AppKind.LAZY_IMPORT, provide: Symbol(`lazy:${appIdOf(metadata)}`), metadata };
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - REMOTE_VALUE, LAZY_IMPORT: no deps
 * - LOCAL_CLASS: deps come from the class constructor
 */
export function appDiscoveryDeps(rec: AppRecord): Token[] {
  switch (rec.kind) {
    case AppKind.REMOTE_VALUE:
    case AppKind.LAZY_IMPORT:
      return [];
    case AppKind.LOCAL_CLASS:
      return depsOfClass(rec.provide, 'discovery');
  }
}
