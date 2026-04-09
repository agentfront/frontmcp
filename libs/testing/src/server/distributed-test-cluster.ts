/**
 * Distributed Test Cluster
 *
 * Manages multiple TestServer instances that share a single Redis,
 * each with a unique MACHINE_ID and FRONTMCP_DEPLOYMENT_MODE=distributed.
 * Used for E2E testing of session scaling, SSE routing, and takeover.
 */

import { TestServer, type TestServerInfo } from './test-server';

export interface ClusterNode {
  /** Node index (0-based) */
  index: number;
  /** Machine ID for this node */
  machineId: string;
  /** Server info (baseUrl, port) */
  info: TestServerInfo;
  /** Underlying TestServer instance */
  server: TestServer;
}

export interface DistributedClusterOptions {
  /** Redis URL (e.g., redis://localhost:6379) */
  redisUrl: string;
  /** Path to the server entry file (e.g., apps/e2e/demo-e2e-distributed/src/main.ts) */
  serverEntry: string;
  /** E2E project name for port allocation */
  project?: string;
  /** Additional environment variables for all nodes */
  env?: Record<string, string>;
  /** Server startup timeout in ms (default: 45000) */
  startupTimeout?: number;
}

/**
 * Manages a cluster of FrontMCP server instances for distributed testing.
 *
 * @example
 * ```typescript
 * const redis = await startRedisContainer();
 * const cluster = new DistributedTestCluster({
 *   redisUrl: redis.url,
 *   serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.ts',
 *   project: 'demo-e2e-distributed',
 * });
 *
 * const nodes = await cluster.start(2);
 * // nodes[0].info.baseUrl, nodes[1].info.baseUrl
 *
 * await cluster.stopNode(0); // simulate pod death
 * await cluster.teardown();
 * ```
 */
export class DistributedTestCluster {
  private nodes: Map<number, { server: TestServer; machineId: string }> = new Map();
  private readonly options: DistributedClusterOptions;

  constructor(options: DistributedClusterOptions) {
    this.options = options;
  }

  /**
   * Start N server instances with unique MACHINE_IDs sharing the same Redis.
   */
  async start(count: number): Promise<ClusterNode[]> {
    const results: ClusterNode[] = [];

    try {
      for (let i = 0; i < count; i++) {
        const node = await this.startNode(i);
        results.push(node);
      }
      return results;
    } catch (error) {
      // Tear down any nodes that started before the failure
      await this.teardown();
      throw error;
    }
  }

  /**
   * Start a single node at the given index.
   */
  async startNode(index: number): Promise<ClusterNode> {
    const machineId = `node-${index}`;
    const project = this.options.project ?? 'demo-e2e-distributed';

    // Let TestServer.start handle port reservation via reservePort(project)
    const server = await TestServer.start({
      command: `npx ts-node --swc -P apps/e2e/demo-e2e-distributed/tsconfig.app.json ${this.options.serverEntry}`,
      project,
      startupTimeout: this.options.startupTimeout ?? 45_000,
      env: {
        MACHINE_ID: machineId,
        REDIS_URL: this.options.redisUrl,
        NODE_ENV: 'test',
        ...this.options.env,
      },
    });

    this.nodes.set(index, { server, machineId });

    return {
      index,
      machineId,
      info: server.info,
      server,
    };
  }

  /**
   * Stop a specific node (simulate pod death).
   * Does NOT release the port — call restartNode() to reuse it.
   */
  async stopNode(index: number): Promise<void> {
    const node = this.nodes.get(index);
    if (!node) return;
    await node.server.stop();
  }

  /**
   * Get info for a running node.
   */
  getNode(index: number): ClusterNode | undefined {
    const node = this.nodes.get(index);
    if (!node) return undefined;
    return {
      index,
      machineId: node.machineId,
      info: node.server.info,
      server: node.server,
    };
  }

  /**
   * Stop all nodes and release ports.
   */
  async teardown(): Promise<void> {
    const stops = [...this.nodes.entries()].map(async ([_index, node]) => {
      try {
        await node.server.stop();
      } catch {
        // Best effort
      }
    });
    await Promise.all(stops);
    this.nodes.clear();
  }
}
