import {
  PluginMetadata,
  PluginType,
  FrontMcpPluginTokens,
  Token, PluginRecord, PluginKind,
} from '@frontmcp/sdk';
import {depsOfClass, isClass, tokenName} from '../utils/token.utils';
import {getMetadata} from '../utils/metadata.utils';

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
    return {kind: PluginKind.CLASS_TOKEN, provide: item, metadata};
  }
  if (item && typeof item === 'object') {
    const {provide, useClass, useFactory, useValue, inject, ...metadata} = item as any;

    if (!provide) {
      const name = (item as any)?.name ?? '[object]';
      throw new Error(`Plugin '${name}' is missing 'provide'.`);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new Error(
          `'useClass' on plugin '${tokenName(provide)}' must be a class.`,
        );
      }
      return {
        kind: PluginKind.CLASS,
        provide,
        useClass,
        metadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new Error(
          `'useFactory' on plugin '${tokenName(provide)}' must be a function.`,
        );
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
        throw new Error(`'useValue' on plugin '${tokenName(provide)}' must be defined.`);
      }
      const metadata = collectPluginMetadata(useValue.constructor);
      return {
        kind: PluginKind.VALUE,
        provide,
        useValue,
        metadata,
        providers: (item.providers ?? []) as any
      };
    }
  }

  const name = (item as any)?.name ?? String(item);
  throw new Error(
    `Invalid plugin '${name}'. Expected a class or a plugin object.`,
  );
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - VALUE: no deps
 * - FACTORY: only includes deps that are registered (others will be resolved)
 * - CLASS / CLASS_TOKEN: deps come from the class constructor or static with(...)
 */
export function pluginDiscoveryDeps(
  rec: PluginRecord,
): Token[] {
  switch (rec.kind) {
    case PluginKind.VALUE:
      return []
    case PluginKind.FACTORY: {
      return [...rec.inject()];
    }
    case PluginKind.CLASS:
      return depsOfClass(rec.useClass, 'discovery').filter(v => v !== null && typeof v === 'object');

    case PluginKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery').filter(v => v !== null && typeof v === 'object');
  }
}