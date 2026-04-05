/**
 * Parallel Stress Tests for Skills System (5 workers x 1000 iterations)
 *
 * Tests skills system under parallel load using multiple clients
 * to achieve higher throughput (400-2000+ req/s)
 */
import { perfTest, expect } from '@frontmcp/testing';

let nextId = 1;
async function loadSkillsRaw(client: any, params: Record<string, unknown>) {
  const response = await client.raw.request({
    jsonrpc: '2.0' as const,
    id: nextId++,
    method: 'skills/load',
    params,
  });
  if (response.error) throw new Error(response.error.message);
  return response.result;
}

async function searchSkillsRaw(client: any, params: Record<string, unknown>) {
  const response = await client.raw.request({
    jsonrpc: '2.0' as const,
    id: nextId++,
    method: 'skills/search',
    params,
  });
  if (response.error) throw new Error(response.error.message);
  return response.result;
}

perfTest.describe('Skills Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total loadSkills operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await loadSkillsRaw(client, { skillIds: ['review-pr'] });
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
      `[PARALLEL] loadSkills: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers x ${result.totalIterations / result.workersUsed} iterations)`,
    );

    // 5 workers x ~80 req/s = ~400 req/s expected (allow for variance)
    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total searchSkills operations', async ({ perf, server }) => {
    const queries = ['pr', 'deploy', 'team', 'notify', 'review'];
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let queryIndex = workerId;
        return async () => {
          await searchSkillsRaw(client, {
            query: queries[queryIndex++ % queries.length],
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
      `[PARALLEL] searchSkills: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 3;
          if (op === 0) {
            await loadSkillsRaw(client, { skillIds: ['review-pr'] });
          } else if (op === 1) {
            await searchSkillsRaw(client, { query: 'deploy' });
          } else {
            await loadSkillsRaw(client, { skillIds: ['notify-team', 'deploy-app'] });
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
