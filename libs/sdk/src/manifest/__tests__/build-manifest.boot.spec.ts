import 'reflect-metadata';

import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import {
  App,
  LogLevel,
  Provider,
  ProviderScope,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
} from '../../common';
import { connect } from '../../direct/connect';
import { buildManifest } from '../build-manifest';

const lifecycle: string[] = [];

@Provider({ name: 'warehouse', scope: ProviderScope.GLOBAL })
class Warehouse implements OnBootstrap, OnReady, OnShutdown {
  onBootstrap() {
    lifecycle.push('bootstrap');
  }
  onReady() {
    lifecycle.push('ready');
  }
  onShutdown() {
    lifecycle.push('shutdown');
  }
}

@Tool({ name: 'stock', description: 'Count the stock', inputSchema: { sku: z.string() } })
class StockTool extends ToolContext {
  async execute(input: { sku: string }) {
    return `plenty of ${input.sku}`;
  }
}

@App({ id: 'store', name: 'Store', tools: [StockTool] })
class StoreApp {}

/** A TCP server standing in for Redis that counts the connections it is offered. */
async function countingServer(): Promise<{ port: number; connections: () => number; close: () => Promise<void> }> {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    connections: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function config(extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'manifest-boot', version: '1.0.0' },
    apps: [StoreApp],
    providers: [Warehouse],
    logging: { level: LogLevel.Off },
    ...extra,
  } as FrontMcpConfigInput;
}

describe('buildManifest() boot', () => {
  let redis: Awaited<ReturnType<typeof countingServer>>;
  let dir: string;

  beforeEach(async () => {
    lifecycle.length = 0;
    redis = await countingServer();
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-manifest-boot-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await redis.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("connects to none of the config's stores and writes no database", async () => {
    const redisOptions = { provider: 'redis' as const, host: '127.0.0.1', port: redis.port };
    const sqlitePath = path.join(dir, 'sessions.sqlite');

    const withRedis = await buildManifest(
      config({ redis: redisOptions, jobs: { enabled: true, store: { redis: redisOptions } } }),
    );
    const withSqlite = await buildManifest(config({ sqlite: { path: sqlitePath } }));

    expect(withRedis.tools.map((tool) => tool.name)).toContain('stock');
    expect(withSqlite.tools.map((tool) => tool.name)).toContain('stock');
    expect(redis.connections()).toBe(0);
    expect(await fileExists(sqlitePath)).toBe(false);
  });

  it('reads a server whose redis url comes from an env var the build has not set (#1035)', async () => {
    const manifest = await buildManifest(
      config({ redis: { url: process.env['MANIFEST_BOOT_UNSET_REDIS_URL'] as string } }),
    );

    expect(manifest.tools.map((tool) => tool.name)).toContain('stock');
  });

  it('never listens or runs onReady, and shuts the providers down when done', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');

    await buildManifest(config({ http: { port: 0 } } as Partial<FrontMcpConfigInput>));

    expect(listen).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['bootstrap', 'shutdown']);
  });

  it('gives a manifest-mode connect() client, as the build reads the server with, the same boot', async () => {
    const client = await connect(config(), { mode: 'manifest' });
    const tools = await client.listTools();
    await client.close();

    expect(JSON.stringify(tools)).toContain('stock');
    expect(lifecycle).toEqual(['bootstrap', 'shutdown']);
  });
});
