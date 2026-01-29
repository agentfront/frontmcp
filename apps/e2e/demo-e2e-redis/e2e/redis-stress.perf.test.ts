/**
 * Sequential Stress Tests for Redis Integration (1000 iterations)
 *
 * Tests Redis system under sustained sequential load
 *
 * Note: These tests require a Redis instance running locally.
 * Skip if Redis is not available by setting SKIP_REDIS_TESTS=1
 */
import { perfTest, expect } from '@frontmcp/testing';

const SKIP_REDIS = process.env['SKIP_REDIS_TESTS'] === '1';

perfTest.describe('Redis Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    project: 'demo-e2e-redis',
    publicMode: true,
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('stress test: 1000 session set/get operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        const key = `stress-session-${counter++}`;
        await mcp.tools.call('set-session-data', {
          key,
          value: `stress-value-${counter}`,
        });
        await mcp.tools.call('get-session-data', { key });
      },
      {
        iterations: 1000,
        threshold: 150 * 1024 * 1024, // 150MB for 1000 iterations (Redis overhead)
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] session set/get: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 300KB/iter for Redis operations)
    expect(result.growthRate).toBeLessThan(300 * 1024);
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)(
    'stress test: 1000 vault store/retrieve operations',
    async ({ mcp, perf }) => {
      let counter = 0;
      const result = await perf.checkLeak(
        async () => {
          const key = `stress-vault-${counter++}`;
          await mcp.tools.call('vault-store', {
            key,
            value: JSON.stringify({ counter, timestamp: Date.now() }),
          });
          await mcp.tools.call('vault-retrieve', { key });
        },
        {
          iterations: 1000,
          threshold: 150 * 1024 * 1024, // 150MB
          warmupIterations: 20,
          intervalSize: 100,
        },
      );

      console.log(
        `[STRESS] vault store/retrieve: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
      );

      expect(result.growthRate).toBeLessThan(300 * 1024);
    },
  );

  (SKIP_REDIS ? perfTest.skip : perfTest)('stress test: 1000 session reads (same key)', async ({ mcp, perf }) => {
    // Set up data first
    await mcp.tools.call('set-session-data', {
      key: 'stress-read-key',
      value: 'stress-read-value',
    });

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('get-session-data', {
          key: 'stress-read-key',
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB - reads should be lighter
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] session reads: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('stress test: 1000 mixed Redis operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = counter++ % 4;
        const key = `stress-mixed-${counter % 100}`; // Rotate through 100 keys

        if (op === 0) {
          await mcp.tools.call('set-session-data', { key, value: `v-${counter}` });
        } else if (op === 1) {
          await mcp.tools.call('get-session-data', { key });
        } else if (op === 2) {
          await mcp.tools.call('vault-store', { key, value: JSON.stringify({ c: counter }) });
        } else {
          await mcp.tools.call('vault-retrieve', { key });
        }
      },
      {
        iterations: 1000,
        threshold: 150 * 1024 * 1024, // 150MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] mixed Redis ops: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(300 * 1024);
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)('stress test: 1000 concurrent batch operations', async ({ mcp, perf }) => {
    let batchCounter = 0;
    const result = await perf.checkLeak(
      async () => {
        // Run 5 operations concurrently per iteration
        const batch = batchCounter++;
        await Promise.all([
          mcp.tools.call('set-session-data', { key: `batch-${batch}-0`, value: 'v0' }),
          mcp.tools.call('set-session-data', { key: `batch-${batch}-1`, value: 'v1' }),
          mcp.tools.call('set-session-data', { key: `batch-${batch}-2`, value: 'v2' }),
          mcp.tools.call('set-session-data', { key: `batch-${batch}-3`, value: 'v3' }),
          mcp.tools.call('set-session-data', { key: `batch-${batch}-4`, value: 'v4' }),
        ]);
      },
      {
        iterations: 200, // 200 batches x 5 = 1000 actual operations
        threshold: 150 * 1024 * 1024, // 150MB
        warmupIterations: 10,
        intervalSize: 20,
      },
    );

    console.log(
      `[STRESS] concurrent batches: ${result.requestsPerSecond?.toFixed(1)} batches/s (${(result.requestsPerSecond || 0) * 5} ops/s), ${result.samples.length * 5} total operations`,
    );

    expect(result.growthRate).toBeLessThan(500 * 1024); // Higher for concurrent ops
  });
});
