import { HeartbeatService, type HeartbeatRedisClient } from '../heartbeat.service';

function createMockRedis(): HeartbeatRedisClient & { store: Map<string, { value: string; expiresAt: number }> } {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _mode: string, ttlMs: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    del: jest.fn(async (key: string) => {
      return store.delete(key) ? 1 : 0;
    }),
    exists: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return 0;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return 0;
      }
      return 1;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    }),
  };
}

describe('HeartbeatService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should write heartbeat on start', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();

    expect(redis.set).toHaveBeenCalledWith('mcp:ha:heartbeat:pod-a', expect.any(String), 'PX', 30_000);

    await service.stop();
  });

  it('should write heartbeat with correct value shape', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();

    const stored = redis.store.get('mcp:ha:heartbeat:pod-a');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!.value);
    expect(parsed.nodeId).toBe('pod-a');
    expect(parsed.startedAt).toBeGreaterThan(0);
    expect(parsed.lastBeat).toBeGreaterThan(0);
    expect(parsed.sessionCount).toBe(0);

    await service.stop();
  });

  it('should update session count', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.setSessionCount(5);
    service.start();

    const stored = redis.store.get('mcp:ha:heartbeat:pod-a');
    const parsed = JSON.parse(stored!.value);
    expect(parsed.sessionCount).toBe(5);

    await service.stop();
  });

  it('should delete heartbeat on stop', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();
    expect(redis.store.has('mcp:ha:heartbeat:pod-a')).toBe(true);

    await service.stop();
    expect(redis.del).toHaveBeenCalledWith('mcp:ha:heartbeat:pod-a');
  });

  it('should detect alive nodes', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();

    expect(await service.isAlive('pod-a')).toBe(true);
    expect(await service.isAlive('pod-b')).toBe(false);

    await service.stop();
  });

  it('should list alive nodes', async () => {
    const redis = createMockRedis();
    const serviceA = new HeartbeatService(redis, 'pod-a');
    const serviceB = new HeartbeatService(redis, 'pod-b');
    serviceA.start();
    serviceB.start();

    const alive = await serviceA.getAliveNodes();
    expect(alive).toContain('pod-a');
    expect(alive).toContain('pod-b');

    await serviceA.stop();
    await serviceB.stop();
  });

  it('should get heartbeat value', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();

    const hb = await service.getHeartbeat('pod-a');
    expect(hb).toBeDefined();
    expect(hb!.nodeId).toBe('pod-a');

    expect(await service.getHeartbeat('nonexistent')).toBeNull();

    await service.stop();
  });

  it('should use custom key prefix', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a', { redisKeyPrefix: 'custom:' });
    service.start();

    expect(redis.store.has('custom:heartbeat:pod-a')).toBe(true);

    await service.stop();
  });

  it('should not start twice', async () => {
    const redis = createMockRedis();
    const service = new HeartbeatService(redis, 'pod-a');
    service.start();
    service.start(); // Second call should be no-op

    expect(redis.set).toHaveBeenCalledTimes(1);

    await service.stop();
  });
});
