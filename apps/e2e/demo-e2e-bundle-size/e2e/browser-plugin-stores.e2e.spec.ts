/**
 * A browser has no TCP socket for Redis. In the browser build of create(), CachePlugin and RememberPlugin on
 * `global-store` would take the top-level `redis`: startup refuses them, naming `type: 'memory'`, and with
 * `type: 'memory'` the page starts with the top-level `redis` left in the config and opens no connection (#1033).
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-cache plugin-remember`.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { mkdtemp, rm } from '@frontmcp/utils';

import { bundleEntriesWithSharedChunks, fixtureDir } from './helpers/browser-bundle';

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

  it("starts with type: 'memory' while the config keeps the top-level redis", async () => {
    const startup = await start({ redis, cache: { type: 'memory' }, remember: { type: 'memory' } });

    expect(startup.error).toBeUndefined();
    expect(startup.result).toEqual(expect.objectContaining({ structuredContent: { value: 'Hello, FrontMCP' } }));
    expect(startup.stderr).not.toContain('WARN');
    expect(redisConnections).toBe(0);
  });
});
