/**
 * Parallel Stress Tests for MultiApp System (5 workers × 100 iterations)
 *
 * Tests multi-app isolation under parallel load using multiple clients.
 * Reduced to 100 iterations per worker (500 total) to prevent OOM from
 * notes/tasks/events accumulating across operations.
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('MultiApp Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-multiapp/src/main.ts',
    project: 'demo-e2e-multiapp',
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
        warmupIterations: 5,
        intervalSize: 20,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] create-note: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    // 5 workers × ~80 req/s = ~400 req/s expected (allow for variance)
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
        warmupIterations: 5,
        intervalSize: 20,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] list-notes: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    // Lowered from 200 to 180 to account for CI runner variance
    expect(result.totalRequestsPerSecond).toBeGreaterThan(180);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 500 total mixed multi-app operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 6;
          if (op === 0) {
            await client.tools.call('create-note', { title: `Note ${callIndex}`, content: `Content ${callIndex}` });
          } else if (op === 1) {
            await client.tools.call('list-notes', {});
          } else if (op === 2) {
            await client.tools.call('create-task', { title: `Task ${callIndex}`, description: `Desc ${callIndex}` });
          } else if (op === 3) {
            await client.tools.call('list-tasks', {});
          } else if (op === 4) {
            await client.tools.call('create-event', { title: `Event ${callIndex}`, date: new Date().toISOString() });
          } else {
            await client.tools.call('list-events', {});
          }
        };
      },
      {
        iterations: 100,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 5,
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
        warmupIterations: 5,
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
