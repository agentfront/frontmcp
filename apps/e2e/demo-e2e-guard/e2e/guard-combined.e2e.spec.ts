/**
 * E2E Tests for Guard — Combined Guards
 *
 * Tests that multiple guard types work together on a single tool:
 * - Rate limit + concurrency + timeout on combined-guard tool
 * - Each guard enforces independently
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Guard Combined — All Pass', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should succeed when all guards pass', async ({ mcp }) => {
    const result = await mcp.tools.call('combined-guard', { delayMs: 100 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('done');
  });
});

test.describe('Guard Combined — Rate Limit', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should enforce rate limit on combined tool', async ({ mcp }) => {
    // combined-guard allows 5 requests per 5 seconds
    for (let i = 0; i < 5; i++) {
      const result = await mcp.tools.call('combined-guard', { delayMs: 0 });
      expect(result).toBeSuccessful();
    }

    // 6th request should be rate-limited
    const result = await mcp.tools.call('combined-guard', { delayMs: 0 });
    expect(result).toBeError();
  });
});

test.describe('Guard Combined — Concurrency', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should enforce concurrency limit on combined tool', async ({ server }) => {
    // combined-guard: maxConcurrent: 2, queueTimeoutMs: 1000
    const client1 = await server.createClient();
    const client2 = await server.createClient();
    const client3 = await server.createClient();

    try {
      // Launch 3 parallel calls with 1500ms delay each
      // Max concurrent is 2, so 3rd must queue
      // Queue timeout is 1000ms, but first calls take 1500ms → 3rd should timeout
      const results = await Promise.allSettled([
        client1.tools.call('combined-guard', { delayMs: 1500 }),
        client2.tools.call('combined-guard', { delayMs: 1500 }),
        // Small delay to ensure first two get the slots
        (async () => {
          await new Promise<void>((r) => setTimeout(r, 100));
          return client3.tools.call('combined-guard', { delayMs: 100 });
        })(),
      ]);

      // First two should succeed
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
      if (results[0].status === 'fulfilled') {
        expect(results[0].value).toBeSuccessful();
      }
      if (results[1].status === 'fulfilled') {
        expect(results[1].value).toBeSuccessful();
      }

      // Third should have an error (queue timeout)
      if (results[2].status === 'fulfilled') {
        expect(results[2].value).toBeError();
      }
      // If rejected at transport level, that's also acceptable
    } finally {
      await client1.disconnect();
      await client2.disconnect();
      await client3.disconnect();
    }
  });
});

test.describe('Guard Combined — Timeout', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should enforce timeout on combined tool', async ({ mcp }) => {
    // combined-guard has 2000ms timeout, 3000ms delay exceeds it
    const result = await mcp.tools.call('combined-guard', { delayMs: 3000 });
    expect(result).toBeError();
    const text = JSON.stringify(result);
    expect(text.toLowerCase()).toMatch(/timeout|timed.out/i);
  });
});
