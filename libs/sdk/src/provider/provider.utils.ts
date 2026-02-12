import { Type, Token, ProviderKind, isClass, tokenName, getMetadata } from '@frontmcp/di';
import { FrontMcpProviderTokens } from '../common';
import type { ProviderMetadata, ProviderRecord, ProviderScope } from '../common';
import { MissingProvideError, InvalidUseClassError, InvalidUseFactoryError, InvalidEntityError } from '../errors';

/**
 * Shape for provider input items (used during normalization).
 * Supports both class-based providers and configuration objects.
 */
interface ProviderLike {
  provide?: Token;
  useClass?: Type;
  useValue?: unknown;
  useFactory?: (...args: unknown[]) => unknown;
  inject?: () => readonly Token[];
  // Top-level metadata fields (can override nested metadata)
  name?: string;
  scope?: ProviderScope;
  description?: string;
  id?: string;
  metadata?: ProviderMetadata;
}

function collectProviderMetadata(cls: Type): ProviderMetadata {
  return Object.entries(FrontMcpProviderTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as ProviderMetadata);
}

/**
 * Extract provider metadata from an item.
 * Supports both nested `metadata: { scope, name }` and top-level fields.
 * Top-level fields take precedence when both are present.
 */
function extractProviderMetadata(item: ProviderLike): ProviderMetadata {
  const nested: ProviderMetadata | undefined = item.metadata;
  const topLevel: Partial<ProviderMetadata> = {};

  // Extract known metadata fields from top level
  if (item.name !== undefined) topLevel.name = item.name;
  if (item.scope !== undefined) topLevel.scope = item.scope;
  if (item.description !== undefined) topLevel.description = item.description;
  if (item.id !== undefined) topLevel.id = item.id;

  // Merge: nested first, then top-level overrides
  // Provide a default name if none specified
  const result = { ...nested, ...topLevel } as ProviderMetadata;
  if (!result.name) {
    result.name = (item.provide ? tokenName(item.provide) : undefined) || 'UnknownProvider';
  }
  return result;
}

export function normalizeProvider(item: Type | ProviderLike): ProviderRecord {
  if (isClass(item)) {
    // read McpProviderMetadata from class
    const metadata = collectProviderMetadata(item);
    return { kind: ProviderKind.CLASS_TOKEN, provide: item, metadata };
  }
  if (item && typeof item === 'object') {
    const providerItem = item as ProviderLike;
    const { provide, useClass, useValue, useFactory, inject } = providerItem;

    if (!provide) {
      const name = providerItem.name ?? '[object]';
      throw new MissingProvideError('Provider', name);
    }

    // Extract metadata from both nested and top-level fields
    const metadata = extractProviderMetadata(providerItem);

    if (useClass) {
      if (!isClass(useClass)) {
        throw new InvalidUseClassError('provider', tokenName(provide));
      }
      return {
        kind: ProviderKind.CLASS,
        provide,
        useClass,
        metadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new InvalidUseFactoryError('provider', tokenName(provide));
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: ProviderKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        metadata,
      };
    }

    if ('useValue' in item) {
      return {
        kind: ProviderKind.VALUE,
        provide,
        useValue,
        metadata,
      };
    }
  }

  const name = (item as ProviderLike)?.name ?? String(item);
  throw new InvalidEntityError('provider', name, 'a class or a provider object');
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - VALUE: no deps
 * - FACTORY: only includes deps that are registered (others will be resolved ad-hoc)
 * - CLASS / CLASS_TOKEN: deps come from the class constructor or static with(...)
 */
export function providerDiscoveryDeps(
  rec: ProviderRecord,
  tokens: Set<Token>,
  depsOfClass: (klass: any, phase: 'discovery' | 'invocation') => Token[],
): Token[] {
  switch (rec.kind) {
    case ProviderKind.VALUE:
      return [];

    case ProviderKind.FACTORY: {
      const all = [...rec.inject()];
      return all.filter((d) => tokens.has(d));
    }

    case ProviderKind.CLASS:
      return depsOfClass(rec.useClass, 'discovery');

    case ProviderKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');

    case ProviderKind.INJECTED:
      return depsOfClass(rec.value, 'discovery');
  }
}

/**
 * For invocation time. Returns full dependency tokens list that must be resolved.
 */
export function providerInvocationTokens(
  rec: ProviderRecord,
  depsOfClass: (klass: any, phase: 'invocation' | 'discovery') => Token[],
): Token[] {
  switch (rec.kind) {
    case ProviderKind.VALUE:
      return [];
    case ProviderKind.FACTORY:
      return [...rec.inject()];
    case ProviderKind.CLASS:
      return depsOfClass(rec.useClass, 'invocation');
    case ProviderKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'invocation');
    case ProviderKind.INJECTED:
      return depsOfClass(rec.value, 'invocation');
  }
}
