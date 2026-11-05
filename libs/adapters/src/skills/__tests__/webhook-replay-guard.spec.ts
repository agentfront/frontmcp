import { createMemoryStorage } from '@frontmcp/utils';

import { MemoryReplayNonceStore, StorageReplayNonceStore } from '../security/replay-nonce-store';
import { WebhookReplayGuard } from '../security/webhook-replay-guard';

async function connectedMemoryStorage() {
  const storage = createMemoryStorage({ enableSweeper: false });
  await storage.connect();
  return storage;
}

describe('WebhookReplayGuard', () => {
  it('accepts a fresh nonce inside the window', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000_000);
    const r = await guard.check({ timestampMs: 1_000_000, nonce: 'abc12345' });
    expect(r.ok).toBe(true);
  });

  it('rejects nonce replay within the window', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000_000);
    const ok1 = await guard.check({ timestampMs: 1_000_000, nonce: 'replay123' });
    const ok2 = await guard.check({ timestampMs: 1_000_000, nonce: 'replay123' });
    expect(ok1.ok).toBe(true);
    expect(ok2.ok).toBe(false);
    expect(ok2.reason).toMatch(/replay/);
  });

  it('names each rejection with a code', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    guard.setNowProvider(() => 1_000_000);
    await guard.check({ timestampMs: 1_000_000, nonce: 'seen-nonce' });

    const codes = [
      (await guard.check({ timestampMs: Number.NaN, nonce: 'nonce-0001' })).code,
      (await guard.check({ timestampMs: 1_000_000, nonce: 'short' })).code,
      (await guard.check({ timestampMs: 1_000_000 - 60_000, nonce: 'nonce-0002' })).code,
      (await guard.check({ timestampMs: 1_000_000, nonce: 'seen-nonce' })).code,
    ];

    expect(codes).toEqual(['invalid_timestamp', 'invalid_nonce', 'outside_window', 'nonce_replay']);
  });

  it('rejects timestamps outside the window', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    guard.setNowProvider(() => 1_000_000);
    const r = await guard.check({ timestampMs: 1_000_000 - 60_000, nonce: 'oldnonce1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside/);
  });

  it('rejects non-finite timestamps (NaN, +Inf, -Inf)', async () => {
    const guard = new WebhookReplayGuard();
    expect((await guard.check({ timestampMs: Number.NaN, nonce: 'abcdefgh' })).ok).toBe(false);
    expect((await guard.check({ timestampMs: Number.POSITIVE_INFINITY, nonce: 'abcdefgh' })).ok).toBe(false);
    expect((await guard.check({ timestampMs: Number.NEGATIVE_INFINITY, nonce: 'abcdefgh' })).ok).toBe(false);
  });

  it('rejects too-short nonces', async () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1);
    const r = await guard.check({ timestampMs: 1, nonce: 'tiny' });
    expect(r.ok).toBe(false);
  });

  it('default options work without overrides', async () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1_000_000);
    expect((await guard.check({ timestampMs: 1_000_000, nonce: 'defaultok' })).ok).toBe(true);
  });

  it('rejects nonce reuse even with a different in-window timestamp', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000);
    expect((await guard.check({ timestampMs: 1_000, nonce: 'aaaa1111' })).ok).toBe(true);
    expect((await guard.check({ timestampMs: 1_001, nonce: 'aaaa1111' })).ok).toBe(false);
  });

  it('rejects nonce replay at the freshness-window boundary', async () => {
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    let now = 1_000;
    guard.setNowProvider(() => now);
    expect((await guard.check({ timestampMs: 1_000, nonce: 'boundary' })).ok).toBe(true);
    now = 2_000;
    const r = await guard.check({ timestampMs: 2_000, nonce: 'boundary' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/replay/);
  });

  it('keeps a nonce until its timestamp leaves the window, so a token issued ahead of the clock cannot be replayed', async () => {
    const claims: Array<{ key: string; ttlMs: number }> = [];
    const store = {
      claim: jest.fn(async (key: string, ttlMs: number) => {
        claims.push({ key, ttlMs });
        return true;
      }),
    };
    const guard = new WebhookReplayGuard({ windowMs: 60_000, store });
    guard.setNowProvider(() => 100_000);

    await guard.check({ timestampMs: 130_000, nonce: 'ahead-of-clock' });

    expect(claims).toEqual([{ key: expect.stringMatching(/^[0-9a-f]{64}$/), ttlMs: 90_000 }]);
  });

  it('constructor rejects invalid windowMs and capacity', () => {
    expect(() => new WebhookReplayGuard({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ windowMs: -1 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ windowMs: Number.NaN })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: 0 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: 1.5 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: -3 })).toThrow(RangeError);
  });

  describe('over a shared store', () => {
    it('refuses, in a second guard sharing the store, a nonce the first one accepted', async () => {
      const shared = new StorageReplayNonceStore(await connectedMemoryStorage());
      const firstReplica = new WebhookReplayGuard({ store: shared });
      const secondReplica = new WebhookReplayGuard({ store: shared });

      const first = await firstReplica.check({ timestampMs: Date.now(), nonce: 'shared-nonce' });
      const replayed = await secondReplica.check({ timestampMs: Date.now(), nonce: 'shared-nonce' });

      expect(first.ok).toBe(true);
      expect(replayed).toMatchObject({ ok: false, code: 'nonce_replay' });
    });

    it('accepts in each guard the nonces it alone saw, when the guards keep them in memory', async () => {
      const firstReplica = new WebhookReplayGuard();
      const secondReplica = new WebhookReplayGuard();

      await firstReplica.check({ timestampMs: Date.now(), nonce: 'per-process' });

      expect((await secondReplica.check({ timestampMs: Date.now(), nonce: 'per-process' })).ok).toBe(true);
    });

    it('refuses the nonce when the store fails, and accepts it once the store is back', async () => {
      const storage = await connectedMemoryStorage();
      const failingSet = jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('connection refused'));
      const guard = new WebhookReplayGuard({ store: new StorageReplayNonceStore(storage) });

      const whileDown = await guard.check({ timestampMs: Date.now(), nonce: 'store-down' });
      const onceBack = await guard.check({ timestampMs: Date.now(), nonce: 'store-down' });

      expect(whileDown).toEqual({
        ok: false,
        code: 'store_unavailable',
        reason: 'the replay store failed: connection refused',
      });
      expect(onceBack.ok).toBe(true);
      failingSet.mockRestore();
    });
  });

  describe('telemetry', () => {
    function makeFakeTelemetry(): {
      telemetry: {
        createCounter: (n: string, d?: string) => { inc: (by?: number, attrs?: Record<string, string>) => void };
      };
      counterCalls: { name: string; by: number; attributes: Record<string, string> }[];
    } {
      const counterCalls: { name: string; by: number; attributes: Record<string, string> }[] = [];
      return {
        counterCalls,
        telemetry: {
          createCounter(name) {
            return {
              inc(by = 1, attributes = {}) {
                counterCalls.push({ name, by, attributes });
              },
            };
          },
        },
      };
    }

    it('records checks_total{status=ok} on accepted nonce and skips the rejects counter', async () => {
      const { telemetry, counterCalls } = makeFakeTelemetry();
      const guard = new WebhookReplayGuard({ windowMs: 60_000, telemetry });
      guard.setNowProvider(() => 1_000_000);
      await guard.check({ timestampMs: 1_000_000, nonce: 'abcdefgh' });
      const rejects = counterCalls.filter((c) => c.name === 'frontmcp_skills_replay_rejects_total');
      const checks = counterCalls.filter((c) => c.name === 'frontmcp_skills_replay_checks_total');
      expect(rejects).toHaveLength(0);
      expect(checks).toHaveLength(1);
      expect(checks[0].attributes['status']).toBe('ok');
    });

    it.each([
      ['invalid_timestamp', { timestampMs: Number.NaN, nonce: 'abcdefgh' }],
      ['invalid_nonce', { timestampMs: 1_000_000, nonce: 'tiny' }],
      ['outside_window', { timestampMs: 1_000, nonce: 'abcdefgh' }],
    ])('increments with reason=%s', async (reason, check) => {
      const { telemetry, counterCalls } = makeFakeTelemetry();
      const guard = new WebhookReplayGuard({ windowMs: 1_000, telemetry });
      guard.setNowProvider(() => 1_000_000);
      await guard.check(check);
      expect(counterCalls[0].name).toBe('frontmcp_skills_replay_rejects_total');
      expect(counterCalls[0].attributes['reason']).toBe(reason);
    });

    it('increments with reason=nonce_replay when nonce is reused', async () => {
      const { telemetry, counterCalls } = makeFakeTelemetry();
      const guard = new WebhookReplayGuard({ windowMs: 60_000, telemetry });
      guard.setNowProvider(() => 1_000_000);
      await guard.check({ timestampMs: 1_000_000, nonce: 'replayed' });
      await guard.check({ timestampMs: 1_000_000, nonce: 'replayed' });
      const replayCalls = counterCalls.filter((c) => c.attributes['reason'] === 'nonce_replay');
      expect(replayCalls).toHaveLength(1);
    });

    it('increments with reason=store_unavailable when the store fails', async () => {
      const { telemetry, counterCalls } = makeFakeTelemetry();
      const store = { claim: jest.fn(async () => Promise.reject(new Error('down'))) };
      const guard = new WebhookReplayGuard({ telemetry, store });
      await guard.check({ timestampMs: Date.now(), nonce: 'abcdefgh' });
      expect(counterCalls[0].attributes['reason']).toBe('store_unavailable');
    });

    it('omitting telemetry keeps the guard dependency-free', async () => {
      const guard = new WebhookReplayGuard();
      guard.setNowProvider(() => 1);
      await expect(guard.check({ timestampMs: Number.NaN, nonce: 'aaaaaaaa' })).resolves.toMatchObject({ ok: false });
    });
  });

  describe('its default in-memory store', () => {
    it('drops the entry with the smallest expiry when capacity is reached', async () => {
      const guard = new WebhookReplayGuard({ capacity: 3 });
      guard.setNowProvider(() => 1);
      for (const nonce of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd']) {
        await guard.check({ timestampMs: 1, nonce });
      }
      expect((await guard.check({ timestampMs: 1, nonce: 'aaaaaaaa' })).ok).toBe(true);
      expect((await guard.check({ timestampMs: 1, nonce: 'dddddddd' })).ok).toBe(false);
    });

    it('drops the entry with the smallest expiry, not the oldest insertion', async () => {
      const guard = new WebhookReplayGuard({ capacity: 2, windowMs: 10_000 });
      guard.setNowProvider(() => 5_000);
      await guard.check({ timestampMs: 1_000, nonce: 'olderexp' });
      await guard.check({ timestampMs: 5_000, nonce: 'newerexp' });
      await guard.check({ timestampMs: 5_000, nonce: 'thirdval' });
      expect((await guard.check({ timestampMs: 5_500, nonce: 'newerexp' })).ok).toBe(false);
      expect((await guard.check({ timestampMs: 1_500, nonce: 'olderexp' })).ok).toBe(true);
    });
  });
});

describe('MemoryReplayNonceStore', () => {
  it('prune drops expired entries only', async () => {
    let now = 1_000;
    const store = new MemoryReplayNonceStore({ now: () => now });
    await store.claim('expiring', 1_000);
    await store.claim('lasting', 10_000);

    now = 1_500;
    expect(store.prune()).toBe(0);
    now = 2_001;
    expect(store.prune()).toBe(1);
    expect(store.size).toBe(1);
  });

  it('records a key again once it expired', async () => {
    let now = 0;
    const store = new MemoryReplayNonceStore({ now: () => now });

    const first = await store.claim('key', 1_000);
    const replayed = await store.claim('key', 1_000);
    now = 1_001;
    const afterExpiry = await store.claim('key', 1_000);

    expect([first, replayed, afterExpiry]).toEqual([true, false, true]);
  });

  it('rejects an invalid capacity', () => {
    expect(() => new MemoryReplayNonceStore({ capacity: 0 })).toThrow(RangeError);
  });
});
