// auth/auth.utils.ts
import { Token, depsOfClass, isClass, tokenName, getMetadata } from '@frontmcp/di';
import {
  AuthProviderMetadata,
  FrontMcpAuthProviderTokens,
  AuthProviderType,
  AuthProviderRecord,
  AuthProviderKind,
} from '../common';
import { MissingProvideError, InvalidUseClassError, InvalidUseFactoryError, InvalidEntityError } from '../errors';

export function collectAuthMetadata(cls: AuthProviderType): AuthProviderMetadata {
  return Object.entries(FrontMcpAuthProviderTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as AuthProviderMetadata);
}

export function normalizeAuth(item: AuthProviderType): AuthProviderRecord {
  if (isClass(item)) {
    // read McpAuthMetadata from class
    const metadata = collectAuthMetadata(item);
    return { kind: AuthProviderKind.CLASS_TOKEN, provide: item, metadata };
  }
  if (item && typeof item === 'object') {
    const { provide, useClass, useValue, useFactory, inject, ...metadata } = item as any;

    if (!provide) {
      const name = (item as any)?.name ?? '[object]';
      throw new MissingProvideError('Auth', name);
    }

    if (useClass) {
      if (!isClass(useClass)) {
        throw new InvalidUseClassError('auth', tokenName(provide));
      }
      return {
        kind: AuthProviderKind.CLASS,
        provide,
        useClass,
        metadata,
      };
    }

    if (useFactory) {
      if (typeof useFactory !== 'function') {
        throw new InvalidUseFactoryError('auth', tokenName(provide));
      }
      const inj = typeof inject === 'function' ? inject : () => [] as const;
      return {
        kind: AuthProviderKind.FACTORY,
        provide,
        inject: inj,
        useFactory,
        metadata,
      };
    }

    if ('useValue' in item) {
      return {
        kind: AuthProviderKind.VALUE,
        provide,
        useValue,
        metadata,
      };
    }
  }

  const name = (item as any)?.name ?? String(item);
  throw new InvalidEntityError('auth', name, 'a class or an auth object');
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - VALUE: no deps
 * - FACTORY: only includes deps that are registered (others will be resolved)
 * - CLASS / CLASS_TOKEN: deps come from the class constructor or static with(...)
 */
export function authDiscoveryDeps(rec: AuthProviderRecord): Token[] {
  switch (rec.kind) {
    case AuthProviderKind.VALUE:
    case AuthProviderKind.PRIMARY:
      return [];

    case AuthProviderKind.FACTORY: {
      return [...rec.inject()];
    }
    case AuthProviderKind.CLASS:
      return depsOfClass(rec.useClass, 'discovery');

    case AuthProviderKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}
