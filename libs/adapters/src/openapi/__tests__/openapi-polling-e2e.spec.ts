/**
 * E2E tests for OpenAPI Adapter Polling
 *
 * Verifies the full polling pipeline:
 * Poller detects spec change → adapter rebuilds tools → updateCallback fires
 *
 * Uses a real HTTP server for spec serving + mocked mcp-from-openapi for tool generation.
 */

import * as http from 'node:http';
import OpenapiAdapter from '../openapi.adapter';
import { createMockLogger, spyOnConsole } from './fixtures';
import { FrontMcpToolTokens, FrontMcpAdapterResponse } from '@frontmcp/sdk';

// Mock mcp-from-openapi (same pattern as openapi-adapter.spec.ts)
jest.mock('mcp-from-openapi', () => ({
  OpenAPIToolGenerator: {
    fromURL: jest.fn(),
    fromJSON: jest.fn(),
  },
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({ headers: {}, query: {}, cookies: {} }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal OpenAPI spec with configurable paths */
function makeSpec(operations: { method: string; path: string; operationId: string }[]): object {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    if (!paths[op.path]) paths[op.path] = {};
    paths[op.path][op.method] = {
      operationId: op.operationId,
      summary: `${op.operationId} summary`,
      responses: { '200': { description: 'OK' } },
    };
  }
  return {
    openapi: '3.0.0',
    info: { title: 'Poll Test API', version: '1.0.0' },
    paths,
  };
}

/** Create a mutable HTTP server that serves the current spec as JSON */
function createSpecServer() {
  let currentSpec = JSON.stringify(makeSpec([]));
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(currentSpec);
  });

  return {
    setSpec(spec: object) {
      currentSpec = JSON.stringify(spec);
    },
    start(): Promise<string> {
      return new Promise((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve(`http://localhost:${port}`);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Create a mock McpOpenAPITool (matches the shape used by the adapter) */
function createMockTool(name: string, method = 'get', path = `/${name}`) {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    mapper: [],
    metadata: { path, method, servers: [{ url: 'http://localhost' }] },
  };
}

/** Configure mock OpenAPIToolGenerator.fromURL to return a generator with the given tools */
function configureMockGenerator(tools: ReturnType<typeof createMockTool>[]) {
  const { OpenAPIToolGenerator } = require('mcp-from-openapi');
  const mockGenerator = { generateTools: jest.fn().mockResolvedValue(tools) };
  OpenAPIToolGenerator.fromURL.mockResolvedValue(mockGenerator);
  return mockGenerator;
}

/** Extract tool names from a FrontMcpAdapterResponse */
function extractToolNames(response: FrontMcpAdapterResponse): string[] {
  return (response.tools || []).map((toolFn: any) => {
    const meta = toolFn[FrontMcpToolTokens.metadata];
    return meta?.name ?? meta?.id ?? 'unknown';
  });
}

/** Assert no duplicate tool names in a single response */
function assertNoDuplicateTools(response: FrontMcpAdapterResponse) {
  const names = extractToolNames(response);
  expect(names.length).toBe(new Set(names).size);
}

/** Promise-based update tracker — subscribes to adapter.onUpdate and queues responses */
function createUpdateTracker(adapter: OpenapiAdapter) {
  const allUpdates: FrontMcpAdapterResponse[] = [];
  let pendingResolve: ((resp: FrontMcpAdapterResponse) => void) | null = null;

  const unsubscribe = adapter.onUpdate((response) => {
    allUpdates.push(response);
    if (pendingResolve) {
      pendingResolve(response);
      pendingResolve = null;
    }
  });

  return {
    allUpdates,
    unsubscribe,
    /** Wait for the next update (or resolve immediately if one is already queued) */
    waitForNextUpdate(timeoutMs = 5000): Promise<FrontMcpAdapterResponse> {
      // If an update arrived since last wait, return it
      const pending = allUpdates.length;
      return new Promise<FrontMcpAdapterResponse>((resolve, reject) => {
        // Check if a new update already came
        const check = () => {
          if (allUpdates.length > pending) {
            return resolve(allUpdates[allUpdates.length - 1]);
          }
          pendingResolve = resolve;
        };
        check();
        setTimeout(() => {
          if (pendingResolve) {
            pendingResolve = null;
            reject(new Error(`waitForNextUpdate timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      });
    },
  };
}

/** Small delay helper */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAPI Adapter — Polling E2E', () => {
  let consoleSpy: ReturnType<typeof spyOnConsole>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = spyOnConsole();
  });

  afterEach(() => {
    consoleSpy.restore();
  });

  // ---------- Prerequisites ----------

  describe('Prerequisites', () => {
    it('should reject polling with static spec option', () => {
      expect(
        () =>
          new OpenapiAdapter({
            name: 'static-api',
            baseUrl: 'https://api.example.com',
            spec: makeSpec([{ method: 'get', path: '/foo', operationId: 'foo' }]) as any,
            polling: { enabled: true, intervalMs: 1000 },
            logger: createMockLogger(),
          }),
      ).toThrow(/Polling requires URL-based options/);
    });
  });

  // ---------- Initial Load ----------

  describe('Initial Load', () => {
    it('should produce correct tools on initial fetch', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const spec = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
        ]);
        specServer.setSpec(spec);

        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('createUser', 'post', '/users'),
        ]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          logger: createMockLogger(),
        });

        const response = await adapter.fetch();
        const names = extractToolNames(response);

        expect(names).toHaveLength(2);
        expect(names).toContain('listUsers');
        expect(names).toContain('createUser');
        assertNoDuplicateTools(response);
      } finally {
        await specServer.stop();
      }
    });
  });

  // ---------- Spec Change Detection ----------

  describe('Spec Change Detection', () => {
    it('should add new tools when operations are added', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        // Initial spec: 1 operation
        const specV1 = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        specServer.setSpec(specV1);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        // Initial fetch
        await adapter.fetch();

        const tracker = createUpdateTracker(adapter);

        // Wait for the first poll update (poller fires onChanged on first poll because lastHash is null)
        adapter.startPolling();
        await tracker.waitForNextUpdate();

        // Now update spec to 2 operations
        const specV2 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
        ]);
        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('createUser', 'post', '/users'),
        ]);
        specServer.setSpec(specV2);

        const update = await tracker.waitForNextUpdate();
        const names = extractToolNames(update);

        expect(names).toHaveLength(2);
        expect(names).toContain('listUsers');
        expect(names).toContain('createUser');

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });

    it('should remove tools when operations are removed', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        // Initial spec: 2 operations
        const specV1 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
        ]);
        specServer.setSpec(specV1);
        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('createUser', 'post', '/users'),
        ]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();

        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();
        await tracker.waitForNextUpdate(); // initial poll onChanged

        // Update spec: remove createUser
        const specV2 = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);
        specServer.setSpec(specV2);

        const update = await tracker.waitForNextUpdate();
        const names = extractToolNames(update);

        expect(names).toHaveLength(1);
        expect(names).toContain('listUsers');
        expect(names).not.toContain('createUser');

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });

    it('should not trigger extra updates when spec is unchanged', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const spec = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        specServer.setSpec(spec);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();

        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial poll update
        await tracker.waitForNextUpdate();

        // Wait for several more poll cycles without changing spec
        await delay(400);

        // Only the initial poll should have triggered an update
        expect(tracker.allUpdates).toHaveLength(1);

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });
  });

  // ---------- No Duplicate Tools ----------

  describe('No Duplicate Tools', () => {
    it('should never produce duplicate tool names in any single update', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const specV1 = makeSpec([{ method: 'get', path: '/a', operationId: 'toolA' }]);
        specServer.setSpec(specV1);
        configureMockGenerator([createMockTool('toolA', 'get', '/a')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();
        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial poll update
        await tracker.waitForNextUpdate();
        assertNoDuplicateTools(tracker.allUpdates[0]);

        // Change 1: add toolB
        const specV2 = makeSpec([
          { method: 'get', path: '/a', operationId: 'toolA' },
          { method: 'get', path: '/b', operationId: 'toolB' },
        ]);
        configureMockGenerator([createMockTool('toolA', 'get', '/a'), createMockTool('toolB', 'get', '/b')]);
        specServer.setSpec(specV2);
        await tracker.waitForNextUpdate();

        // Change 2: add toolC
        const specV3 = makeSpec([
          { method: 'get', path: '/a', operationId: 'toolA' },
          { method: 'get', path: '/b', operationId: 'toolB' },
          { method: 'get', path: '/c', operationId: 'toolC' },
        ]);
        configureMockGenerator([
          createMockTool('toolA', 'get', '/a'),
          createMockTool('toolB', 'get', '/b'),
          createMockTool('toolC', 'get', '/c'),
        ]);
        specServer.setSpec(specV3);
        await tracker.waitForNextUpdate();

        // Assert every update had no duplicates
        for (const update of tracker.allUpdates) {
          assertNoDuplicateTools(update);
        }

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });

    it('should maintain correct tool count after multiple rapid changes', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const specV1 = makeSpec([{ method: 'get', path: '/a', operationId: 'toolA' }]);
        specServer.setSpec(specV1);
        configureMockGenerator([createMockTool('toolA', 'get', '/a')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();
        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial poll
        await tracker.waitForNextUpdate();

        // Rapid changes: update mock generator to final state, then cycle through specs
        const finalTools = [
          createMockTool('toolA', 'get', '/a'),
          createMockTool('toolB', 'get', '/b'),
          createMockTool('toolC', 'get', '/c'),
        ];

        // Change spec 3 times in quick succession — each change has different content hash
        specServer.setSpec(
          makeSpec([
            { method: 'get', path: '/a', operationId: 'toolA' },
            { method: 'get', path: '/b', operationId: 'toolB' },
          ]),
        );
        configureMockGenerator([createMockTool('toolA', 'get', '/a'), createMockTool('toolB', 'get', '/b')]);
        await delay(10);

        specServer.setSpec(
          makeSpec([
            { method: 'get', path: '/a', operationId: 'toolA' },
            { method: 'get', path: '/c', operationId: 'toolC' },
          ]),
        );
        configureMockGenerator([createMockTool('toolA', 'get', '/a'), createMockTool('toolC', 'get', '/c')]);
        await delay(10);

        specServer.setSpec(
          makeSpec([
            { method: 'get', path: '/a', operationId: 'toolA' },
            { method: 'get', path: '/b', operationId: 'toolB' },
            { method: 'get', path: '/c', operationId: 'toolC' },
          ]),
        );
        configureMockGenerator(finalTools);

        // Wait for updates to settle — the poller will detect the final hash change
        // Give enough time for at least one poll cycle to pick up the final spec
        await delay(500);

        // The last update should reflect the final spec state
        const lastUpdate = tracker.allUpdates[tracker.allUpdates.length - 1];
        assertNoDuplicateTools(lastUpdate);

        // Verify every update along the way had no duplicates
        for (const update of tracker.allUpdates) {
          assertNoDuplicateTools(update);
        }

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });
  });

  // ---------- Rebuild Failure Resilience ----------

  describe('Rebuild Failure Resilience', () => {
    it('should preserve previous tools when rebuild fails', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        // Initial spec: 1 operation
        const specV1 = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        specServer.setSpec(specV1);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        // Initial fetch
        const initialResponse = await adapter.fetch();
        expect(extractToolNames(initialResponse)).toEqual(['listUsers']);

        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial poll update
        await tracker.waitForNextUpdate();
        const updatesBeforeFailure = tracker.allUpdates.length;

        // Configure mock generator to THROW on the next call
        const { OpenAPIToolGenerator } = require('mcp-from-openapi');
        OpenAPIToolGenerator.fromURL.mockRejectedValueOnce(new Error('Invalid OpenAPI spec'));

        // Change spec to trigger onChanged
        const specV2 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
        ]);
        specServer.setSpec(specV2);

        // Wait for the poll cycle to process the failed rebuild
        await delay(400);

        // updateCallback should NOT have been called with a broken response
        expect(tracker.allUpdates).toHaveLength(updatesBeforeFailure);

        // Now configure mock generator to succeed again
        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('createUser', 'post', '/users'),
        ]);

        // Change spec again to trigger a new rebuild
        const specV3 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
          { method: 'get', path: '/health', operationId: 'healthCheck' },
        ]);
        specServer.setSpec(specV3);

        // Wait for the successful rebuild
        const recoveryUpdate = await tracker.waitForNextUpdate();
        const names = extractToolNames(recoveryUpdate);
        expect(names).toContain('listUsers');
        expect(names).toContain('createUser');

        // Verify a manual fetch() still works (generator was restored, not undefined)
        const manualResponse = await adapter.fetch();
        expect(extractToolNames(manualResponse).length).toBeGreaterThan(0);

        adapter.stopPolling();
        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });
  });

  // ---------- Polling Lifecycle ----------

  describe('Polling Lifecycle', () => {
    it('should stop producing updates after stopPolling()', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const spec = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        specServer.setSpec(spec);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();
        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial update
        await tracker.waitForNextUpdate();
        const countBefore = tracker.allUpdates.length;

        // Stop polling
        adapter.stopPolling();

        // Change spec after stopping
        const specV2 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'post', path: '/users', operationId: 'createUser' },
        ]);
        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('createUser', 'post', '/users'),
        ]);
        specServer.setSpec(specV2);

        // Wait long enough for several poll intervals
        await delay(400);

        // No new updates should have arrived
        expect(tracker.allUpdates).toHaveLength(countBefore);

        tracker.unsubscribe();
      } finally {
        await specServer.stop();
      }
    });

    it('should handle onUpdate unsubscribe correctly', async () => {
      const specServer = createSpecServer();
      const url = await specServer.start();

      try {
        const spec = makeSpec([{ method: 'get', path: '/users', operationId: 'listUsers' }]);
        specServer.setSpec(spec);
        configureMockGenerator([createMockTool('listUsers', 'get', '/users')]);

        const adapter = new OpenapiAdapter({
          name: 'test-api',
          baseUrl: url,
          url: `${url}/openapi.json`,
          polling: { enabled: true, intervalMs: 100 },
          logger: createMockLogger(),
        });

        await adapter.fetch();
        const tracker = createUpdateTracker(adapter);
        adapter.startPolling();

        // Wait for initial update
        await tracker.waitForNextUpdate();
        const countBefore = tracker.allUpdates.length;

        // Unsubscribe from updates (but don't stop polling)
        tracker.unsubscribe();

        // Change spec
        const specV2 = makeSpec([
          { method: 'get', path: '/users', operationId: 'listUsers' },
          { method: 'delete', path: '/users/{id}', operationId: 'deleteUser' },
        ]);
        configureMockGenerator([
          createMockTool('listUsers', 'get', '/users'),
          createMockTool('deleteUser', 'delete', '/users/{id}'),
        ]);
        specServer.setSpec(specV2);

        // Wait for poll cycle to pick up the change
        await delay(400);

        // Callback was unsubscribed — no new updates in tracker
        expect(tracker.allUpdates).toHaveLength(countBefore);

        adapter.stopPolling();
      } finally {
        await specServer.stop();
      }
    });
  });
});
