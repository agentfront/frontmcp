import { depsOfClass, getMetadata, isClass, tokenName, type Token } from '@frontmcp/di';

import {
  AdapterKind,
  FrontMcpAdapterTokens,
  type AdapterMetadata,
  type AdapterRecord,
  type AdapterType,
} from '../common';
import { InvalidEntityError, InvalidUseClassError, InvalidUseFactoryError, MissingProvideError } from '../errors';

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
      throw new MissingProvideError('Adapter', name);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new InvalidUseClassError('adapter', tokenName(provide));
      }
      return {
        kind: AdapterKind.CLASS,
        provide,
        useClass,
        metadata: (item as any).metadata ?? collectAdapterMetadata(useClass),
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new InvalidUseFactoryError('adapter', tokenName(provide));
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: AdapterKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        // `SomeAdapter.init({ name, inject, useFactory })` records carry the adapter's name, not metadata (#678).
        metadata: (item as any).metadata ?? factoryAdapterMetadata(item as { name?: unknown }, provide),
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
  throw new InvalidEntityError('adapter', name, 'a class or an adapter object');
}

/** Metadata for a factory record that names no metadata of its own: its `name`, else its token's name. */
function factoryAdapterMetadata(item: { name?: unknown; description?: unknown }, provide: Token): AdapterMetadata {
  const name = typeof item.name === 'string' && item.name ? item.name : tokenName(provide);
  return typeof item.description === 'string' ? { name, description: item.description } : { name };
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
