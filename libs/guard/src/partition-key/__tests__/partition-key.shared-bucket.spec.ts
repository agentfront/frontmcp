/**
 * What `partitionBy: 'ip'` may key on when there is no IP (GHSA-p3qf-fcwm-35x4).
 *
 * Two invariants, and they pull against each other:
 *
 *  1. **A caller-controlled value can never mint a budget.** The `mcp-session-id` header is
 *     set by the caller, and a request without one is given a fresh UUID — key on it and
 *     every request gets its own limit, which is no limit at all.
 *  2. **Unidentified callers share one bucket, and that is deliberate.** They fall back to
 *     the authenticated user where there is one, and to a single `ip:unresolved` partition
 *     where there is not. That bucket is contended — one client can spend it on another's
 *     behalf — but it is bounded, and bounded contention is the correct trade against an
 *     unbounded budget. Resolving the real IP (`trustProxy`) is what takes callers out of it.
 */
import { resolvePartitionKey } from '../partition-key.resolver';

describe('resolvePartitionKey — IP partitioning (GHSA-p3qf-fcwm-35x4)', () => {
  it('never keys on the caller-controlled session id', () => {
    // `mcp-session-id` is set by the caller, and a request without one is given a fresh
    // UUID. Keying on it would hand every request its own budget.
    const first = resolvePartitionKey('ip', { sessionId: 'session-a' });
    const second = resolvePartitionKey('ip', { sessionId: 'session-b' });

    expect(first).not.toContain('session-a');
    expect(second).not.toContain('session-b');
    expect(first).toBe(second);
  });

  it('prefers the authenticated user when there is no IP', () => {
    const first = resolvePartitionKey('ip', { sessionId: 'session-a', userId: 'user-1' });
    const second = resolvePartitionKey('ip', { sessionId: 'session-b', userId: 'user-2' });

    expect(first).not.toBe(second);
    expect(first).toBe(resolvePartitionKey('ip', { sessionId: 'other-session', userId: 'user-1' }));
  });

  it('uses a fallback bucket that cannot collide with a real IP', () => {
    const key = resolvePartitionKey('ip', { sessionId: 'session-a' });

    expect(key).toBe('ip:unresolved');
    expect(key).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('still partitions by IP when one is available', () => {
    const key = resolvePartitionKey('ip', { sessionId: 'session-a', clientIp: '203.0.113.9' });

    expect(key).toBe('203.0.113.9');
  });

  it('gives the same IP the same bucket across sessions', () => {
    const first = resolvePartitionKey('ip', { sessionId: 'session-a', clientIp: '203.0.113.9' });
    const second = resolvePartitionKey('ip', { sessionId: 'session-b', clientIp: '203.0.113.9' });

    expect(first).toBe(second);
  });
});
