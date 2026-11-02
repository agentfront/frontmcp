import type { Token } from '@frontmcp/di';
import { createStorage, type RootStorage, type SqliteAdapterOptions } from '@frontmcp/utils';

import { ProviderScope, type OnShutdown, type ProviderFactoryType } from '../common';

/** The SQLite storage `sqliteStorageProvider()` registers by default: `this.get(SqliteStorageToken)`. */
export const SqliteStorageToken: Token<RootStorage> = Symbol.for('frontmcp:storage.sqlite');

export interface SqliteStorageProviderOptions extends SqliteAdapterOptions {
  /** Prefix for every key this storage reads and writes. */
  prefix?: string;
  /** The token to register it under, to hold more than one. @default SqliteStorageToken */
  provide?: Token<RootStorage>;
}

/** A GLOBAL provider of a SQLite-backed storage, opened at boot and disconnected at shutdown. */
export function sqliteStorageProvider(
  options: SqliteStorageProviderOptions,
): ProviderFactoryType<RootStorage & OnShutdown, []> {
  const { prefix, provide = SqliteStorageToken, ...sqlite } = options;
  return {
    name: 'storage.sqlite',
    scope: ProviderScope.GLOBAL,
    provide,
    inject: () => [] as const,
    useFactory: async () => {
      const storage = await createStorage({ type: 'sqlite', sqlite, prefix, fallback: 'error' });
      return Object.assign(storage, { onShutdown: () => storage.disconnect() });
    },
  };
}
