import { HaManager } from '../ha-manager';

function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _mode: string, ttlMs: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt < Date.now()) return null;
      return entry.value;
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    exists: jest.fn(async (key: string) => {
      const entry = store.get(key);
      return entry && entry.expiresAt >= Date.now() ? 1 : 0;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    }),
    eval: jest.fn(async () => 0),
  };
}

describe('HaManager', () => {
  it('should throw when redis is missing', () => {
    expect(() =>
      HaManager.create({
        redis: undefined as never,
        nodeId: 'pod-a',
      }),
    ).toThrow('Distributed mode requires Redis');
  });

  it('should create successfully with redis', () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });
    expect(manager).toBeDefined();
    expect(manager.getNodeId()).toBe('pod-a');
    expect(manager.isStarted()).toBe(false);
  });

  it('should start and stop lifecycle', async () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });

    await manager.start();
    expect(manager.isStarted()).toBe(true);
    // Heartbeat should have written
    expect(redis.set).toHaveBeenCalled();

    await manager.stop();
    expect(manager.isStarted()).toBe(false);
    expect(redis.del).toHaveBeenCalled();
  });

  it('should not start twice', async () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });

    await manager.start();
    await manager.start(); // Should be no-op
    expect(redis.set).toHaveBeenCalledTimes(1);

    await manager.stop();
  });

  it('should check node liveness', async () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });
    await manager.start();

    expect(await manager.isNodeAlive('pod-a')).toBe(true);
    expect(await manager.isNodeAlive('nonexistent')).toBe(false);

    await manager.stop();
  });

  it('should update session count', async () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });
    manager.setSessionCount(10);
    await manager.start();

    const stored = redis.store.get('mcp:ha:heartbeat:pod-a');
    const parsed = JSON.parse(stored!.value);
    expect(parsed.sessionCount).toBe(10);

    await manager.stop();
  });

  it('should return undefined relay when pubsub not configured', () => {
    const redis = createMockRedis();
    const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });
    expect(manager.getRelay()).toBeUndefined();
  });

  it('should accept custom config', async () => {
    const redis = createMockRedis();
    const manager = HaManager.create({
      redis: redis as never,
      nodeId: 'pod-a',
      config: { heartbeatTtlMs: 5000, redisKeyPrefix: 'test:ha:' },
    });
    await manager.start();

    expect(redis.set).toHaveBeenCalledWith('test:ha:heartbeat:pod-a', expect.any(String), 'PX', 5000);

    await manager.stop();
  });

  it('should accept logger', async () => {
    const redis = createMockRedis();
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const manager = HaManager.create({
      redis: redis as never,
      nodeId: 'pod-a',
      logger,
    });
    await manager.start();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Heartbeat started'));

    await manager.stop();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Services stopped'));
  });
});
