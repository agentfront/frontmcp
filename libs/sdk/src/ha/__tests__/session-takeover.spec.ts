import { attemptSessionTakeover, type TakeoverRedisClient } from '../session-takeover';

/**
 * Simulates Redis EVAL by interpreting the Lua CAS logic in JS.
 * This mirrors the Lua script behavior for unit testing.
 */
function createMockRedis(): TakeoverRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    eval: jest.fn(async (_script: string, _numkeys: number, ...args: (string | number)[]) => {
      const key = args[0] as string;
      const expectedOldNodeId = args[1] as string;
      const newNodeId = args[2] as string;
      const timestamp = args[3] as string;

      const raw = store.get(key);
      if (!raw) return 0;

      const data = JSON.parse(raw);

      // Check nodeId in nested or flat structure
      const currentNodeId = data.session?.nodeId ?? data.nodeId;
      if (currentNodeId !== expectedOldNodeId) return 0;

      // Update nodeId
      if (data.session) {
        data.session.nodeId = newNodeId;
      } else {
        data.nodeId = newNodeId;
      }
      data.reassignedAt = parseInt(timestamp, 10);
      data.reassignedFrom = expectedOldNodeId;

      store.set(key, JSON.stringify(data));
      return 1;
    }),
  };
}

describe('attemptSessionTakeover', () => {
  it('should claim a session with matching nodeId', async () => {
    const redis = createMockRedis();
    redis.store.set(
      'mcp:transport:sess1',
      JSON.stringify({
        session: { id: 'sess1', nodeId: 'dead-pod' },
      }),
    );

    const result = await attemptSessionTakeover(redis, 'mcp:transport:sess1', 'dead-pod', 'my-pod');

    expect(result.claimed).toBe(true);
    expect(result.previousNodeId).toBe('dead-pod');

    const updatedRaw = redis.store.get('mcp:transport:sess1');
    if (!updatedRaw) throw new Error('Expected session key "mcp:transport:sess1" to exist in store');
    const updated = JSON.parse(updatedRaw);
    expect(updated.session.nodeId).toBe('my-pod');
    expect(updated.reassignedFrom).toBe('dead-pod');
    expect(updated.reassignedAt).toBeGreaterThan(0);
  });

  it('should not claim a session already claimed by another pod', async () => {
    const redis = createMockRedis();
    redis.store.set(
      'mcp:transport:sess1',
      JSON.stringify({
        session: { id: 'sess1', nodeId: 'other-pod' },
      }),
    );

    const result = await attemptSessionTakeover(redis, 'mcp:transport:sess1', 'dead-pod', 'my-pod');

    expect(result.claimed).toBe(false);
    expect(result.previousNodeId).toBeUndefined();

    const unchangedRaw = redis.store.get('mcp:transport:sess1');
    if (!unchangedRaw) throw new Error('Expected session key "mcp:transport:sess1" to exist in store');
    const unchanged = JSON.parse(unchangedRaw);
    expect(unchanged.session.nodeId).toBe('other-pod');
  });

  it('should not claim a non-existent session', async () => {
    const redis = createMockRedis();

    const result = await attemptSessionTakeover(redis, 'mcp:transport:missing', 'dead-pod', 'my-pod');

    expect(result.claimed).toBe(false);
  });

  it('should handle flat nodeId structure', async () => {
    const redis = createMockRedis();
    redis.store.set(
      'mcp:transport:sess2',
      JSON.stringify({
        nodeId: 'dead-pod',
        data: 'some-data',
      }),
    );

    const result = await attemptSessionTakeover(redis, 'mcp:transport:sess2', 'dead-pod', 'my-pod');

    expect(result.claimed).toBe(true);
    const updatedRaw2 = redis.store.get('mcp:transport:sess2');
    if (!updatedRaw2) throw new Error('Expected session key "mcp:transport:sess2" to exist in store');
    const updated2 = JSON.parse(updatedRaw2);
    expect(updated2.nodeId).toBe('my-pod');
  });

  it('should be race-safe: first pod wins, second loses', async () => {
    const redis = createMockRedis();
    redis.store.set(
      'mcp:transport:sess1',
      JSON.stringify({
        session: { id: 'sess1', nodeId: 'dead-pod' },
      }),
    );

    // Simulate two pods racing
    const result1 = await attemptSessionTakeover(redis, 'mcp:transport:sess1', 'dead-pod', 'pod-b');
    const result2 = await attemptSessionTakeover(redis, 'mcp:transport:sess1', 'dead-pod', 'pod-c');

    // First wins
    expect(result1.claimed).toBe(true);
    // Second loses (nodeId is now 'pod-b', not 'dead-pod')
    expect(result2.claimed).toBe(false);

    const finalRaw = redis.store.get('mcp:transport:sess1');
    if (!finalRaw) throw new Error('Expected session key "mcp:transport:sess1" to exist in store');
    const final = JSON.parse(finalRaw);
    expect(final.session.nodeId).toBe('pod-b');
  });

  it('should NOT allow retaking when expectedOldNodeId mismatches stored nodeId', async () => {
    const redis = createMockRedis();
    redis.store.set(
      'mcp:transport:sess1',
      JSON.stringify({
        session: { id: 'sess1', nodeId: 'my-pod' },
      }),
    );

    // Trying to claim our own session (e.g., after restart with same MACHINE_ID)
    // This should fail because expectedOldNodeId doesn't match current
    const result = await attemptSessionTakeover(redis, 'mcp:transport:sess1', 'dead-pod', 'my-pod');
    expect(result.claimed).toBe(false);
  });
});
