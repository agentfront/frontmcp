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

describe('resolvePartitionKey — shared bucket for IP-less clients (GHSA-p3qf-fcwm-35x4)', () => {
  it('does not put two different IP-less sessions in the same bucket', () => {
    const first = resolvePartitionKey('ip', { sessionId: 'session-a' });
    const second = resolvePartitionKey('ip', { sessionId: 'session-b' });

    expect(first).not.toBe(second);
  });

  it('never resolves to the shared literal key', () => {
    expect(resolvePartitionKey('ip', { sessionId: 'session-a' })).not.toBe('unknown-ip');
  });

  it('is stable for the same session, so the limit still applies', () => {
    const first = resolvePartitionKey('ip', { sessionId: 'session-a' });
    const second = resolvePartitionKey('ip', { sessionId: 'session-a' });

    expect(first).toBe(second);
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
