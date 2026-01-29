/**
 * Parallel Stress Tests for Remote Gateway System (5 workers × 1000 iterations)
 *
 * Tests remote gateway operations under parallel load using multiple clients.
 * The remote gateway orchestrates local:* and mintlify:* namespaced tools.
 */
import { perfTest, expect, TestServer } from '@frontmcp/testing';

// Port configuration from E2E_PORT_RANGES:
// - demo-e2e-remote: 50210-50219 (using 50210 for gateway, 50211 for local MCP)
// - mock-api: 50910-50919 (using 50910 for mock Mintlify)
const LOCAL_MCP_PORT = 50211;
const MOCK_MINTLIFY_PORT = 50910;

// Local MCP server instance
let localMcpServer: TestServer | null = null;
// Mock Mintlify MCP server instance
let mockMintlifyServer: TestServer | null = null;

// Start local MCP and mock Mintlify servers before all perf tests
perfTest.beforeAll(async () => {
  // Start mock Mintlify server first
  mockMintlifyServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-remote/src/mock-mintlify-server/main.ts',
    project: 'mock-api',
    port: MOCK_MINTLIFY_PORT,
    startupTimeout: 60000,
    healthCheckPath: '/',
  });

  // Then start local MCP server
  localMcpServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-remote/src/local-mcp-server/main.ts',
    project: 'demo-e2e-remote',
    port: LOCAL_MCP_PORT,
    startupTimeout: 60000,
    healthCheckPath: '/',
  });

  // Give the servers extra time to fully initialize
  // The health check passes when HTTP is ready, but MCP handlers need more time
  await new Promise((resolve) => setTimeout(resolve, 2000));
}, 120000);

// Stop all servers after all perf tests
perfTest.afterAll(async () => {
  if (localMcpServer) {
    await localMcpServer.stop();
    localMcpServer = null;
  }
  if (mockMintlifyServer) {
    await mockMintlifyServer.stop();
    mockMintlifyServer = null;
  }
}, 30000);

perfTest.describe('Remote Gateway Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-remote/src/main.ts',
    project: 'demo-e2e-remote',
    publicMode: true,
    env: {
      LOCAL_MCP_PORT: String(LOCAL_MCP_PORT),
      MOCK_MINTLIFY_PORT: String(MOCK_MINTLIFY_PORT),
    },
  });

  perfTest('parallel stress: 5000 total local:echo operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.call('local:echo', { message: 'parallel-test' });
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
      `[PARALLEL] local:echo: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total local:ping operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.call('local:ping', {});
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
      `[PARALLEL] local:ping: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total local:add operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId * 1000;
        return async () => {
          await client.tools.call('local:add', { a: counter++, b: 10 });
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
      `[PARALLEL] local:add: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed remote operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 3;
          if (op === 0) {
            await client.tools.call('local:echo', { message: 'test' });
          } else if (op === 1) {
            await client.tools.call('local:ping', {});
          } else {
            await client.tools.call('local:add', { a: 5, b: 10 });
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
      `[PARALLEL] mixed remote: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
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
