/**
 * Memory Leak Detection Tests for Redis Integration
 *
 * Tests memory leak detection on repeated Redis operations
 *
 * Note: These tests require a Redis instance running locally.
 * Skip if Redis is not available by setting SKIP_REDIS_TESTS=1
 */
import { perfTest, expect } from '@frontmcp/testing';

const SKIP_REDIS = process.env['SKIP_REDIS_TESTS'] === '1';

perfTest.describe('Redis Leak Detection', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    project: 'demo-e2e-redis',
    publicMode: true,
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('no memory leak on repeated session operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        const key = `leak-test-${counter++}`;
        await mcp.tools.call('set-session-data', {
          key,
          value: `value-${counter}`,
        });
        await mcp.tools.call('get-session-data', { key });
      },
      {
        iterations: 30,
        threshold: 10 * 1024 * 1024,
        warmupIterations: 5,
      },
    );

    expect(result.growthRate).toBeLessThan(500 * 1024);
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('no memory leak on repeated vault operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        const key = `vault-leak-${counter++}`;
        await mcp.tools.call('vault-store', {
          key,
          value: JSON.stringify({ counter }),
        });
        await mcp.tools.call('vault-retrieve', { key });
      },
      {
        iterations: 30,
        threshold: 10 * 1024 * 1024,
        warmupIterations: 5,
      },
    );

    expect(result.growthRate).toBeLessThan(500 * 1024);
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('no memory leak with mixed operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        const key = `mixed-${counter++ % 10}`;

        // Mix of session and vault operations
        if (counter % 3 === 0) {
          await mcp.tools.call('vault-store', { key, value: 'test' });
        } else if (counter % 3 === 1) {
          await mcp.tools.call('set-session-data', { key, value: 'test' });
        } else {
          await mcp.tools.call('get-session-data', { key });
        }
      },
      {
        iterations: 45, // Divisible by 3 for even distribution
        threshold: 10 * 1024 * 1024,
        warmupIterations: 6,
      },
    );

    expect(result.growthRate).toBeLessThan(500 * 1024);
  });
});
