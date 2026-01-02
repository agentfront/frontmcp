import { Token, depsOfClass, isClass, tokenName, getMetadata } from '@frontmcp/di';
import { AdapterMetadata, FrontMcpAdapterTokens, AdapterRecord, AdapterType, AdapterKind } from '../common';

export function collectAdapterMetadata(cls: AdapterType): AdapterMetadata {
  return Object.entries(FrontMcpAdapterTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as AdapterMetadata);
}

export function normalizeAdapter(item: AdapterType): AdapterRecord {
  if (isClass(item)) {
    const metadata = collectAdapterMetadata(item);
    return { kind: AdapterKind.CLASS_TOKEN, provide: item, metadata };
  }
  if (item && typeof item === 'object') {
    const { provide, useClass, useValue, useFactory, inject } = item as any;

    if (!provide) {
      const name = (item as any)?.name ?? '[object]';
      throw new Error(`Adapter '${name}' is missing 'provide'.`);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new Error(`'useClass' on adapter '${tokenName(provide)}' must be a class.`);
      }
      return {
        kind: AdapterKind.CLASS,
        provide,
        useClass,
        metadata: (item as any).metadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new Error(`'useFactory' on adapter '${tokenName(provide)}' must be a function.`);
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: AdapterKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        metadata: (item as any).metadata,
      };
    }

    if ('useValue' in item) {
      const metadata = collectAdapterMetadata(useValue.constructor);
      return {
        kind: AdapterKind.VALUE,
        provide,
        useValue,
        metadata,
      };
    }
  }

  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid adapter '${name}'. Expected a class or a adapter object.`);
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - VALUE: no deps
 * - FACTORY: only includes deps that are registered (others will be resolved)
 * - CLASS / CLASS_TOKEN: deps come from the class constructor or static with(...)
 */
export function adapterDiscoveryDeps(rec: AdapterRecord): Token[] {
  switch (rec.kind) {
    case AdapterKind.VALUE:
      return [];

    case AdapterKind.FACTORY: {
      return [...rec.inject()];
    }
    case AdapterKind.CLASS:
      return depsOfClass(rec.useClass, 'discovery');

    case AdapterKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}
