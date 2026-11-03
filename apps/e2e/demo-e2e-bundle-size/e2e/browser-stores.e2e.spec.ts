/**
 * A browser has no TCP socket for Redis and no file for SQLite. The browser build of create() refuses at startup a
 * store that would open either, naming the option that turns it off; with `store: false` it starts in memory although
 * the config keeps a top-level `redis` and `sqlite`. Its bundle carries neither the Redis client nor the SQLite store.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import {
  bundleEntriesWithSharedChunks,
  bundleForBrowser,
  DEFAULT_CONFIG_MODULES,
  fixtureDir,
  leakedFeatures,
} from './helpers/browser-bundle';

const run = promisify(execFile);

const STORE_MODULES = [
  ...DEFAULT_CONFIG_MODULES,
  'job/job-scope.helper.mjs',
  'elicitation/store/elicitation-store.factory.mjs',
  'elicitation/questions/question-scope.helper.mjs',
];

const SERVER_STORE_PACKAGES: Record<string, RegExp> = {
  'Redis client': /(^|\/)node_modules\/(ioredis|@ioredis)\//,
  'SQLite store': /(^|\/)(libs\/storage-sqlite|node_modules\/(better-sqlite3|@frontmcp\/storage-sqlite))\//,
};

interface Startup {
  result?: unknown;
  error?: { name: string; code: string; message: string };
  stderr: string;
}

describe('stores in the browser build of create()', () => {
  let outDir: string;
  let bundle: string;
  let redisServer: Server;
  let redisConnections = 0;
  let redis: { host: string; port: number };
  let sqliteDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'frontmcp-browser-stores-'));
    await bundleEntriesWithSharedChunks({ stores: resolve(fixtureDir, 'greet-with-stores.ts') }, outDir);
    bundle = join(outDir, 'stores.mjs');
    sqliteDir = join(outDir, 'sqlite');
    redisServer = createServer((socket) => {
      redisConnections++;
      socket.destroy();
    });
    await new Promise<void>((listening) => redisServer.listen(0, '127.0.0.1', listening));
    redis = { host: '127.0.0.1', port: (redisServer.address() as { port: number }).port };
  });

  afterAll(async () => {
    await new Promise((closed) => redisServer.close(closed));
    await rm(outDir, { recursive: true, force: true });
  });

  async function start(options: Record<string, unknown>): Promise<Startup> {
    const { stdout, stderr } = await run(
      process.execPath,
      [resolve(__dirname, 'helpers/greet-with-stores.mjs'), bundle, JSON.stringify(options)],
      { encoding: 'utf8' },
    );
    return { ...(JSON.parse(stdout) as Omit<Startup, 'stderr'>), stderr };
  }

  async function expectNoStoreOpened(): Promise<void> {
    expect(redisConnections).toBe(0);
    expect(await fileExists(sqliteDir)).toBe(false);
  }

  it('refuses at startup the stores that would take the top-level redis, naming their switches', async () => {
    const startup = await start({
      redis,
      sqlite: { path: join(sqliteDir, 'state.sqlite') },
      elicitation: { enabled: true },
    });

    expect(startup.error).toMatchObject({ name: 'BrowserStoreUnavailableError', code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toContain('background tasks would use the top-level redis (set tasks.store: false');
    expect(startup.error?.message).toContain('elicitation would use the top-level redis (set elicitation.store: false');
    await expectNoStoreOpened();
  });

  it('refuses a SQLite named for jobs', async () => {
    const startup = await start({
      tasks: { store: false },
      jobs: { enabled: true, store: { sqlite: { path: join(sqliteDir, 'jobs.sqlite') } } },
    });

    expect(startup.error).toMatchObject({ code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toContain('jobs would use jobs.store.sqlite (set jobs.store: false');
    await expectNoStoreOpened();
  });

  it('refuses the stores a config names on Redis or SQLite, Vercel KV aside', async () => {
    const startup = await start({
      tasks: { store: false },
      throttle: { enabled: true, storage: { type: 'redis', redis: { config: redis }, fallback: 'error' } },
      skillsConfig: { cache: { enabled: true, redis: { provider: 'redis', ...redis } } },
    });

    expect(startup.error).toMatchObject({ code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toBe(
      'A browser cannot open Redis or SQLite: ' +
        "rate limits would use throttle.storage: { type: 'redis' } (set throttle.storage: { type: 'memory' } in place of throttle.storage: { type: 'redis' }); " +
        'the skills HTTP cache would use skillsConfig.cache.redis (set a skillsConfig.cache without redis in place of skillsConfig.cache.redis)',
    );
    await expectNoStoreOpened();

    const onVercelKv = await start({
      tasks: { store: false },
      skillsConfig: { cache: { enabled: true, redis: { provider: 'vercel-kv' } } },
    });
    expect(onVercelKv.error).toBeUndefined();
  });

  it('refuses a secure store that a local auth keeps on SQLite', async () => {
    const startup = await start({
      tasks: { store: false },
      auth: { mode: 'local', secureStore: { sqlite: { path: join(sqliteDir, 'secrets.sqlite') } } },
    });

    expect(startup.error).toMatchObject({ code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toContain(
      "the secure store would use auth.secureStore.sqlite (set auth.secureStore: 'memory' in place of auth.secureStore.sqlite)",
    );
    await expectNoStoreOpened();
  });

  it('starts in memory with store: false while the config keeps the top-level redis and sqlite', async () => {
    const startup = await start({
      redis,
      sqlite: { path: join(sqliteDir, 'state.sqlite') },
      tasks: { store: false },
      elicitation: { enabled: true, store: false },
      jobs: { enabled: true, store: false },
    });

    expect(startup.error).toBeUndefined();
    expect(startup.result).toEqual(expect.objectContaining({ structuredContent: { value: 'Hello, FrontMCP' } }));
    expect(startup.stderr).not.toContain('WARN');
    await expectNoStoreOpened();
  });

  it("starts rate limits on per-instance counters with fallback: 'memory', opening no Redis, and says so once", async () => {
    const startup = await start({
      tasks: { store: false },
      throttle: { enabled: true, storage: { type: 'redis', redis: { config: redis }, fallback: 'memory' } },
    });

    expect(startup.error).toBeUndefined();
    expect(startup.result).toEqual(expect.objectContaining({ structuredContent: { value: 'Hello, FrontMCP' } }));
    expect(
      startup.stderr.match(/A browser cannot open Redis or SQLite: rate limits use per-instance counters/g),
    ).toHaveLength(1);
    await expectNoStoreOpened();
  });

  it('bundles neither the Redis client nor the SQLite store, with every store module loaded', async () => {
    const storesBundle = await bundleForBrowser(resolve(fixtureDir, 'create-tool.ts'), STORE_MODULES);

    expect([...leakedFeatures(storesBundle.metafile, SERVER_STORE_PACKAGES).keys()]).toEqual([]);
  });
});
