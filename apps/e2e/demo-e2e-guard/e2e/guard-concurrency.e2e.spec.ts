/**
 * E2E Tests for Guard — Concurrency Control
 *
 * Tests distributed semaphore behavior:
 * - Single execution succeeds
 * - Concurrent execution is rejected with zero queue timeout
 * - Sequential execution after completion succeeds
 * - Queued calls succeed when slots free in time
 * - Queued calls fail when slots don't free in time
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Guard Concurrency', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  // ── Mutex (maxConcurrent: 1, queueTimeoutMs: 0) ──

  test('should allow single execution', async ({ mcp }) => {
    const result = await mcp.tools.call('concurrency-mutex', { delayMs: 100 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('done');
  });

  test('should reject concurrent execution with zero queue timeout', async ({ server }) => {
    const client1 = await server.createClient();
    const client2 = await server.createClient();

    try {
      // Launch two calls: first holds the slot for 2s, second arrives 100ms later
      const [result1, result2] = await Promise.allSettled([
        client1.tools.call('concurrency-mutex', { delayMs: 2000 }),
        (async () => {
          await new Promise<void>((r) => setTimeout(r, 100));
          return client2.tools.call('concurrency-mutex', { delayMs: 100 });
        })(),
      ]);

      // First should succeed
      expect(result1.status).toBe('fulfilled');
      if (result1.status === 'fulfilled') {
        expect(result1.value).toBeSuccessful();
      }

      // Second should have an error (concurrency limit, queue:0 = immediate reject)
      if (result2.status === 'fulfilled') {
        expect(result2.value).toBeError();
      } else if (result2.status === 'rejected') {
        // Transport-level rejection is acceptable for concurrency limit
        expect(result2.reason).toBeDefined();
      }
    } finally {
      await client1.disconnect();
      await client2.disconnect();
    }
  });

  test('should allow sequential execution after completion', async ({ mcp }) => {
    const result1 = await mcp.tools.call('concurrency-mutex', { delayMs: 100 });
    expect(result1).toBeSuccessful();

    const result2 = await mcp.tools.call('concurrency-mutex', { delayMs: 100 });
    expect(result2).toBeSuccessful();
  });

  // ── Queued (maxConcurrent: 1, queueTimeoutMs: 3000) ──

  test('should queue and succeed when slot frees in time', async ({ server }) => {
    const client1 = await server.createClient();
    const client2 = await server.createClient();

    try {
      // First call holds slot for 500ms, second queues (3s timeout)
      const [result1, result2] = await Promise.allSettled([
        client1.tools.call('concurrency-queued', { delayMs: 500 }),
        (async () => {
          await new Promise<void>((r) => setTimeout(r, 100));
          return client2.tools.call('concurrency-queued', { delayMs: 100 });
        })(),
      ]);

      expect(result1.status).toBe('fulfilled');
      expect(result2.status).toBe('fulfilled');

      if (result1.status === 'fulfilled') {
        expect(result1.value).toBeSuccessful();
      }
      if (result2.status === 'fulfilled') {
        expect(result2.value).toBeSuccessful();
      }
    } finally {
      await client1.disconnect();
      await client2.disconnect();
    }
  });

  test('should fail queued call when slot does not free in time', async ({ server }) => {
    const client1 = await server.createClient();
    const client2 = await server.createClient();

    try {
      // First call holds slot for 4.5s, second queues (3s timeout)
      const [result1, result2] = await Promise.allSettled([
        client1.tools.call('concurrency-queued', { delayMs: 4500 }),
        (async () => {
          await new Promise<void>((r) => setTimeout(r, 100));
          return client2.tools.call('concurrency-queued', { delayMs: 100 });
        })(),
      ]);

      // First should succeed (eventually)
      expect(result1.status).toBe('fulfilled');
      if (result1.status === 'fulfilled') {
        expect(result1.value).toBeSuccessful();
      }

      // Second should have a queue timeout error
      if (result2.status === 'fulfilled') {
        expect(result2.value).toBeError();
      } else if (result2.status === 'rejected') {
        // Transport-level rejection is acceptable for queue timeout
        expect(result2.reason).toBeDefined();
      }
    } finally {
      await client1.disconnect();
      await client2.disconnect();
    }
  });
});
