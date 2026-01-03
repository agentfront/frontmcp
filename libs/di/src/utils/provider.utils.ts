/**
 * Provider normalization and dependency discovery utilities.
 *
 * These utilities convert user-facing provider definitions to internal
 * ProviderRecord format and discover dependencies.
 */

import type { Token, Type } from '../interfaces/base.interface.js';
import type { ProviderType } from '../interfaces/provider.interface.js';
import {
  ProviderKind,
  type ProviderRecord,
  type ProviderClassTokenRecord,
  type ProviderClassRecord,
  type ProviderValueRecord,
  type ProviderFactoryRecord,
} from '../records/provider.record.js';
import type { ProviderMetadata } from '../metadata/provider.metadata.js';
import { isClass } from './token.utils.js';
import { getMetadata } from './metadata.utils.js';

/**
 * Token set for reading provider metadata from classes.
 * Each key maps to a metadata symbol used with reflect-metadata.
 */
export interface ProviderTokens {
  /** Token indicating this is a provider class */
  type: symbol;
  /** Token for provider name */
  name: symbol;
  /** Token for provider scope */
  scope: symbol;
  /** Token for provider description */
  description?: symbol;
  /** Token for provider id */
  id?: symbol;
}

/**
 * Options for creating a provider normalizer.
 */
export interface ProviderNormalizerOptions {
  /**
   * Metadata tokens for reading provider information from decorated classes.
   */
  tokens: ProviderTokens;
}

/**
 * Create a provider normalizer function with the given metadata tokens.
 *
 * The normalizer converts user-facing provider definitions to internal
 * ProviderRecord format. By injecting tokens, this works with any
 * decorator system (FrontMCP, custom, etc.).
 *
 * @param options - Normalizer configuration with metadata tokens
 * @returns A normalizer function
 *
 * @example
 * ```typescript
 * import { createProviderNormalizer } from '@frontmcp/di';
 *
 * const normalizeProvider = createProviderNormalizer({
 *   tokens: {
 *     type: Symbol('provider:type'),
 *     name: Symbol('provider:name'),
 *     scope: Symbol('provider:scope'),
 *   }
 * });
 *
 * const record = normalizeProvider(MyService);
 * ```
 */
export function createProviderNormalizer(options: ProviderNormalizerOptions) {
  const { tokens } = options;

  return function normalizeProvider(item: ProviderType): ProviderRecord {
    // Check if it's a decorated provider class (CLASS_TOKEN)
    if (isClass(item)) {
      const isProviderClass = getMetadata(tokens.type, item);
      if (isProviderClass) {
        const metadata: ProviderMetadata = {
          name: getMetadata(tokens.name, item) ?? (item as any).name ?? 'UnknownProvider',
          scope: getMetadata(tokens.scope, item),
          description: tokens.description ? getMetadata(tokens.description, item) : undefined,
          id: tokens.id ? getMetadata(tokens.id, item) : undefined,
        };
        return {
          kind: ProviderKind.CLASS_TOKEN,
          provide: item as Type,
          metadata,
        } satisfies ProviderClassTokenRecord;
      }

      // Plain class without decoration - use static metadata if available
      const staticMeta = (item as any).metadata as ProviderMetadata | undefined;
      return {
        kind: ProviderKind.CLASS_TOKEN,
        provide: item as Type,
        metadata: staticMeta ?? { name: (item as any).name ?? 'UnknownProvider' },
      } satisfies ProviderClassTokenRecord;
    }

    // Object-style provider definitions
    // Using 'any' is justified: we perform runtime type checks ('useValue' in obj, etc.)
    // and the input type ProviderType already constrains the expected shapes
    const obj = item as any;

    // Validate provide field for object-style providers
    if ('useValue' in obj || 'useFactory' in obj || 'useClass' in obj) {
      if (!obj.provide) {
        const name = obj.name ?? '[object]';
        throw new Error(`Provider '${name}' is missing 'provide'.`);
      }
    }

    // useValue
    if ('useValue' in obj) {
      return {
        kind: ProviderKind.VALUE,
        provide: obj.provide,
        useValue: obj.useValue,
        metadata: obj.metadata ?? { name: 'ValueProvider' },
      } satisfies ProviderValueRecord;
    }

    // useFactory
    if ('useFactory' in obj) {
      return {
        kind: ProviderKind.FACTORY,
        provide: obj.provide,
        inject: obj.inject ?? (() => []),
        useFactory: obj.useFactory,
        metadata: obj.metadata ?? { name: 'FactoryProvider' },
      } satisfies ProviderFactoryRecord;
    }

    // useClass
    if ('useClass' in obj) {
      return {
        kind: ProviderKind.CLASS,
        provide: obj.provide,
        useClass: obj.useClass,
        metadata: obj.metadata ?? { name: obj.useClass?.name ?? 'ClassProvider' },
      } satisfies ProviderClassRecord;
    }

    let itemStr: string;
    try {
      itemStr = JSON.stringify(item);
    } catch {
      itemStr = String(item);
    }
    throw new Error(`Cannot normalize provider: unrecognized format ${itemStr}`);
  };
}

/**
 * Discover dependencies for a provider record during the discovery phase.
 *
 * @param rec - The provider record
 * @param localTokens - Set of locally registered tokens
 * @param depsOfClassFn - Function to discover class dependencies
 * @returns Array of dependency tokens
 */
export function providerDiscoveryDeps(
  rec: ProviderRecord,
  localTokens: Set<Token>,
  depsOfClassFn: (klass: Type, phase: 'discovery' | 'invocation') => Type[],
): Token[] {
  switch (rec.kind) {
    case ProviderKind.VALUE:
    case ProviderKind.INJECTED:
      return [];

    case ProviderKind.FACTORY: {
      // Filter by locally registered tokens for graph detection
      const all = [...rec.inject()];
      return all.filter((d) => localTokens.has(d));
    }

    case ProviderKind.CLASS:
      return depsOfClassFn(rec.useClass, 'discovery');

    case ProviderKind.CLASS_TOKEN:
      return depsOfClassFn(rec.provide, 'discovery');
  }
}

/**
 * Get invocation tokens for a provider record.
 *
 * These are the tokens that need to be resolved when instantiating the provider.
 *
 * @param rec - The provider record
 * @param depsOfClassFn - Function to discover class dependencies
 * @returns Array of dependency tokens
 */
export function providerInvocationTokens(
  rec: ProviderRecord,
  depsOfClassFn: (klass: Type, phase: 'discovery' | 'invocation') => Type[],
): Token[] {
  switch (rec.kind) {
    case ProviderKind.VALUE:
    case ProviderKind.INJECTED:
      return [];

    case ProviderKind.FACTORY:
      return [...rec.inject()];

    case ProviderKind.CLASS:
      return depsOfClassFn(rec.useClass, 'invocation');

    case ProviderKind.CLASS_TOKEN:
      return depsOfClassFn(rec.provide, 'invocation');
  }
}
