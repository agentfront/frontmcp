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

  it("reports this node's liveness generation", async () => {
    const manager = HaManager.create({ redis: createMockRedis() as never, nodeId: 'pod-a' });
    await manager.start();

    expect(manager.livenessGeneration()).toBe(0);

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

  describe('relay channel', () => {
    function createPubSub() {
      return {
        subscribe: jest.fn().mockResolvedValue(1),
        unsubscribe: jest.fn().mockResolvedValue(1),
        publish: jest.fn().mockResolvedValue(1),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        removeListener: jest.fn(),
      };
    }

    it('publishes to another pod and reports how many pods received it', async () => {
      const pubsub = createPubSub();
      const manager = HaManager.create({
        redis: createMockRedis() as never,
        pubsubSubscriber: pubsub,
        pubsubPublisher: pubsub,
        nodeId: 'pod-a',
        config: { redisKeyPrefix: 'x:ha:' },
      });

      const received = await manager.publishToNode('pod-b', {
        kind: 'relay-cancel',
        requestId: 'r1',
        sourceNodeId: 'pod-a',
      });

      expect(received).toBe(1);
      expect(pubsub.publish).toHaveBeenCalledWith('x:ha:notify:pod-b', expect.stringContaining('"relay-cancel"'));
      expect(manager.relayChannelOf('pod-b')).toBe('x:ha:notify:pod-b');
    });

    it('reports no receivers when pub/sub is not configured', async () => {
      const manager = HaManager.create({ redis: createMockRedis() as never, nodeId: 'pod-a' });
      await expect(
        manager.publishToNode('pod-b', { kind: 'relay-cancel', requestId: 'r1', sourceNodeId: 'pod-a' }),
      ).resolves.toBe(0);
    });

    it('subscribes to its own channel only when pub/sub is configured', async () => {
      const pubsub = createPubSub();
      const withRelay = HaManager.create({
        redis: createMockRedis() as never,
        pubsubSubscriber: pubsub,
        pubsubPublisher: pubsub,
        nodeId: 'pod-a',
      });
      await withRelay.subscribeRelay(jest.fn());
      expect(pubsub.subscribe).toHaveBeenCalledWith('mcp:ha:notify:pod-a');

      const withoutRelay = HaManager.create({ redis: createMockRedis() as never, nodeId: 'pod-a' });
      await expect(withoutRelay.subscribeRelay(jest.fn())).resolves.toBeUndefined();
    });

    it('exposes the effective configuration', () => {
      const manager = HaManager.create({
        redis: createMockRedis() as never,
        nodeId: 'pod-a',
        config: { heartbeatTtlMs: 9000 },
      });
      expect(manager.getConfig()).toEqual(
        expect.objectContaining({ heartbeatTtlMs: 9000, heartbeatIntervalMs: 10_000 }),
      );
    });
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

  describe('orphan scanner', () => {
    it('should start the scanner without error', async () => {
      const redis = createMockRedis();
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a', logger });
      await manager.start();

      const onOrphan = jest.fn();
      manager.startOrphanScanner({
        sessionKeyPrefix: 'mcp:transport:',
        onOrphan,
      });

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Orphan scanner started'));

      await manager.stop();
    });

    it('should not start the scanner twice', async () => {
      const redis = createMockRedis();
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a', logger });
      await manager.start();

      const onOrphan = jest.fn();
      manager.startOrphanScanner({ sessionKeyPrefix: 'mcp:transport:', onOrphan });
      manager.startOrphanScanner({ sessionKeyPrefix: 'mcp:transport:', onOrphan });

      // Should only log once
      const scannerLogs = (logger.info as jest.Mock).mock.calls.filter(
        (c: string[]) => typeof c[0] === 'string' && c[0].includes('Orphan scanner started'),
      );
      expect(scannerLogs).toHaveLength(1);

      await manager.stop();
    });

    it('should stop scanner when manager stops', async () => {
      const redis = createMockRedis();
      const manager = HaManager.create({ redis: redis as never, nodeId: 'pod-a' });
      await manager.start();

      manager.startOrphanScanner({
        sessionKeyPrefix: 'mcp:transport:',
        onOrphan: jest.fn(),
      });

      await manager.stop();
      expect(manager.isStarted()).toBe(false);
    });

    it('should claim orphaned sessions via atomic takeover', async () => {
      const redis = createMockRedis();
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const manager = HaManager.create({
        redis: redis as never,
        nodeId: 'pod-b',
        logger,
        config: {
          heartbeatIntervalMs: 50,
          heartbeatTtlMs: 200,
          takeoverGracePeriodMs: 0,
        },
      });
      await manager.start();

      // Simulate an orphaned session owned by dead pod-a
      const sessionData = JSON.stringify({
        session: { id: 'sess-1', nodeId: 'pod-a', protocol: 'streamable-http' },
        authorizationId: 'hash123',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
      redis.store.set('mcp:transport:sess-1', { value: sessionData, expiresAt: Date.now() + 60_000 });

      // Mock eval to simulate successful CAS takeover
      redis.eval.mockResolvedValueOnce(1);

      const onOrphan = jest.fn();
      manager.startOrphanScanner({
        sessionKeyPrefix: 'mcp:transport:',
        onOrphan,
      });

      // Wait for initial delay (intervalMs + gracePeriodMs) + scan to run
      await new Promise((r) => setTimeout(r, 200));

      expect(onOrphan).toHaveBeenCalledWith('sess-1', 'pod-a', {
        protocol: 'streamable-http',
        authorizationId: 'hash123',
      });

      await manager.stop();
    });

    it('passes undefined claim details when the record does not carry them', async () => {
      const redis = createMockRedis();
      const manager = HaManager.create({
        redis: redis as never,
        nodeId: 'pod-b',
        config: { heartbeatIntervalMs: 50, heartbeatTtlMs: 200, takeoverGracePeriodMs: 0 },
      });
      await manager.start();

      redis.store.set('mcp:transport:sess-legacy', {
        value: JSON.stringify({ nodeId: 'pod-gone' }),
        expiresAt: Date.now() + 60_000,
      });
      redis.eval.mockResolvedValueOnce(1);

      const onOrphan = jest.fn();
      manager.startOrphanScanner({ sessionKeyPrefix: 'mcp:transport:', onOrphan });
      await new Promise((r) => setTimeout(r, 200));

      expect(onOrphan).toHaveBeenCalledWith('sess-legacy', 'pod-gone', {
        protocol: undefined,
        authorizationId: undefined,
      });
      await manager.stop();
    });

    it('should not claim sessions owned by alive nodes', async () => {
      const redis = createMockRedis();
      const manager = HaManager.create({
        redis: redis as never,
        nodeId: 'pod-b',
        config: {
          heartbeatIntervalMs: 50,
          heartbeatTtlMs: 200,
          takeoverGracePeriodMs: 0,
        },
      });
      await manager.start();

      // Simulate a session owned by pod-b (ourselves — alive)
      const sessionData = JSON.stringify({
        session: { id: 'sess-2', nodeId: 'pod-b', protocol: 'streamable-http' },
      });
      redis.store.set('mcp:transport:sess-2', { value: sessionData, expiresAt: Date.now() + 60_000 });

      const onOrphan = jest.fn();
      manager.startOrphanScanner({
        sessionKeyPrefix: 'mcp:transport:',
        onOrphan,
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(onOrphan).not.toHaveBeenCalled();

      await manager.stop();
    });
  });
});
