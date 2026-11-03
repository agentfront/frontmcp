/**
 * A browser has no TCP socket for Redis. In the browser build of create(), CachePlugin and RememberPlugin on
 * `global-store` would take the top-level `redis`: startup refuses them, naming `type: 'memory'`, in the one error that
 * lists the server's own stores too, and with `type: 'memory'` the page starts with the top-level `redis` left in the
 * config and opens no connection (#1033). The page bundle carries no Redis client.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-cache plugin-remember`.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { mkdtemp, rm } from '@frontmcp/utils';

import {
  bundleEntriesWithSharedChunks,
  bundleForBrowser,
  DEFAULT_CONFIG_MODULES,
  fixtureDir,
  importChain,
  leakedFeatures,
} from './helpers/browser-bundle';

const run = promisify(execFile);

interface Startup {
  result?: unknown;
  error?: { name: string; code: string; message: string };
  stderr: string;
}

describe('plugin stores in the browser build of create()', () => {
  let outDir: string;
  let bundle: string;
  let redisServer: Server;
  let redisConnections = 0;
  let redis: { host: string; port: number };

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'frontmcp-browser-plugin-stores-'));
    await bundleEntriesWithSharedChunks(
      { 'plugin-stores': resolve(fixtureDir, 'greet-with-plugin-stores.ts') },
      outDir,
      { nodeRequire: true },
    );
    bundle = join(outDir, 'plugin-stores.mjs');
    redisServer = createServer((socket) => {
      redisConnections++;
      socket.destroy();
    });
    await new Promise<void>((listening) => redisServer.listen(0, '127.0.0.1', listening));
    redis = { host: '127.0.0.1', port: (redisServer.address() as { port: number }).port };
  });

  beforeEach(() => {
    redisConnections = 0;
  });

  afterAll(async () => {
    await new Promise((closed) => redisServer.close(closed));
    await rm(outDir, { recursive: true, force: true });
  });

  async function start(options: Record<string, unknown>): Promise<Startup> {
    const { stdout, stderr } = await run(
      process.execPath,
      [
        resolve(__dirname, 'helpers/greet-with-stores.mjs'),
        bundle,
        JSON.stringify({ tasks: { store: false }, ...options }),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    return { ...(JSON.parse(stdout) as Omit<Startup, 'stderr'>), stderr };
  }

  it.each([
    ['CachePlugin', 'cache'],
    ['RememberPlugin', 'remember'],
  ])('refuses %s on global-store at startup, naming type: memory', async (plugin, key) => {
    const startup = await start({ redis, [key]: { type: 'global-store' } });

    expect(startup.error).toMatchObject({ name: 'BrowserStoreUnavailableError', code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toContain(
      `${plugin} would use type: 'global-store' (set type: 'memory' in place of type: 'global-store')`,
    );
    expect(redisConnections).toBe(0);
  });

  it("lists the plugins' stores with the server's in one refusal", async () => {
    const startup = await start({
      redis,
      tasks: {},
      cache: { type: 'global-store' },
      remember: { type: 'redis', config: redis },
    });

    expect(startup.error).toMatchObject({ name: 'BrowserStoreUnavailableError', code: 'BROWSER_STORE_UNAVAILABLE' });
    expect(startup.error?.message).toBe(
      'A browser cannot open Redis or SQLite: background tasks would use the top-level redis ' +
        '(set tasks.store: false for memory, or leave redis out of the browser build); ' +
        "CachePlugin would use type: 'global-store' (set type: 'memory' in place of type: 'global-store'); " +
        "RememberPlugin would use type: 'redis' (set type: 'memory' in place of type: 'redis')",
    );
    expect(redisConnections).toBe(0);
  });

  it("starts with type: 'memory' while the config keeps the top-level redis", async () => {
    const startup = await start({ redis, cache: { type: 'memory' }, remember: { type: 'memory' } });

    expect(startup.error).toBeUndefined();
    expect(startup.result).toEqual(expect.objectContaining({ structuredContent: { value: 'Hello, FrontMCP' } }));
    expect(startup.stderr).not.toContain('WARN');
    expect(redisConnections).toBe(0);
  });

  it('bundles no Redis client in a page with CachePlugin and RememberPlugin', async () => {
    const page = await bundleForBrowser(resolve(fixtureDir, 'greet-with-plugin-stores.ts'), DEFAULT_CONFIG_MODULES);
    process.stdout.write(
      `create() + CachePlugin + RememberPlugin + one tool: ${page.bytes.toLocaleString('en-US')} bytes\n`,
    );

    const leaks = leakedFeatures(page.metafile, { 'Redis client': /(^|\/)node_modules\/(ioredis|@ioredis)\// });
    const chains = [...leaks.values()].map(([input]) => importChain(page.metafile, page.entryInput, input));
    expect(chains).toEqual([]);
  });
});
