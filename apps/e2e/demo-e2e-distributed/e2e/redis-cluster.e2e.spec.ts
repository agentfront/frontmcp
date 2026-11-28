/**
 * E2E: two server instances behind one Redis Cluster (#1503).
 *
 * The reporter ran FrontMCP on an AWS ElastiCache cluster (cluster mode on) with several workers:
 * every session write hit `MOVED`, and a request for a session another worker opened answered
 * `404 session not initialized`. Here two instances share a real 3-master cluster, configured the
 * three ways FrontMCP takes it: `cluster: true` on the endpoint, an ioredis `Cluster` client, and a
 * node-redis cluster client. One stateful session moves between them:
 * `initialize` -> `notifications/initialized` -> `tools/list` -> `tools/call`.
 *
 * Runs when REDIS_CLUSTER_NODES lists the cluster's nodes, as `scripts/redis-cluster-docker.sh up`
 * prints (host:port,host:port,...); skipped otherwise, so CI without a cluster is unaffected.
 */

import { Cluster } from 'ioredis';

import { shouldSkipDistributedTests } from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';
import { callTool, initializeSession, mcpPost, toolText } from './helpers/mcp-http';

const CLUSTER_NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean);
const SKIP = CLUSTER_NODES.length === 0 || shouldSkipDistributedTests();
const describeCluster = SKIP ? describe.skip : describe;

const SHARED_ENV = {
  // Every instance must decrypt the session ids the others mint.
  MCP_SESSION_SECRET: 'redis-cluster-e2e-shared-session-secret-0123456789',
};

/** The HA timings of the distributed mode, short enough for a test. */
const HA_ENV = {
  FRONTMCP_DEPLOYMENT_MODE: 'distributed',
  FRONTMCP_HA_HEARTBEAT_INTERVAL_MS: '1000',
  FRONTMCP_HA_HEARTBEAT_TTL_MS: '3000',
  FRONTMCP_HA_TAKEOVER_GRACE_MS: '500',
};

const seed = (() => {
  const [host, port] = (CLUSTER_NODES[0] ?? '127.0.0.1:7101').split(':');
  return { host, port: Number(port) };
})();

/** The persisted session record, read through a cluster client. */
async function storedSession(redis: Cluster, sessionId: string): Promise<Record<string, unknown> | undefined> {
  const raw = await redis.get(`mcp:session:${sessionId}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
}

function toolNames(response: Awaited<ReturnType<typeof mcpPost>>): string[] {
  const tools = (response.message?.result?.['tools'] ?? []) as Array<{ name: string }>;
  return tools.map((tool) => tool.name);
}

describe.each([
  ['cluster: true on the endpoint', { REDIS_CLUSTER: '1' }],
  ['an ioredis Cluster client', { REDIS_CLIENT: 'ioredis' }],
  ['a node-redis cluster client', { REDIS_CLIENT: 'node-redis' }],
] as const)('two instances on a Redis Cluster, with %s', (_label, redisEnv) => {
  describeCluster.each([
    ['separate workers (the reporter: PM2 / ECS tasks)', {}],
    ['the distributed deployment mode (HA relay)', HA_ENV],
  ] as const)('as %s', (_mode, modeEnv) => {
    let redis: Cluster;
    let instances: DistributedTestCluster;
    let nodes: ClusterNode[];

    beforeAll(async () => {
      redis = new Cluster([seed]);
      instances = new DistributedTestCluster({
        redisUrl: `redis://${seed.host}:${seed.port}`,
        serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
        project: 'demo-e2e-distributed',
        env: { ...SHARED_ENV, ...modeEnv, ...redisEnv },
      });
      nodes = await instances.start(2);
    }, 180_000);

    afterAll(async () => {
      await instances?.teardown();
      redis?.disconnect();
    });

    it('keeps one stateful session working as it moves between the instances', async () => {
      const [a, b] = nodes;

      // initialize on A, notifications/initialized on B
      const init = await mcpPost(a.info.baseUrl, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'redis-cluster-e2e', version: '1.0.0' },
      });
      expect(init.status).toBe(200);
      const sessionId = init.headers.get('mcp-session-id') as string;
      expect(sessionId).toBeTruthy();
      const initialized = await mcpPost(b.info.baseUrl, 'notifications/initialized', undefined, {
        sessionId,
        notification: true,
      });
      expect(initialized.status).toBeLessThan(300);

      // The session record is in the cluster, on whichever master owns its slot
      expect(await storedSession(redis, sessionId)).toBeDefined();

      // tools/list on both, then tools/call on both: no MOVED, no "404 session not initialized"
      for (const node of [a, b, a, b]) {
        const list = await mcpPost(node.info.baseUrl, 'tools/list', {}, { sessionId });
        expect({ status: list.status, error: list.message?.error }).toEqual({ status: 200, error: undefined });
        expect(toolNames(list)).toEqual(expect.arrayContaining(['echo', 'node-info']));
      }
      for (const node of [b, a]) {
        const call = await callTool(node.info.baseUrl, sessionId, 'echo', { message: `via ${node.machineId}` });
        expect(call.status).toBe(200);
        expect(toolText(call)).toContain(`via ${node.machineId}`);
      }
    });

    it('opens sessions on both instances whose keys land on different masters', async () => {
      const [a, b] = nodes;
      const sessions = await Promise.all(
        Array.from({ length: 6 }, (_, i) => initializeSession((i % 2 === 0 ? a : b).info.baseUrl)),
      );
      const slots = await Promise.all(
        sessions.map(async (id) => Number(await redis.cluster('KEYSLOT', `mcp:session:${id}`))),
      );
      // Six random session ids almost surely span more than one of the three masters' slot ranges
      expect(new Set(slots.map((slot) => Math.min(2, Math.floor(slot / 5461)))).size).toBeGreaterThan(1);

      for (const [i, sessionId] of sessions.entries()) {
        const other = i % 2 === 0 ? b : a;
        const list = await mcpPost(other.info.baseUrl, 'tools/list', {}, { sessionId });
        expect(list.status).toBe(200);
      }
    });
  });
});

describeCluster('a session ended on one instance', () => {
  let instances: DistributedTestCluster;
  let nodes: ClusterNode[];
  let redis: Cluster;

  beforeAll(async () => {
    redis = new Cluster([seed]);
    instances = new DistributedTestCluster({
      redisUrl: `redis://${seed.host}:${seed.port}`,
      serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
      project: 'demo-e2e-distributed',
      env: { ...SHARED_ENV, ...HA_ENV, REDIS_CLUSTER: '1' },
    });
    nodes = await instances.start(2);
  }, 180_000);

  afterAll(async () => {
    await instances?.teardown();
    redis?.disconnect();
  });

  it('is gone for the other instance too', async () => {
    const [a, b] = nodes;
    const sessionId = await initializeSession(a.info.baseUrl);
    expect(await storedSession(redis, sessionId)).toBeDefined();

    const deleted = await fetch(`${b.info.baseUrl}/`, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
    expect(deleted.status).toBe(204);
    expect(await redis.exists(`mcp:session:${sessionId}`)).toBe(0);
    expect((await callTool(a.info.baseUrl, sessionId, 'echo', { message: 'gone' })).status).toBe(404);
  });
});
