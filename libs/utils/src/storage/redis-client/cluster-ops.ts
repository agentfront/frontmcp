/**
 * The operations a Redis Cluster runs differently (#1503).
 *
 * A cluster routes a command by its key's hash slot, so a command that names several keys must not
 * span slots (CROSSSLOT), and SCAN/KEYS see only the node they run on. Each helper below takes, on a
 * single node, exactly the call FrontMCP made before, and on a cluster splits the work per key or
 * runs it on every master. No key is renamed: the same keys work on a single node and a cluster.
 */
import type { FrontMcpRedisClient } from './types';

/** What the cluster checks read: the `isCluster` flag and the nodes. */
type ClusterShape = Partial<Pick<FrontMcpRedisClient, 'isCluster' | 'nodes' | 'ping'>>;

/** A client the key enumeration can run on: SCAN, and the cluster's masters when it is one. */
export type RedisScanClient = Pick<FrontMcpRedisClient, 'scan'> & ClusterShape;

/** Whether `client` is a Redis Cluster client (ioredis `Cluster`, or node-redis cluster behind the adapter). */
export function isRedisClusterClient(client: ClusterShape | undefined): boolean {
  return client?.isCluster === true;
}

/**
 * The master nodes of a cluster client, each a client of its own. A cluster still discovering its
 * topology lists none yet, so the first command (a PING, which waits for the cluster to be ready)
 * comes before asking again.
 */
export async function redisMasterNodes<T extends ClusterShape>(client: T): Promise<Array<T | FrontMcpRedisClient>> {
  if (!isRedisClusterClient(client) || typeof client.nodes !== 'function') return [client];
  let masters = client.nodes('master');
  if (masters.length === 0) {
    await client.ping?.();
    masters = client.nodes('master');
  }
  return masters;
}

/** A SCAN loop over one node. */
async function scanNode(node: RedisScanClient, pattern: string, count: number): Promise<string[]> {
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
export async function scanRedisKeys(client: RedisScanClient, pattern: string, count = 100): Promise<string[]> {
  if (!isRedisClusterClient(client)) return scanNode(client, pattern, count);
  const perMaster = await Promise.all((await redisMasterNodes(client)).map((node) => scanNode(node, pattern, count)));
  return [...new Set(perMaster.flat())];
}

/**
 * PUBLISH a message and resolve how many subscribers it reached. A single node answers that itself.
 * A cluster delivers the message to the subscribers of every node but counts only those of the node
 * the PUBLISH ran on, so when it reports none the channel's subscribers are counted on every node
 * (`PUBSUB NUMSUB`): a caller that treats 0 as "nobody listens" then stays right on a cluster.
 */
export async function publishRedisMessage(
  client: Pick<FrontMcpRedisClient, 'publish'> & ClusterShape,
  channel: string,
  message: string,
): Promise<number> {
  if (!isRedisClusterClient(client) || typeof client.nodes !== 'function') {
    return Number(await client.publish(channel, message));
  }
  // A cluster client sends a keyless PUBLISH to any node, and messages that enter the cluster at
  // different nodes can reach a subscriber out of order: a relayed response's frames arrived with
  // its end before its body. Every message on one channel goes through one node instead.
  const node = await pubsubNodeFor(client, channel);
  const received = Number(await node.publish(channel, message));
  if (received > 0) return received;
  return countRedisSubscribers(client, channel);
}

/**
 * How many connections listen on `channel` (`PUBSUB NUMSUB`). A cluster node counts only the connections
 * subscribed through it, so a cluster's count adds up every node's. A node that can't answer (failing
 * over) counts none.
 */
export async function countRedisSubscribers(
  client: Pick<FrontMcpRedisClient, 'pubsub'> & ClusterShape,
  channel: string,
): Promise<number> {
  const nodes: Array<Pick<FrontMcpRedisClient, 'pubsub'>> =
    isRedisClusterClient(client) && typeof client.nodes === 'function' ? client.nodes('all') : [client];
  const counts = await Promise.all(
    nodes.map(async (node) => {
      if (typeof node.pubsub !== 'function') return 0;
      try {
        const reply = (await node.pubsub('NUMSUB', channel)) as unknown[];
        return Number(reply?.[1] ?? 0);
      } catch {
        return 0;
      }
    }),
  );
  return counts.reduce((total, count) => total + count, 0);
}

/** The address a node client connects to, to order a cluster's masters the same way every time. */
function nodeAddress(node: object): string {
  const { options, address } = node as { options?: { host?: string; port?: number }; address?: string };
  return address ?? `${options?.host ?? ''}:${options?.port ?? ''}`;
}

/** A small, stable hash of a channel name, to spread channels over the masters. */
function channelHash(channel: string): number {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) hash = (Math.imul(hash, 31) + channel.charCodeAt(i)) >>> 0;
  return hash;
}

/** The master every PUBLISH on `channel` goes through, so its messages keep their order. */
async function pubsubNodeFor(
  client: Pick<FrontMcpRedisClient, 'publish'> & ClusterShape,
  channel: string,
): Promise<Pick<FrontMcpRedisClient, 'publish'>> {
  const masters = (await redisMasterNodes(client)) as Array<Pick<FrontMcpRedisClient, 'publish'>>;
  if (masters.length === 0) return client;
  const ordered = [...masters].sort((a, b) => nodeAddress(a).localeCompare(nodeAddress(b)));
  return ordered[channelHash(channel) % ordered.length];
}

/** Delete `keys`: one DEL on a single node, as before; one DEL per key on a cluster. Resolves how many existed. */
export async function deleteRedisKeys(
  client: Pick<FrontMcpRedisClient, 'del'> & ClusterShape,
  keys: string[],
): Promise<number> {
  if (keys.length === 0) return 0;
  if (!isRedisClusterClient(client) || keys.length === 1) return client.del(...keys);
  const counts = await Promise.all(keys.map((key) => client.del(key)));
  return counts.reduce((total, count) => total + Number(count), 0);
}

/** Read `keys` in order: one MGET on a single node, as before; one GET per key on a cluster. */
export async function getRedisKeys(
  client: Pick<FrontMcpRedisClient, 'get' | 'mget'> & ClusterShape,
  keys: string[],
): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  if (!isRedisClusterClient(client)) return client.mget(...keys);
  return Promise.all(keys.map((key) => client.get(key)));
}
