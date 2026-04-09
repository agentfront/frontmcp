/**
 * E2E Tests for Distributed Session Scaling
 *
 * Tests that sessions created on one node can be accessed from another node
 * via Redis session persistence and transport recreation.
 *
 * Requires Docker for testcontainers Redis.
 */

import { McpTestClient } from '@frontmcp/testing';

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';

const SKIP = shouldSkipDistributedTests();

describe('Distributed Session Scaling', () => {
  let redis: RedisContainerInfo;
  let cluster: DistributedTestCluster;
  let nodes: ClusterNode[];

  beforeAll(async () => {
    if (SKIP) return;

    // Start Redis container
    redis = await startRedisContainer();

    // Start 2-node cluster
    cluster = new DistributedTestCluster({
      redisUrl: redis.url,
      serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
      project: 'demo-e2e-distributed',
    });
    nodes = await cluster.start(2);
  }, 90_000);

  afterAll(async () => {
    if (SKIP) return;
    await cluster?.teardown();
    await redis?.stop();
  });

  const skipIf = (condition: boolean) => (condition ? it.skip : it);

  skipIf(SKIP)('both nodes should be running and accessible', async () => {
    expect(nodes).toHaveLength(2);
    expect(nodes[0].info.baseUrl).toBeDefined();
    expect(nodes[1].info.baseUrl).toBeDefined();
    expect(nodes[0].machineId).toBe('node-0');
    expect(nodes[1].machineId).toBe('node-1');
  });

  skipIf(SKIP)('should initialize session on node 0 and get tool response', async () => {
    const client = await McpTestClient.create({
      baseUrl: nodes[0].info.baseUrl,
    }).buildAndConnect();

    try {
      const result = await client.tools.call('echo', { message: 'hello' });
      expect(result).toBeSuccessful();
      // Tool returns { echo: "[node-0] hello" } serialized as JSON text
      expect(result).toHaveTextContent('node-0');
      expect(result).toHaveTextContent('hello');
    } finally {
      await client.close();
    }
  });

  skipIf(SKIP)('node-info should report correct machine ID per node', async () => {
    const client0 = await McpTestClient.create({
      baseUrl: nodes[0].info.baseUrl,
    }).buildAndConnect();

    const client1 = await McpTestClient.create({
      baseUrl: nodes[1].info.baseUrl,
    }).buildAndConnect();

    try {
      const result0 = await client0.tools.call('node-info', {});
      const result1 = await client1.tools.call('node-info', {});

      expect(result0).toBeSuccessful();
      expect(result1).toBeSuccessful();

      // Verify each node reports its own machine ID
      expect(result0).toHaveTextContent('node-0');
      expect(result1).toHaveTextContent('node-1');

      // Verify distributed deployment mode
      expect(result0).toHaveTextContent('distributed');
      expect(result1).toHaveTextContent('distributed');
    } finally {
      await client0.close();
      await client1.close();
    }
  });

  skipIf(SKIP)('both nodes should list the same tools', async () => {
    const client0 = await McpTestClient.create({
      baseUrl: nodes[0].info.baseUrl,
    }).buildAndConnect();

    const client1 = await McpTestClient.create({
      baseUrl: nodes[1].info.baseUrl,
    }).buildAndConnect();

    try {
      const tools0 = await client0.tools.list();
      const tools1 = await client1.tools.list();

      const toolNames0 = tools0.tools.map((t: { name: string }) => t.name).sort();
      const toolNames1 = tools1.tools.map((t: { name: string }) => t.name).sort();

      expect(toolNames0).toEqual(toolNames1);
      expect(toolNames0).toContain('echo');
      expect(toolNames0).toContain('node-info');
    } finally {
      await client0.close();
      await client1.close();
    }
  });
});
