/**
 * `frontmcp start --db`, `frontmcp socket --db` and the generated installer hand the database
 * location to the server as FRONTMCP_SQLITE_PATH. `bootstrap()` must fold it into `sqlite.path`
 * without dropping the other sqlite options the decorator set.
 */
import 'reflect-metadata';

import { LogLevel, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

type RunUnixSocket = (config: { sqlite?: { path?: string; walMode?: boolean } }) => Promise<void>;

describe('FrontMcpInstance.bootstrap FRONTMCP_SQLITE_PATH (#642)', () => {
  const saved = { sqlite: process.env['FRONTMCP_SQLITE_PATH'], socket: process.env['FRONTMCP_DAEMON_SOCKET'] };
  let captured: Array<{ sqlite?: { path?: string; walMode?: boolean } }>;

  beforeEach(() => {
    captured = [];
    // Diverting into the unix-socket branch stops bootstrap() right after it parses the config.
    process.env['FRONTMCP_DAEMON_SOCKET'] = '/tmp/frontmcp-test.sock';
    jest
      .spyOn(FrontMcpInstance as unknown as { runUnixSocket: RunUnixSocket }, 'runUnixSocket')
      .mockImplementation(async (cfg) => {
        captured.push(cfg);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['FRONTMCP_SQLITE_PATH', saved.sqlite],
      ['FRONTMCP_DAEMON_SOCKET', saved.socket],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const base = (extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput => ({
    info: { name: 'sqlite-env', version: '1.0.0' },
    apps: [],
    logging: { level: LogLevel.Off },
    ...extra,
  });

  it('uses the env var as sqlite.path when the config sets none', async () => {
    process.env['FRONTMCP_SQLITE_PATH'] = '/data/from-env.db';
    await FrontMcpInstance.bootstrap(base());
    expect(captured[0].sqlite?.path).toBe('/data/from-env.db');
  });

  it('overrides a configured path but keeps the other sqlite options', async () => {
    process.env['FRONTMCP_SQLITE_PATH'] = '/data/from-env.db';
    await FrontMcpInstance.bootstrap(base({ sqlite: { path: '/data/decorator.db', walMode: false } }));
    expect(captured[0].sqlite?.path).toBe('/data/from-env.db');
    expect(captured[0].sqlite?.walMode).toBe(false);
  });

  it('leaves the configured sqlite options untouched when the env var is unset', async () => {
    delete process.env['FRONTMCP_SQLITE_PATH'];
    await FrontMcpInstance.bootstrap(base({ sqlite: { path: '/data/decorator.db' } }));
    expect(captured[0].sqlite?.path).toBe('/data/decorator.db');
  });
});
