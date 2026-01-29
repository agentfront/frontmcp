/**
 * Parallel Stress Tests for Direct SDK Access (5 workers × 100 iterations)
 *
 * Tests direct SDK operations under parallel load using multiple clients.
 * Reduced to 100 iterations per worker to prevent note accumulation OOM.
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Direct Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-direct/src/main.ts',
    project: 'demo-e2e-direct',
    publicMode: true,
  });

  perfTest('parallel stress: 500 total create-note operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId * 100;
        return async () => {
          await client.tools.call('create-note', {
            title: `Note ${counter}`,
            content: `Content for note ${counter++}`,
          });
        };
      },
      {
        iterations: 100,
        workers: 5,
        threshold: 200 * 1024 * 1024, // 200MB for 500 total operations
        warmupIterations: 10,
        intervalSize: 20,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] create-note: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 500 total list-notes operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.call('list-notes', {});
      },
      {
        iterations: 100,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 20,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] list-notes: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 500 total mixed operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 2;
          if (op === 0) {
            await client.tools.call('create-note', { title: `Note ${callIndex}`, content: `Content ${callIndex}` });
          } else {
            await client.tools.call('list-notes', {});
          }
        };
      },
      {
        iterations: 100,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 20,
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

  perfTest('parallel stress: 500 total tool listings', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.list();
      },
      {
        iterations: 100,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 20,
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
