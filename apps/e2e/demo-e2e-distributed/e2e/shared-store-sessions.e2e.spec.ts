/**
 * E2E: one MCP session served by two instances in the default (non-distributed) mode, through the
 * session store they share in Redis. A DELETE on one ends the session on the other too (#713).
 *
 * Requires Docker for the testcontainers Redis.
 */

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';
import { callTool, initializeSession, toolText } from './helpers/mcp-http';

const SKIP = shouldSkipDistributedTests();
const skipIf = (condition: boolean) => (condition ? it.skip : it);

describe('Sessions shared through the session store (default mode)', () => {
  let redisContainer: RedisContainerInfo;
  let cluster: DistributedTestCluster;
  let nodes: ClusterNode[];

  beforeAll(async () => {
    if (SKIP) return;
    redisContainer = await startRedisContainer();
    cluster = new DistributedTestCluster({
      redisUrl: redisContainer.url,
      serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
      project: 'demo-e2e-distributed',
      // Both instances must decrypt the session ids the other mints.
      env: { MCP_SESSION_SECRET: 'shared-store-e2e-session-secret-0123456789abcdef' },
    });
    nodes = await cluster.start(2);
  }, 180_000);

  afterAll(async () => {
    if (SKIP) return;
    await cluster?.teardown();
    await redisContainer?.stop();
  });

  skipIf(SKIP)('stops serving a session on every instance once one of them deleted it', async () => {
    const [first, second] = nodes;
    const sessionId = await initializeSession(first.info.baseUrl);

    const before = await callTool(second.info.baseUrl, sessionId, 'echo', { message: 'shared' });
    expect(toolText(before)).toContain('[node-1] shared');

    const deleted = await fetch(`${first.info.baseUrl}/`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    expect(deleted.status).toBe(204);

    const after = await callTool(second.info.baseUrl, sessionId, 'echo', { message: 'gone' });
    expect(after.status).toBe(404);
  });
});
