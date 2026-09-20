/**
 * Clients without a resolvable IP must not share one rate-limit bucket
 * (GHSA-p3qf-fcwm-35x4).
 *
 * `partitionBy: 'ip'` resolved to `ctx.clientIp ?? 'unknown-ip'`. Every caller whose IP could
 * not be determined landed on the literal key `'unknown-ip'`, so they shared a single budget:
 * one client could exhaust it and 429 all the others. A rate limit that one tenant can spend
 * on another's behalf is a denial-of-service primitive, not a limit.
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
