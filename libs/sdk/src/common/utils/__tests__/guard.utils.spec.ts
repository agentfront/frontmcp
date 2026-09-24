import { ConcurrencyLimitError, createGuardManager, QueueTimeoutError, type GuardConfig } from '@frontmcp/guard';

import { acquireConcurrencySlots, buildPartitionContext } from '../guard.utils';

describe('buildPartitionContext', () => {
  it('keeps a real session and the signed-in user', () => {
    const context = buildPartitionContext({
      sessionId: 'session-1',
      metadata: { clientIp: '203.0.113.9' },
      authInfo: { clientId: 'user-1' },
    });

    expect(context).toEqual({ sessionId: 'session-1', clientIp: '203.0.113.9', userId: 'user-1' });
  });

  it('keys a per-request placeholder session by the signed-in user', () => {
    const context = buildPartitionContext({ sessionId: 'anon:1f2e', authInfo: { clientId: 'user-1' } });

    expect(context?.sessionId).toBe('user:user-1');
  });

  it('puts anonymous callers without a session in one shared partition, with no user id', () => {
    const context = buildPartitionContext({ sessionId: 'anon:1f2e', authInfo: { clientId: 'anon:3c4d' } });

    expect(context).toEqual({ sessionId: 'anonymous', clientIp: undefined, userId: undefined });
  });

  it('returns undefined without a request context', () => {
    expect(buildPartitionContext(undefined)).toBeUndefined();
  });
});

describe('acquireConcurrencySlots', () => {
  const managerWith = (config: Partial<GuardConfig>) => createGuardManager({ config: { enabled: true, ...config } });

  it('returns no ticket when no limit applies', async () => {
    const manager = await managerWith({});

    await expect(acquireConcurrencySlots(manager, 'tool', undefined, undefined)).resolves.toBeUndefined();
  });

  it('applies throttle.defaultConcurrency to an entity without its own limit', async () => {
    const manager = await managerWith({ defaultConcurrency: { maxConcurrent: 1 } });

    const first = await acquireConcurrencySlots(manager, 'tool', undefined, undefined);

    await expect(acquireConcurrencySlots(manager, 'tool', undefined, undefined)).rejects.toThrow(ConcurrencyLimitError);
    await first?.release();
    await expect(acquireConcurrencySlots(manager, 'tool', undefined, undefined)).resolves.toBeDefined();
  });

  it('shares throttle.globalConcurrency across entities, and one ticket releases both slots', async () => {
    const manager = await managerWith({ globalConcurrency: { maxConcurrent: 1 } });

    const first = await acquireConcurrencySlots(manager, 'tool-a', { maxConcurrent: 5 }, undefined);

    await expect(acquireConcurrencySlots(manager, 'tool-b', undefined, undefined)).rejects.toThrow(
      ConcurrencyLimitError,
    );
    await first?.release();
    await expect(acquireConcurrencySlots(manager, 'tool-b', undefined, undefined)).resolves.toBeDefined();
  });

  it('gives the global slot back when the entity limit is full', async () => {
    const manager = await managerWith({ globalConcurrency: { maxConcurrent: 2 } });
    await acquireConcurrencySlots(manager, 'tool-a', { maxConcurrent: 1 }, undefined);

    await expect(acquireConcurrencySlots(manager, 'tool-a', { maxConcurrent: 1 }, undefined)).rejects.toThrow(
      ConcurrencyLimitError,
    );

    await expect(acquireConcurrencySlots(manager, 'tool-b', undefined, undefined)).resolves.toBeDefined();
  });

  it('gives the global slot back when queueing for the entity limit times out', async () => {
    const manager = await managerWith({ globalConcurrency: { maxConcurrent: 2 } });
    const queued = { maxConcurrent: 1, queueTimeoutMs: 20 };
    await acquireConcurrencySlots(manager, 'tool-a', queued, undefined);

    await expect(acquireConcurrencySlots(manager, 'tool-a', queued, undefined)).rejects.toThrow(QueueTimeoutError);

    await expect(acquireConcurrencySlots(manager, 'tool-b', undefined, undefined)).resolves.toBeDefined();
  });
});
