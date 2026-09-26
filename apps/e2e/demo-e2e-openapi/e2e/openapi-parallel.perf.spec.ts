/**
 * Parallel Stress Tests for OpenAPI System (5 workers × 1000 iterations)
 *
 * Tests OpenAPI-generated tools under parallel load using multiple clients
 */
import { perfTest, expect, MockAPIServer } from '@frontmcp/testing';

import { ECOMMERCE_OPENAPI_SPEC } from './helpers/ecommerce-openapi-spec';

perfTest.describe('OpenAPI Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-openapi/src/main.ts',
    project: 'demo-e2e-openapi',
    publicMode: true,
  });

  // Serve the spec locally so the run never depends on the hosted mock's rate limit; the server
  // process is started lazily by the first test and inherits these variables.
  const mockApi = new MockAPIServer({ openApiSpec: ECOMMERCE_OPENAPI_SPEC });

  beforeAll(async () => {
    const apiInfo = await mockApi.start();
    process.env['OPENAPI_BASE_URL'] = apiInfo.baseUrl;
    process.env['OPENAPI_SPEC_URL'] = apiInfo.specUrl;
  });

  afterAll(async () => {
    delete process.env['OPENAPI_BASE_URL'];
    delete process.env['OPENAPI_SPEC_URL'];
    await mockApi.stop();
  });

  perfTest('parallel stress: 5000 total tool listings', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.list();
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
      `[PARALLEL] tools.list: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed listing operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 3;
          if (op === 0) {
            await client.tools.list();
          } else if (op === 1) {
            await client.resources.list();
          } else {
            await client.prompts.list();
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
      `[PARALLEL] mixed listings: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
