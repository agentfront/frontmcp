/**
 * Issue #646 — the HA manager and transport bus were handed the raw `metadata.redis` config
 * object instead of an ioredis client. They now receive a real client that is closed on shutdown.
 */

import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const fakeClient = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  scan: jest.fn().mockResolvedValue(['0', []]),
  eval: jest.fn().mockResolvedValue(0),
  hset: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  expire: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue({}),
  publish: jest.fn().mockResolvedValue(0),
  subscribe: jest.fn().mockResolvedValue(1),
  unsubscribe: jest.fn().mockResolvedValue(1),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
  duplicate: jest.fn(),
};

const createRedisConnection = jest.fn((options: { client?: unknown }) => ({
  client: options.client ?? fakeClient,
  owned: options.client === undefined,
}));

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  createRedisConnection: (...args: unknown[]) => (createRedisConnection as (...a: unknown[]) => unknown)(...args),
}));

interface HaScope {
  haManager?: unknown;
  dispose(): Promise<void>;
  shutdown(): Promise<void>;
}

describe('Scope HA Redis client (#646)', () => {
  const originalMode = process.env['FRONTMCP_DEPLOYMENT_MODE'];
  const scopes: HaScope[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
  });

  afterEach(async () => {
    await Promise.all(scopes.splice(0).map((s) => s.dispose().catch(() => undefined)));
    if (originalMode === undefined) delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    else process.env['FRONTMCP_DEPLOYMENT_MODE'] = originalMode;
  });

  it('builds a real client from metadata.redis, hands it to the HA manager and closes it on shutdown', async () => {
    @App({ id: 'ha-client', name: 'ha-client' })
    class HaClientApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'ha-client', version: '0.0.0' },
      apps: [HaClientApp],
      redis: { host: 'redis.internal', port: 6380 },
      tasks: { enabled: false },
    });
    const [scope] = instance.getScopes() as unknown as HaScope[];
    scopes.push(scope);

    expect(createRedisConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'redis.internal', port: 6380, label: 'ha' }),
    );
    // A second connection carries the relay channel subscription.
    expect(createRedisConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'redis.internal', port: 6380, label: 'ha-subscriber' }),
    );
    expect(scope.haManager).toBeDefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fakeClient.subscribe).toHaveBeenCalledWith(expect.stringMatching(/^mcp:ha:notify:/));
    // Heartbeat wrote through the client, not through the config object.
    expect(fakeClient.set).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat'),
      expect.any(String),
      'PX',
      expect.any(Number),
    );

    await scope.shutdown();
    expect(fakeClient.quit).toHaveBeenCalledTimes(2);
  });

  it('runs without HA for Vercel KV instead of passing the config to HaManager', async () => {
    @App({ id: 'ha-kv', name: 'ha-kv' })
    class HaKvApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'ha-kv', version: '0.0.0' },
      apps: [HaKvApp],
      redis: { provider: 'vercel-kv' },
    });
    const [scope] = instance.getScopes() as unknown as HaScope[];
    scopes.push(scope);

    expect(createRedisConnection).not.toHaveBeenCalled();
    expect(scope.haManager).toBeUndefined();
  });

  it("runs HA on the app's own client, subscribing on a copy of it (#1503)", async () => {
    @App({ id: 'ha-own', name: 'ha-own' })
    class HaOwnApp {}

    const subscriber = { ...fakeClient, subscribe: jest.fn().mockResolvedValue(1), quit: jest.fn() };
    const appClient = {
      ...fakeClient,
      status: 'ready',
      isCluster: true,
      call: jest.fn(),
      sendCommand: jest.fn(),
      nodes: jest.fn(() => []),
      duplicate: jest.fn(() => subscriber),
      quit: jest.fn(),
    };

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'ha-own', version: '0.0.0' },
      apps: [HaOwnApp],
      redis: { client: appClient },
      tasks: { enabled: false },
    });
    const [scope] = instance.getScopes() as unknown as HaScope[];
    scopes.push(scope);

    expect(createRedisConnection).toHaveBeenCalledWith(expect.objectContaining({ client: appClient }));
    expect(appClient.duplicate).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(subscriber.subscribe).toHaveBeenCalledWith(expect.stringMatching(/^mcp:ha:notify:/));

    await scope.shutdown();
    // The copy is FrontMCP's to close; the app's client is not
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });
});
