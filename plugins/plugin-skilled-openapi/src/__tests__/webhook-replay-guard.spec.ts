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

  it('rejects non-finite timestamps', () => {
    const guard = new WebhookReplayGuard();
    const r = guard.check({ timestampMs: Number.NaN, nonce: 'abcdefgh' });
    expect(r.ok).toBe(false);
  });

  it('rejects too-short nonces', () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1);
    const r = guard.check({ timestampMs: 1, nonce: 'tiny' });
    expect(r.ok).toBe(false);
  });

  it('LRU evicts the oldest entry when capacity is reached', () => {
    const guard = new WebhookReplayGuard({ capacity: 3 });
    const now = 1;
    guard.setNowProvider(() => now);
    guard.check({ timestampMs: now, nonce: 'aaaaaaaa' });
    guard.check({ timestampMs: now, nonce: 'bbbbbbbb' });
    guard.check({ timestampMs: now, nonce: 'cccccccc' });
    guard.check({ timestampMs: now, nonce: 'dddddddd' });
    expect(guard.size).toBe(3);
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

  it('different (ts, nonce) tuples do not collide', () => {
    const guard = new WebhookReplayGuard();
    guard.setNowProvider(() => 1_000);
    expect(guard.check({ timestampMs: 1_000, nonce: 'aaaa1111' }).ok).toBe(true);
    expect(guard.check({ timestampMs: 1_001, nonce: 'aaaa1111' }).ok).toBe(true);
  });
});
