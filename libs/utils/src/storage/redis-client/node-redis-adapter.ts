/**
 * node-redis (`redis` / `@redis/client`, v4 and later) behind the {@link FrontMcpRedisClient}
 * interface (#1503).
 *
 * Every command goes out as `sendCommand([...])` with ioredis's arguments, which node-redis v4 to v6
 * all take, and comes back as ioredis would return it (RESP2 replies need no mapping, except HGETALL).
 * On a cluster, a command is routed by its first key; PING, PUBLISH and SCAN go to any node, and the
 * key-enumeration helpers scan each master through {@link NodeRedisClientAdapter.nodes}.
 *
 * FrontMCP never loads node-redis: it only wraps a client the application made.
 */
import type {
  FrontMcpRedisClient,
  FrontMcpRedisPipeline,
  RedisArgument,
  RedisEventListener,
  RedisMessageListener,
  RedisPipelineResult,
} from './types';

type NodeRedisMessageListener = (message: string, channel: string) => void;

/** The parts of a node-redis client or cluster the adapter uses. */
export interface NodeRedisLike {
  /** A client: `sendCommand(args)`. A cluster: `sendCommand(firstKey, isReadonly, args)`. */
  sendCommand(...args: unknown[]): Promise<unknown>;
  connect(): Promise<unknown>;
  readonly isOpen: boolean;
  duplicate(): NodeRedisLike;
  subscribe(channels: string | string[], listener: NodeRedisMessageListener): Promise<unknown>;
  unsubscribe(channels?: string | string[], listener?: NodeRedisMessageListener): Promise<unknown>;
  on(event: string, listener: RedisEventListener): unknown;
  removeListener?(event: string, listener: RedisEventListener): unknown;
  off?(event: string, listener: RedisEventListener): unknown;
  /** v5+; v4 has `quit()`. */
  close?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  /** v5+; v4 has `disconnect()`. */
  destroy?(): void;
  disconnect?(): Promise<unknown>;
  /** A cluster's masters, and the client of one of them. */
  readonly masters?: unknown[];
  nodeClient?(node: unknown): NodeRedisLike | Promise<NodeRedisLike>;
}

export interface NodeRedisClientAdapterOptions {
  /** The target is a node-redis cluster. */
  cluster: boolean;
  /** FrontMCP opened the target (a `duplicate()`), so `quit()`/`disconnect()` close it. */
  owned: boolean;
}

/** HGETALL's reply as ioredis returns it: an object, from RESP2's flat array or RESP3's map. */
function toHash(reply: unknown): Record<string, string> {
  if (Array.isArray(reply)) {
    const hash: Record<string, string> = {};
    for (let i = 0; i + 1 < reply.length; i += 2) hash[String(reply[i])] = String(reply[i + 1]);
    return hash;
  }
  if (reply instanceof Map)
    return Object.fromEntries([...reply].map(([field, value]) => [String(field), String(value)]));
  return (reply ?? {}) as Record<string, string>;
}

export class NodeRedisClientAdapter implements FrontMcpRedisClient {
  readonly isCluster: boolean;
  private readonly owned: boolean;
  private resolved?: NodeRedisLike;
  private connecting?: Promise<void>;
  private readonly messageListeners = new Set<RedisMessageListener>();
  private readonly onChannelMessage: NodeRedisMessageListener = (message, channel) => {
    for (const listener of [...this.messageListeners]) listener(channel, message);
  };

  /**
   * @param target the node-redis client or cluster, or a function that resolves one (a cluster's
   *   node client, which the cluster hands out asynchronously)
   */
  constructor(
    private readonly target: NodeRedisLike | (() => NodeRedisLike | Promise<NodeRedisLike>),
    options: NodeRedisClientAdapterOptions,
  ) {
    this.isCluster = options.cluster;
    this.owned = options.owned;
    if (typeof target !== 'function') this.resolved = target;
  }

  // ---- connection -------------------------------------------------------------------------

  /** The client, connected: node-redis runs no command before `connect()`, so the first use connects it, once. */
  private async ready(): Promise<NodeRedisLike> {
    const client =
      this.resolved ?? (this.resolved = await (this.target as () => NodeRedisLike | Promise<NodeRedisLike>)());
    if (!client.isOpen) {
      this.connecting ??= Promise.resolve(client.connect())
        .then(() => undefined)
        .finally(() => {
          this.connecting = undefined;
        });
      await this.connecting;
    }
    return client;
  }

  private async send(args: RedisArgument[], firstKey?: string, readonly = false): Promise<unknown> {
    const client = await this.ready();
    const argv = args.map(String);
    return this.isCluster ? client.sendCommand(firstKey, readonly, argv) : client.sendCommand(argv);
  }

  async connect(): Promise<void> {
    await this.ready();
  }

  async ping(): Promise<string> {
    return String(await this.send(['PING'], undefined, true));
  }

  async quit(): Promise<unknown> {
    if (!this.owned || !this.resolved) return 'OK';
    const client = this.resolved;
    if (!client.isOpen) return 'OK';
    return typeof client.close === 'function' ? client.close() : client.quit?.();
  }

  disconnect(): void {
    if (!this.owned || !this.resolved) return;
    const client = this.resolved;
    if (typeof client.destroy === 'function') client.destroy();
    else void client.disconnect?.()?.catch(() => undefined);
  }

  duplicate(): FrontMcpRedisClient {
    const copy = this.resolved?.duplicate();
    if (!copy) throw new Error('A node-redis cluster node cannot be duplicated');
    return new NodeRedisClientAdapter(copy, { cluster: this.isCluster, owned: true });
  }

  /** The masters of a cluster (the only role FrontMCP asks for). */
  nodes(): FrontMcpRedisClient[] {
    const cluster = this.resolved;
    if (!this.isCluster || !cluster || !Array.isArray(cluster.masters)) return [];
    return cluster.masters.map(
      (master) =>
        new NodeRedisClientAdapter(() => (cluster.nodeClient as (node: unknown) => NodeRedisLike)(master), {
          cluster: false,
          // The cluster opened its node clients and closes them.
          owned: false,
        }),
    );
  }

  // ---- events -----------------------------------------------------------------------------

  on(event: string, listener: RedisEventListener): this {
    if (event === 'message') this.messageListeners.add(listener as RedisMessageListener);
    else this.resolved?.on(event, listener);
    return this;
  }

  removeListener(event: string, listener: RedisEventListener): this {
    if (event === 'message') this.messageListeners.delete(listener as RedisMessageListener);
    else if (this.resolved?.removeListener) this.resolved.removeListener(event, listener);
    else this.resolved?.off?.(event, listener);
    return this;
  }

  // ---- pub/sub ------------------------------------------------------------------------------

  async publish(channel: string, message: string): Promise<number> {
    return Number(await this.send(['PUBLISH', channel, message]));
  }

  async subscribe(...channels: string[]): Promise<number> {
    const client = await this.ready();
    await client.subscribe(channels, this.onChannelMessage);
    return channels.length;
  }

  async unsubscribe(...channels: string[]): Promise<number> {
    const client = await this.ready();
    await client.unsubscribe(channels, this.onChannelMessage);
    return channels.length;
  }

  // ---- strings ------------------------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return (await this.send(['GET', key], key, true)) as string | null;
  }

  async set(key: string, value: string, ...args: RedisArgument[]): Promise<string | null> {
    return (await this.send(['SET', key, value, ...args], key)) as string | null;
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    return this.send(['SETEX', key, seconds, value], key);
  }

  async getex(key: string, ...args: RedisArgument[]): Promise<string | null> {
    return (await this.send(['GETEX', key, ...args], key)) as string | null;
  }

  async del(...keys: string[]): Promise<number> {
    return Number(await this.send(['DEL', ...keys], keys[0]));
  }

  async exists(...keys: string[]): Promise<number> {
    return Number(await this.send(['EXISTS', ...keys], keys[0], true));
  }

  async expire(key: string, seconds: number): Promise<number> {
    return Number(await this.send(['EXPIRE', key, seconds], key));
  }

  async ttl(key: string): Promise<number> {
    return Number(await this.send(['TTL', key], key, true));
  }

  async incr(key: string): Promise<number> {
    return Number(await this.send(['INCR', key], key));
  }

  async decr(key: string): Promise<number> {
    return Number(await this.send(['DECR', key], key));
  }

  async incrby(key: string, amount: number): Promise<number> {
    return Number(await this.send(['INCRBY', key, amount], key));
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return (await this.send(['MGET', ...keys], keys[0], true)) as (string | null)[];
  }

  // ---- scripts and enumeration ----------------------------------------------------------------

  async eval(script: string, numKeys: number, ...keysAndArgs: RedisArgument[]): Promise<unknown> {
    const firstKey = numKeys > 0 ? String(keysAndArgs[0]) : undefined;
    return this.send(['EVAL', script, numKeys, ...keysAndArgs], firstKey);
  }

  async scan(cursor: string | number, ...args: RedisArgument[]): Promise<[string, string[]]> {
    const [next, keys] = (await this.send(['SCAN', cursor, ...args], undefined, true)) as [unknown, unknown];
    return [String(next), Array.isArray(keys) ? keys.map(String) : []];
  }

  async keys(pattern: string): Promise<string[]> {
    return ((await this.send(['KEYS', pattern], undefined, true)) as unknown[]).map(String);
  }

  // ---- sets, hashes, streams ----------------------------------------------------------------

  async sadd(key: string, ...members: string[]): Promise<number> {
    return Number(await this.send(['SADD', key, ...members], key));
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return Number(await this.send(['SREM', key, ...members], key));
  }

  async smembers(key: string): Promise<string[]> {
    return ((await this.send(['SMEMBERS', key], key, true)) as unknown[]).map(String);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return toHash(await this.send(['HGETALL', key], key, true));
  }

  async xadd(key: string, ...args: RedisArgument[]): Promise<string | null> {
    return (await this.send(['XADD', key, ...args], key)) as string | null;
  }

  async xrange(key: string, start: string, end: string, ...args: RedisArgument[]): Promise<[string, string[]][]> {
    return (await this.send(['XRANGE', key, start, end, ...args], key, true)) as [string, string[]][];
  }

  // ---- pipeline -----------------------------------------------------------------------------

  pipeline(): FrontMcpRedisPipeline {
    const queued: Array<() => Promise<unknown>> = [];
    const pipeline: FrontMcpRedisPipeline = {
      set: (key, value, ...args) => {
        queued.push(() => this.set(key, value, ...args));
        return pipeline;
      },
      // node-redis sends the commands of one tick together, so this is one round trip, as in ioredis.
      exec: async () =>
        Promise.all(
          queued.map((run) =>
            run().then(
              (result): RedisPipelineResult => [null, result],
              (error: unknown): RedisPipelineResult => [
                error instanceof Error ? error : new Error(String(error)),
                null,
              ],
            ),
          ),
        ),
    };
    return pipeline;
  }
}
