/**
 * E2E: one MCP session served across the nodes of a distributed deployment (#680).
 *
 * Runs real nodes in `FRONTMCP_DEPLOYMENT_MODE=distributed` against one Redis:
 * - a request for a session owned by a LIVE node is relayed to that node;
 * - a request for a session whose owner STOPPED is taken over and served;
 * - a session the orphan scanner claimed is served (and routed) by its new owner.
 *
 * Requires Docker for the testcontainers Redis.
 */

import Redis from 'ioredis';

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';
import { callTool, initializeSession, mcpPost, toolText, waitFor } from './helpers/mcp-http';

const SKIP = shouldSkipDistributedTests();
const skipIf = (condition: boolean) => (condition ? it.skip : it);

/** Short HA timings so a stopped node is detected within seconds. */
const HA_ENV = {
  FRONTMCP_DEPLOYMENT_MODE: 'distributed',
  // Every node must decrypt the session ids the others mint.
  MCP_SESSION_SECRET: 'distributed-e2e-shared-session-secret-0123456789',
  FRONTMCP_HA_HEARTBEAT_INTERVAL_MS: '1000',
  FRONTMCP_HA_HEARTBEAT_TTL_MS: '3000',
  FRONTMCP_HA_TAKEOVER_GRACE_MS: '500',
};

describe('Distributed cross-node sessions (#680)', () => {
  let redisContainer: RedisContainerInfo;
  let redis: Redis;
  let cluster: DistributedTestCluster;
  let nodes: ClusterNode[];

  /** The persisted session record (`transport.persistence.redis`, default `mcp:` prefix). */
  async function storedOwner(sessionId: string): Promise<string | undefined> {
    const raw = await redis.get(`mcp:session:${sessionId}`);
    if (!raw) return undefined;
    return (JSON.parse(raw) as { session?: { nodeId?: string } }).session?.nodeId;
  }

  beforeAll(async () => {
    if (SKIP) return;
    redisContainer = await startRedisContainer();
    redis = new Redis(redisContainer.url);
    cluster = new DistributedTestCluster({
      redisUrl: redisContainer.url,
      serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
      project: 'demo-e2e-distributed',
      env: HA_ENV,
    });
    nodes = await cluster.start(2);
  }, 180_000);

  afterAll(async () => {
    if (SKIP) return;
    await cluster?.teardown();
    redis?.disconnect();
    await redisContainer?.stop();
  });

  skipIf(SKIP)('relays a request for a session owned by a live node to that node', async () => {
    const [owner, other] = nodes;
    const sessionId = await initializeSession(owner.info.baseUrl);

    const response = await callTool(other.info.baseUrl, sessionId, 'echo', { message: 'relayed' });

    expect(response.status).toBe(200);
    expect(response.message?.error).toBeUndefined();
    // Executed by the owner (node-0), answered through node-1.
    expect(toolText(response)).toContain('[node-0] relayed');
    expect(response.headers.get('x-frontmcp-machine-id')).toBe('node-0');
    expect(await storedOwner(sessionId)).toBe('node-0');

    // The session keeps working on its owner, and a list request relays too.
    const list = await mcpPost(other.info.baseUrl, 'tools/list', {}, { sessionId });
    expect(JSON.stringify(list.message?.result)).toContain('"echo"');
  });

  skipIf(SKIP)('relays DELETE to the owner, which ends the session for every node', async () => {
    const [owner, other] = nodes;
    const sessionId = await initializeSession(owner.info.baseUrl);

    const deleted = await fetch(`${other.info.baseUrl}/`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    expect(deleted.status).toBe(204);
    // A public session's stored record is gone too, so no restart or takeover brings it back (#713).
    expect(await redis.exists(`mcp:session:${sessionId}`)).toBe(0);

    const after = await callTool(other.info.baseUrl, sessionId, 'echo', { message: 'gone' });
    expect(after.status).toBe(404);
  });

  skipIf(SKIP)('takes over the session of a stopped node and serves it', async () => {
    const doomed = await cluster.startNode(2);
    const survivor = nodes[1];
    const sessionId = await initializeSession(doomed.info.baseUrl);
    expect(toolText(await callTool(doomed.info.baseUrl, sessionId, 'echo', { message: 'before' }))).toContain(
      '[node-2] before',
    );

    await cluster.stopNode(2);

    // Until its heartbeat expires the stopped owner still counts as alive: the request
    // cannot be relayed and is answered with a retryable 503, never a 500.
    const early = await callTool(survivor.info.baseUrl, sessionId, 'echo', { message: 'early' });
    expect([200, 503]).toContain(early.status);
    if (early.status === 503) {
      expect(Number(early.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(early.message?.error?.message).toContain('Retry after');
    }

    let served: Awaited<ReturnType<typeof callTool>> | undefined;
    await waitFor(async () => {
      served = await callTool(survivor.info.baseUrl, sessionId, 'echo', { message: 'after' });
      return served.status === 200;
    }, 20_000);

    // Served by a live node — the survivor, or the node whose orphan scanner claimed it first.
    expect(toolText(served as NonNullable<typeof served>)).toMatch(/\[node-[01]\] after/);
    expect(['node-0', 'node-1']).toContain(await storedOwner(sessionId));
  });

  skipIf(SKIP)('routes a session the orphan scanner claimed to its new owner', async () => {
    const doomed = await cluster.startNode(3);
    const sessionId = await initializeSession(doomed.info.baseUrl);
    await cluster.stopNode(3);

    // No request touches the session: a live node's orphan scanner claims it.
    await waitFor(async () => ['node-0', 'node-1'].includes((await storedOwner(sessionId)) ?? ''), 20_000);
    const claimer = (await storedOwner(sessionId)) as string;
    expect(await redis.hget(`mcp:bus:session:${sessionId}`, 'nodeId')).toBe(claimer);

    // Whichever node receives the next request, the claimer serves it.
    const entry = nodes.find((node) => node.machineId !== claimer) ?? nodes[0];
    const response = await callTool(entry.info.baseUrl, sessionId, 'echo', { message: 'claimed' });
    expect(response.status).toBe(200);
    expect(toolText(response)).toContain(`[${claimer}] claimed`);
  });
});
