/**
 * Parallel Stress Tests for Redis Integration (5 workers × 1000 iterations)
 *
 * Tests Redis system under parallel load using multiple clients
 * to achieve higher throughput (400-2000+ req/s)
 *
 * Note: These tests require a Redis instance running locally.
 * Skip if Redis is not available by setting SKIP_REDIS_TESTS=1
 */
import { perfTest, expect } from '@frontmcp/testing';

const SKIP_REDIS = process.env['SKIP_REDIS_TESTS'] === '1';

perfTest.describe('Redis Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    project: 'demo-e2e-redis',
    publicMode: true,
  });

  (SKIP_REDIS ? perfTest.skip : perfTest)(
    'parallel stress: 5000 total session set/get operations',
    async ({ mcp, perf, server }) => {
      const result = await perf.checkLeakParallel(
        (client, workerId) => {
          let counter = 0;
          return async () => {
            const key = `parallel-session-${workerId}-${counter++}`;
            await client.tools.call('set-session-data', { key, value: `value-${counter}` });
            await client.tools.call('get-session-data', { key });
          };
        },
        {
          iterations: 1000,
          workers: 5,
          threshold: 300 * 1024 * 1024, // 300MB for Redis parallel operations
          warmupIterations: 10,
          intervalSize: 200,
          clientFactory: () => server.createClient(),
        },
      );

      console.log(
        `[PARALLEL] session set/get: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
          `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
      );

      // 5 workers × ~80 req/s = ~400 req/s expected
      expect(result.totalRequestsPerSecond).toBeGreaterThan(150);
      expect(result.growthRate).toBeLessThan(300 * 1024);
    },
  );

  (SKIP_REDIS ? perfTest.skip : perfTest)(
    'parallel stress: 5000 total vault store/retrieve operations',
    async ({ mcp, perf, server }) => {
      const result = await perf.checkLeakParallel(
        (client, workerId) => {
          let counter = 0;
          return async () => {
            const key = `parallel-vault-${workerId}-${counter++}`;
            await client.tools.call('vault-store', {
              key,
              value: JSON.stringify({ counter, workerId, timestamp: Date.now() }),
            });
            await client.tools.call('vault-retrieve', { key });
          };
        },
        {
          iterations: 1000,
          workers: 5,
          threshold: 300 * 1024 * 1024,
          warmupIterations: 10,
          intervalSize: 200,
          clientFactory: () => server.createClient(),
        },
      );

      console.log(
        `[PARALLEL] vault store/retrieve: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
          `(${result.workersUsed} workers)`,
      );

      expect(result.totalRequestsPerSecond).toBeGreaterThan(150);
      expect(result.growthRate).toBeLessThan(300 * 1024);
    },
  );

  (SKIP_REDIS ? perfTest.skip : perfTest)(
    'parallel stress: 5000 total session reads (shared key)',
    async ({ mcp, perf, server }) => {
      // Pre-populate with shared keys
      for (let i = 0; i < 10; i++) {
        await mcp.tools.call('set-session-data', {
          key: `shared-read-${i}`,
          value: `shared-value-${i}`,
        });
      }

      const result = await perf.checkLeakParallel(
        (client, workerId) => {
          let counter = workerId;
          return async () => {
            await client.tools.call('get-session-data', {
              key: `shared-read-${counter++ % 10}`,
            });
          };
        },
        {
          iterations: 1000,
          workers: 5,
          threshold: 200 * 1024 * 1024, // Reads should be lighter
          warmupIterations: 10,
          intervalSize: 200,
          clientFactory: () => server.createClient(),
        },
      );

      console.log(
        `[PARALLEL] session reads: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
          `(${result.workersUsed} workers)`,
      );

      expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
      expect(result.growthRate).toBeLessThan(200 * 1024);
    },
  );

  (SKIP_REDIS ? perfTest.skip : perfTest)(
    'parallel stress: 5000 total mixed Redis operations',
    async ({ mcp, perf, server }) => {
      const result = await perf.checkLeakParallel(
        (client, workerId) => {
          let counter = workerId;
          return async () => {
            const op = counter++ % 4;
            const key = `parallel-mixed-${workerId}-${counter % 100}`;

            if (op === 0) {
              await client.tools.call('set-session-data', { key, value: `v-${counter}` });
            } else if (op === 1) {
              await client.tools.call('get-session-data', { key });
            } else if (op === 2) {
              await client.tools.call('vault-store', { key, value: JSON.stringify({ c: counter }) });
            } else {
              await client.tools.call('vault-retrieve', { key });
            }
          };
        },
        {
          iterations: 1000,
          workers: 5,
          threshold: 300 * 1024 * 1024,
          warmupIterations: 10,
          intervalSize: 200,
          clientFactory: () => server.createClient(),
        },
      );

      console.log(
        `[PARALLEL] mixed Redis ops: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
          `(${result.workersUsed} workers)`,
      );

      expect(result.totalRequestsPerSecond).toBeGreaterThan(150);
      expect(result.growthRate).toBeLessThan(300 * 1024);
    },
  );
});
