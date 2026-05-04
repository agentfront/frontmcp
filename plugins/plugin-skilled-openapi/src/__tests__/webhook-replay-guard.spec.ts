import { WebhookReplayGuard } from '../security/webhook-replay-guard';

describe('WebhookReplayGuard', () => {
  it('accepts a fresh nonce inside the window', () => {
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000_000);
    const r = guard.check({ timestampMs: 1_000_000, nonce: 'abc12345' });
    expect(r.ok).toBe(true);
  });

  it('rejects nonce replay within the window', () => {
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000_000);
    const ok1 = guard.check({ timestampMs: 1_000_000, nonce: 'replay123' });
    const ok2 = guard.check({ timestampMs: 1_000_000, nonce: 'replay123' });
    expect(ok1.ok).toBe(true);
    expect(ok2.ok).toBe(false);
    expect(ok2.reason).toMatch(/replay/);
  });

  it('rejects timestamps outside the window', () => {
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    guard.setNowProvider(() => 1_000_000);
    const r = guard.check({ timestampMs: 1_000_000 - 60_000, nonce: 'oldnonce1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside/);
  });

  it('rejects non-finite timestamps (NaN, +Inf, -Inf)', () => {
    const guard = new WebhookReplayGuard();
    expect(guard.check({ timestampMs: Number.NaN, nonce: 'abcdefgh' }).ok).toBe(false);
    expect(guard.check({ timestampMs: Number.POSITIVE_INFINITY, nonce: 'abcdefgh' }).ok).toBe(false);
    expect(guard.check({ timestampMs: Number.NEGATIVE_INFINITY, nonce: 'abcdefgh' }).ok).toBe(false);
  });

  it('rejects too-short nonces', () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1);
    const r = guard.check({ timestampMs: 1, nonce: 'tiny' });
    expect(r.ok).toBe(false);
  });

  it('LRU drops the entry with the smallest expiresAt when capacity is reached', () => {
    // All four entries share the same timestamp (and therefore expiresAt), so
    // the eviction loop drops whichever was hit first by the iterator —
    // 'aaaaaaaa'. The remaining three plus the newly-inserted 'dddddddd'
    // saturate the 3-slot capacity. Verify the survivor set explicitly so the
    // test fails if eviction order regresses, instead of only asserting size.
    const guard = new WebhookReplayGuard({ capacity: 3 });
    const now = 1;
    guard.setNowProvider(() => now);
    guard.check({ timestampMs: now, nonce: 'aaaaaaaa' });
    guard.check({ timestampMs: now, nonce: 'bbbbbbbb' });
    guard.check({ timestampMs: now, nonce: 'cccccccc' });
    guard.check({ timestampMs: now, nonce: 'dddddddd' });
    expect(guard.size).toBe(3);
    // 'aaaaaaaa' was evicted — re-using it now must succeed.
    expect(guard.check({ timestampMs: now, nonce: 'aaaaaaaa' }).ok).toBe(true);
    // The most-recent insert remains tracked — replay must be rejected.
    // Re-checking 'aaaaaaaa' above re-inserted it (filling capacity again),
    // so checking 'dddddddd' here may itself trigger another eviction; we
    // just need to confirm 'dddddddd' is still treated as a known nonce.
    const replay = guard.check({ timestampMs: now, nonce: 'dddddddd' });
    expect(replay.ok).toBe(false);
  });

  it('prune drops expired entries', () => {
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    guard.setNowProvider(() => 1_000);
    guard.check({ timestampMs: 1_000, nonce: 'expirable' });
    guard.setNowProvider(() => 1_000_000);
    expect(guard.prune()).toBe(1);
    expect(guard.size).toBe(0);
  });

  it('default options work without overrides', () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1_000_000);
    expect(guard.check({ timestampMs: 1_000_000, nonce: 'defaultok' }).ok).toBe(true);
  });

  it('size getter reflects current map state and prune does not over-evict', () => {
    const guard = new WebhookReplayGuard({ windowMs: 10_000 });
    let now = 100;
    guard.setNowProvider(() => now);
    guard.check({ timestampMs: now, nonce: 'fresh111' });
    guard.check({ timestampMs: now, nonce: 'fresh222' });
    expect(guard.size).toBe(2);
    // Bump time within the window — prune should not drop anything.
    now = 105;
    expect(guard.prune()).toBe(0);
    expect(guard.size).toBe(2);
  });

  it('rejects nonce reuse even with a different in-window timestamp', () => {
    // Class contract: "the same nonce can't be replayed within the window".
    // Keying on (ts|nonce) would let an attacker reuse the nonce by varying
    // the timestamp — fix is to dedupe by nonce alone.
    const guard = new WebhookReplayGuard({ windowMs: 60_000 });
    guard.setNowProvider(() => 1_000);
    expect(guard.check({ timestampMs: 1_000, nonce: 'aaaa1111' }).ok).toBe(true);
    expect(guard.check({ timestampMs: 1_001, nonce: 'aaaa1111' }).ok).toBe(false);
  });

  it('rejects nonce replay at the freshness-window boundary', () => {
    // Regression: a nonce whose expiresAt equals `now` must still be treated
    // as tracked, otherwise an attacker can replay it at the exact boundary.
    const guard = new WebhookReplayGuard({ windowMs: 1_000 });
    let now = 1_000;
    guard.setNowProvider(() => now);
    expect(guard.check({ timestampMs: 1_000, nonce: 'boundary' }).ok).toBe(true);
    // Advance to exactly expiresAt (1_000 + 1_000 = 2_000). The nonce must
    // still be considered tracked at this tick.
    now = 2_000;
    const r = guard.check({ timestampMs: 2_000, nonce: 'boundary' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/replay/);
  });

  it('constructor rejects invalid windowMs and capacity', () => {
    expect(() => new WebhookReplayGuard({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ windowMs: -1 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ windowMs: Number.NaN })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: 0 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: 1.5 })).toThrow(RangeError);
    expect(() => new WebhookReplayGuard({ capacity: -3 })).toThrow(RangeError);
  });

  it('eviction drops the entry with the smallest expiresAt, not the oldest insertion', () => {
    // Mix in a stale-but-in-window timestamp so insertion order != expiry order.
    const guard = new WebhookReplayGuard({ capacity: 2, windowMs: 10_000 });
    guard.setNowProvider(() => 5_000);
    // Insert an entry with the EARLIEST expiry (timestampMs much older but
    // still within window — expiresAt = 1_000 + 10_000 = 11_000).
    guard.check({ timestampMs: 1_000, nonce: 'olderexp' });
    // Insert a fresher entry (expiresAt = 5_000 + 10_000 = 15_000).
    guard.check({ timestampMs: 5_000, nonce: 'newerexp' });
    // Hit capacity — should evict the entry with the smallest expiresAt,
    // i.e. 'olderexp', leaving 'newerexp' alive.
    guard.check({ timestampMs: 5_000, nonce: 'thirdval' });
    // Verify the survivor first: 'newerexp' is still tracked, so re-use is
    // rejected. (Doing this before re-checking 'olderexp' avoids re-triggering
    // capacity eviction, which would then drop one of the two survivors.)
    expect(guard.check({ timestampMs: 5_500, nonce: 'newerexp' }).ok).toBe(false);
    // 'olderexp' was evicted, so re-using it now should succeed.
    expect(guard.check({ timestampMs: 1_500, nonce: 'olderexp' }).ok).toBe(true);
  });
});
