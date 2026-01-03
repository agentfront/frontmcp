import { Type, Token, ProviderKind, isClass, tokenName, getMetadata } from '@frontmcp/di';
import { ProviderMetadata, FrontMcpProviderTokens, ProviderRecord } from '../common';

function collectProviderMetadata(cls: Type): ProviderMetadata {
  return Object.entries(FrontMcpProviderTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as ProviderMetadata);
}

export function normalizeProvider(item: any): ProviderRecord {
  if (isClass(item)) {
    // read McpProviderMetadata from class
    const metadata = collectProviderMetadata(item);
    return { kind: ProviderKind.CLASS_TOKEN, provide: item, metadata };
  }
  if (item && typeof item === 'object') {
    const { provide, useClass, useValue, useFactory, inject } = item;

    if (!provide) {
      const name = (item as any)?.name ?? '[object]';
      throw new Error(`Provider '${name}' is missing 'provide'.`);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new Error(`'useClass' on provider '${tokenName(provide)}' must be a class.`);
      }
      return {
        kind: ProviderKind.CLASS,
        provide,
        useClass,
        metadata: (item as any).metadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new Error(`'useFactory' on provider '${tokenName(provide)}' must be a function.`);
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: ProviderKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        metadata: item.metadata,
      };
    }

    if ('useValue' in item) {
      return {
        kind: ProviderKind.VALUE,
        provide,
        useValue,
        metadata: item.metadata,
      };
    }
  }

  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid provider '${name}'. Expected a class or a provider object.`);
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
