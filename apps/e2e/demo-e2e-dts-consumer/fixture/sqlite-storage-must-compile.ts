import 'reflect-metadata';

import {
  App,
  createContainer,
  FrontMcp,
  sqliteStorageProvider,
  SqliteStorageToken,
  type SqliteStorageProviderOptions,
} from '@frontmcp/sdk';

const options: SqliteStorageProviderOptions = {
  path: '/var/lib/counter/state.sqlite',
  walMode: true,
  busyTimeoutMs: 10_000,
  prefix: 'counter:',
};

@App({ name: 'counter' })
class CounterApp {}

@FrontMcp({
  info: { name: 'sqlite-storage', version: '1.0.0' },
  apps: [CounterApp],
  providers: [sqliteStorageProvider(options)],
})
export class SqliteStorageServer {}

// @ts-expect-error the database file's path is required
sqliteStorageProvider({ walMode: true });

// @ts-expect-error walMode is a boolean
sqliteStorageProvider({ path: '/var/lib/counter/state.sqlite', walMode: 'yes' });

export async function countVisit(): Promise<number> {
  const container = await createContainer({ providers: [sqliteStorageProvider(options)] });
  try {
    const visits: number = await container.get(SqliteStorageToken).incr('visits');
    return visits;
  } finally {
    await container.dispose();
  }
}
