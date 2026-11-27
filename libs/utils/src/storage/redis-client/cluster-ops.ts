/**
 * The operations a Redis Cluster runs differently (#1503).
 *
 * A cluster routes a command by its key's hash slot, so a command that names several keys must not
 * span slots (CROSSSLOT), and SCAN/KEYS see only the node they run on. Each helper below takes, on a
 * single node, exactly the call FrontMCP made before, and on a cluster splits the work per key or
 * runs it on every master. No key is renamed: the same keys work on a single node and a cluster.
 */
import type { FrontMcpRedisClient } from './types';

/** Whether `client` is a Redis Cluster client (ioredis `Cluster`, or node-redis cluster behind the adapter). */
export function isRedisClusterClient(client: Pick<FrontMcpRedisClient, 'isCluster'> | undefined): boolean {
  return client?.isCluster === true;
}

/**
 * The master nodes of a cluster client, each a client of its own. A cluster still discovering its
 * topology lists none yet, so the first command (a PING, which waits for the cluster to be ready)
 * comes before asking again.
 */
export async function redisMasterNodes(client: FrontMcpRedisClient): Promise<FrontMcpRedisClient[]> {
  if (!isRedisClusterClient(client) || typeof client.nodes !== 'function') return [client];
  let masters = client.nodes('master');
  if (masters.length === 0) {
    await client.ping();
    masters = client.nodes('master');
  }
  return masters;
}

/** A SCAN loop over one node. */
async function scanNode(node: FrontMcpRedisClient, pattern: string, count: number): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    cursor = String(nextCursor);
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}

/**
 * The keys matching `pattern`, by SCAN: on a single node, the loop FrontMCP always ran; on a
 * cluster, the same loop on every master, with a key reported twice (a slot moving mid-scan) once.
 */
export async function scanRedisKeys(client: FrontMcpRedisClient, pattern: string, count = 100): Promise<string[]> {
  if (!isRedisClusterClient(client)) return scanNode(client, pattern, count);
  const perMaster = await Promise.all((await redisMasterNodes(client)).map((node) => scanNode(node, pattern, count)));
  return [...new Set(perMaster.flat())];
}

/** Delete `keys`: one DEL on a single node, as before; one DEL per key on a cluster. Resolves how many existed. */
export async function deleteRedisKeys(client: FrontMcpRedisClient, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  if (!isRedisClusterClient(client) || keys.length === 1) return client.del(...keys);
  const counts = await Promise.all(keys.map((key) => client.del(key)));
  return counts.reduce((total, count) => total + Number(count), 0);
}

/** Read `keys` in order: one MGET on a single node, as before; one GET per key on a cluster. */
export async function getRedisKeys(client: FrontMcpRedisClient, keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  if (!isRedisClusterClient(client)) return client.mget(...keys);
  return Promise.all(keys.map((key) => client.get(key)));
}
