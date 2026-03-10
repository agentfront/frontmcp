/**
 * Parallel Stress Tests for Remember/Memory System (5 workers × 1000 iterations)
 *
 * Tests memory operations under parallel load using multiple clients
 * to achieve higher throughput (400-2000+ req/s)
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Remember Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-remember/src/main.ts',
    project: 'demo-e2e-remember',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total remember-value operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId * 1000;
        return async () => {
          await client.tools.call('remember-value', {
            key: `key-${counter}`,
            value: `value-${counter++}`,
            scope: 'session',
          });
        };
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024, // 200MB for 5000 total operations
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] remember-value: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    // 5 workers × ~80 req/s = ~400 req/s expected (allow for variance)
    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total recall-value operations', async ({ perf, server, mcp }) => {
    // First, store some values to recall
    for (let i = 0; i < 100; i++) {
      await mcp.tools.call('remember-value', {
        key: `recall-key-${i}`,
        value: `recall-value-${i}`,
        scope: 'session',
      });
    }

    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId;
        return async () => {
          await client.tools.call('recall-value', {
            key: `recall-key-${counter++ % 100}`,
          });
        };
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] recall-value: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed memory operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 4;
          if (op === 0) {
            await client.tools.call('remember-value', {
              key: `mix-key-${callIndex}`,
              value: `mix-val-${callIndex}`,
              scope: 'session',
            });
          } else if (op === 1) {
            await client.tools.call('recall-value', { key: `mix-key-${callIndex % 100}` });
          } else if (op === 2) {
            await client.tools.call('list-memories', {});
          } else {
            await client.tools.call('check-memory', { key: `mix-key-${callIndex % 100}` });
          }
        };
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] mixed operations: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total tool listings', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.list();
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] tools.list: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
