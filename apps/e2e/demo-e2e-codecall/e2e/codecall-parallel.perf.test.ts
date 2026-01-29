/**
 * Parallel Stress Tests for CodeCall/CRM System (5 workers × 1000 iterations)
 *
 * Tests CRM operations under parallel load using multiple clients
 * to achieve higher throughput (400-2000+ req/s)
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('CodeCall Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total users-list operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.call('users-list', {});
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
      `[PARALLEL] users-list: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    // 5 workers × ~80 req/s = ~400 req/s expected (allow for variance)
    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total users-create operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId * 1000;
        return async () => {
          await client.tools.call('users-create', {
            name: `User ${counter}`,
            email: `user${counter}@test.com`,
            company: `Company ${counter}`,
            role: counter++ % 2 === 0 ? 'admin' : 'user',
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
      `[PARALLEL] users-create: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed CRM operations', async ({ perf, server }) => {
    // Reset CRM store before leak detection to prevent accumulation from warmup
    const resetClient = await server.createClient();
    await resetClient.tools.call('crm-reset', {});

    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 4;
          if (op === 0) {
            await client.tools.call('users-list', {});
          } else if (op === 1) {
            await client.tools.call('users-create', {
              name: `User ${callIndex}`,
              email: `user${callIndex}@test.com`,
              company: 'Test',
              role: 'user',
            });
          } else if (op === 2) {
            await client.tools.call('activities-list', {});
          } else {
            await client.tools.call('activities-stats', {});
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
