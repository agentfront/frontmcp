import { Token, depsOfClass, isClass, tokenName, getMetadata } from '@frontmcp/di';
import { PluginMetadata, PluginType, FrontMcpPluginTokens, PluginRecord, PluginKind } from '../common';
import {
  MissingProvideError,
  InvalidUseClassError,
  InvalidUseFactoryError,
  InvalidUseValueError,
  InvalidEntityError,
} from '../errors';

export function collectPluginMetadata(cls: PluginType): PluginMetadata {
  return Object.entries(FrontMcpPluginTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as PluginMetadata);
}

export function normalizePlugin(item: PluginType): PluginRecord {
  if (isClass(item)) {
    // read McpPluginMetadata from class
    const metadata = collectPluginMetadata(item);
    return { kind: PluginKind.CLASS_TOKEN, provide: item, metadata };
  }
  if (item && typeof item === 'object') {
    const { provide, useClass, useFactory, useValue, inject, ...metadata } = item as any;

    if (!provide) {
      const name = (item as any)?.name ?? '[object]';
      throw new MissingProvideError('plugin', name);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new InvalidUseClassError('plugin', tokenName(provide));
      }
      // Merge inline metadata with decorator metadata (inline takes precedence)
      // This ensures scope and other fields from inline config override decorators
      const decoratorMetadata = collectPluginMetadata(useClass as PluginType);
      const mergedMetadata = { ...decoratorMetadata, ...metadata };
      return {
        kind: PluginKind.CLASS,
        provide,
        useClass,
        metadata: mergedMetadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new InvalidUseFactoryError('plugin', tokenName(provide));
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: PluginKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        metadata,
      };
    }

    if ('useValue' in item) {
      if (useValue === undefined || useValue === null) {
        throw new InvalidUseValueError('plugin', tokenName(provide));
      }
      // Merge inline metadata with decorator metadata (inline takes precedence)
      const decoratorMetadata = collectPluginMetadata(useValue.constructor);
      const mergedMetadata = { ...decoratorMetadata, ...metadata };
      return {
        kind: PluginKind.VALUE,
        provide,
        useValue,
        metadata: mergedMetadata,
        providers: (item.providers ?? []) as any,
      };
    }
  }

  const name = (item as any)?.name ?? String(item);
  throw new InvalidEntityError('plugin', name, 'a class or a plugin object');
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - VALUE: no deps
 * - FACTORY: only includes deps that are registered (others will be resolved)
 * - CLASS / CLASS_TOKEN: deps come from the class constructor or static with(...)
 */
export function pluginDiscoveryDeps(rec: PluginRecord): Token[] {
  switch (rec.kind) {
    case PluginKind.VALUE:
      return [];
    case PluginKind.FACTORY: {
      return [...rec.inject()];
    }
    case PluginKind.CLASS:
      return depsOfClass(rec.useClass, 'discovery').filter((v) => v !== null && typeof v === 'object');

    case PluginKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery').filter((v) => v !== null && typeof v === 'object');
  }
}
