/**
 * The store settings a build recorded without validating them (#1041) are validated where a server starts: by the
 * CLI host's lite schema and by the server's full schema, before any store opens.
 */
import 'reflect-metadata';

import { App, FrontMcp, getDecoratorConfig, LogLevel, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';
import { FrontMcpInstance } from '../front-mcp';

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

const unset = process.env['BUILD_EXTRACT_STORES_UNSET_VAR'] as string;
const sqlitePath = '/tmp/frontmcp-build-extract-stores.sqlite';

/** A server class as the build records it: loaded with the build's flags, which are then cleared. */
function readByBuild(stores: Record<string, unknown>): abstract new (...args: never[]) => unknown {
  process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
  process.env['FRONTMCP_BUILD_EXTRACT'] = '1';
  try {
    @FrontMcp({
      info: { name: 'build-extract-stores', version: '1.0.0' },
      apps: [EmptyApp],
      logging: { level: LogLevel.Off },
      ...stores,
    } as never)
    class Server {}
    return Server;
  } finally {
    delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
    delete process.env['FRONTMCP_BUILD_EXTRACT'];
  }
}

const unsetStores: Array<[string, Record<string, unknown>]> = [
  ['redis', { redis: { url: unset } }],
  ['sqlite', { sqlite: { path: sqlitePath, encryption: { secret: unset } } }],
  ['jobs.store', { jobs: { enabled: true, store: { redis: { url: unset } } } }],
  ['tasks.redis', { tasks: { redis: { url: unset } } }],
  ['tasks.sqlite', { tasks: { sqlite: { path: sqlitePath, encryption: { secret: unset } } } }],
];

describe('store settings a build recorded unvalidated', () => {
  it.each(unsetStores)('stop the CLI host on an unset %s', async (_store, stores) => {
    await expect(connect(readByBuild(stores) as unknown as FrontMcpConfigInput, { mode: 'cli' })).rejects.toThrow();
  });

  it.each([...unsetStores, ['transport.persistence', { transport: { persistence: { redis: { url: unset } } } }]])(
    'stop the server on an unset %s',
    async (_store, stores) => {
      const recorded = getDecoratorConfig(readByBuild(stores as Record<string, unknown>));

      await expect(FrontMcpInstance.bootstrap({ ...recorded, serve: false } as never)).rejects.toThrow();
    },
  );
});
