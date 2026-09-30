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
  keys: jest.fn().mockResolvedValue([]),
  eval: jest.fn().mockResolvedValue(0),
  hset: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  expire: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(0),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

const createRedisClient = jest.fn(() => fakeClient);

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  createRedisClient: (...args: unknown[]) => (createRedisClient as (...a: unknown[]) => unknown)(...args),
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

    expect(createRedisClient).toHaveBeenCalledWith(expect.objectContaining({ host: 'redis.internal', port: 6380 }));
    expect(scope.haManager).toBeDefined();
    // Heartbeat wrote through the client, not through the config object.
    expect(fakeClient.set).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat'),
      expect.any(String),
      'PX',
      expect.any(Number),
    );

    await scope.shutdown();
    expect(fakeClient.quit).toHaveBeenCalledTimes(1);
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

    expect(createRedisClient).not.toHaveBeenCalled();
    expect(scope.haManager).toBeUndefined();
  });
});
