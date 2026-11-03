import 'reflect-metadata';

import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import {
  App,
  FrontMcp,
  LogLevel,
  Provider,
  ProviderScope,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type FrontMcpMetadata,
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
    const tasksSqlitePath = path.join(dir, 'tasks.sqlite');

    const withRedis = await buildManifest(
      config({ redis: redisOptions, jobs: { enabled: true, store: { redis: redisOptions } } }),
    );
    const withTasksRedis = await buildManifest(config({ tasks: { enabled: true, redis: redisOptions } }));
    const withSqlite = await buildManifest(config({ sqlite: { path: sqlitePath } }));
    const withTasksSqlite = await buildManifest(
      config({ tasks: { enabled: true, sqlite: { path: tasksSqlitePath } } }),
    );

    for (const manifest of [withRedis, withTasksRedis, withSqlite, withTasksSqlite]) {
      expect(manifest.tools.map((tool) => tool.name)).toContain('stock');
    }
    expect(redis.connections()).toBe(0);
    expect(await fileExists(sqlitePath)).toBe(false);
    expect(await fileExists(tasksSqlitePath)).toBe(false);
  });

  const unset = process.env['MANIFEST_BOOT_UNSET_VAR'] as string;
  const unsetSqlitePath = path.join(os.tmpdir(), 'frontmcp-manifest-boot-unset.sqlite');

  it.each([
    ['redis', { redis: { url: unset } }],
    ['pubsub', { pubsub: { url: unset } }],
    ['sqlite', { sqlite: { path: unsetSqlitePath, encryption: { secret: unset } } }],
    ['jobs.store', { jobs: { enabled: true, store: { redis: { url: unset } } } }],
    ['tasks.redis', { tasks: { redis: { url: unset } } }],
    ['tasks.sqlite', { tasks: { sqlite: { path: unsetSqlitePath, encryption: { secret: unset } } } }],
  ])('reads a server whose %s takes an env var the build has not set', async (_store, stores) => {
    const manifest = await buildManifest(config(stores as Partial<FrontMcpConfigInput>));

    expect(manifest.tools.map((tool) => tool.name)).toContain('stock');
  });

  it('reads a @FrontMcp class whose stores take env vars the build has not set, and opens none of them', async () => {
    const redisUrl = `redis://127.0.0.1:${redis.port}`;
    const sqlitePath = path.join(dir, 'sessions.sqlite');
    process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
    process.env['FRONTMCP_BUILD_EXTRACT'] = '1';
    try {
      @FrontMcp(
        config({
          redis: { url: unset },
          sqlite: { path: sqlitePath, encryption: { secret: unset } },
          jobs: { enabled: true, store: { redis: { url: redisUrl } } },
          tasks: { enabled: true, redis: { url: redisUrl } },
          transport: { persistence: { redis: { url: redisUrl } } },
        }) as FrontMcpMetadata,
      )
      class Server {}

      const manifest = await buildManifest(Server);

      expect(manifest.tools.map((tool) => tool.name)).toContain('stock');
      expect(redis.connections()).toBe(0);
      expect(await fileExists(sqlitePath)).toBe(false);
    } finally {
      delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
      delete process.env['FRONTMCP_BUILD_EXTRACT'];
    }
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
