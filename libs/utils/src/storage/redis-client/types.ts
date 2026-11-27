/**
 * The Redis client FrontMCP talks to, and the ways to configure one (#1503).
 *
 * Every Redis-backed feature (sessions, storage, the event store, HA, caches, plugins) runs the
 * commands below and nothing else. An ioredis `Redis` or `Cluster` already implements them; a
 * node-redis client or cluster gets a thin adapter; any other object that implements them works too.
 */

/** A command argument, as ioredis takes it. */
export type RedisArgument = string | number;

/** A listener for a message on a subscribed channel. */
export type RedisMessageListener = (channel: string, message: string) => void;

/**
 * A listener of a client event. Each event passes its own arguments (`message` a channel and a
 * message, `error` an Error), as with Node's EventEmitter, which ioredis's own typing also uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RedisEventListener = (...args: any[]) => void;

/** One queued command's outcome in a pipeline, as ioredis reports it: `[error, result]`. */
export type RedisPipelineResult = [Error | null, unknown];

/** A pipeline: commands queued on one connection and sent together. */
export interface FrontMcpRedisPipeline {
  set(key: string, value: string, ...args: RedisArgument[]): FrontMcpRedisPipeline;
  exec(): Promise<RedisPipelineResult[] | null>;
}

/**
 * The commands FrontMCP runs on a Redis connection, with ioredis's arguments and replies: an
 * ioredis `Redis` or `Cluster` is one as it is.
 *
 * Implement it to give FrontMCP a client of your own (`redis: { client }`). The methods marked
 * optional are only needed by the feature named beside them; the rest are used by the storage
 * adapter every Redis-backed store goes through.
 */
export interface FrontMcpRedisClient {
  // ---- Strings -------------------------------------------------------------------------
  get(key: string): Promise<string | null>;
  /** `SET key value [EX seconds | PX ms] [NX | XX]`: resolves `'OK'`, or `null` when NX/XX refused it. */
  set(key: string, value: string, ...args: RedisArgument[]): Promise<string | null>;
  /** `SETEX`: the skills HTTP cache. */
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  /** `GETEX key EX seconds`: the session store reads and extends in one step when the server has it. */
  getex?(key: string, ...args: RedisArgument[]): Promise<string | null>;
  /** `DEL`: FrontMCP sends one key per call to a cluster. */
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  /** `MGET`: sent to a single node only; a cluster gets one GET per key. */
  mget(...keys: string[]): Promise<(string | null)[]>;

  // ---- Scripts and key enumeration -----------------------------------------------------
  /** `EVAL script numKeys ...keys ...args`. Every script FrontMCP runs on a cluster touches one key. */
  eval(script: string, numKeys: number, ...keysAndArgs: RedisArgument[]): Promise<unknown>;
  /** `SCAN cursor MATCH pattern COUNT n`: resolves `[nextCursor, keys]`. Run on each master of a cluster. */
  scan(cursor: string | number, ...args: RedisArgument[]): Promise<[string, string[]]>;
  /** `KEYS pattern`: HA, the job state store and the skills cache. Run on each master of a cluster. */
  keys(pattern: string): Promise<string[]>;

  // ---- Other data types (optional: only the feature beside each needs it) --------------
  /** Sets: the job stores. */
  sadd?(key: string, ...members: string[]): Promise<number>;
  srem?(key: string, ...members: string[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  /** Hashes: the distributed transport bus. */
  hgetall?(key: string): Promise<Record<string, string>>;
  /** Streams: the SSE event store. */
  xadd?(key: string, ...args: RedisArgument[]): Promise<string | null>;
  xrange?(key: string, start: string, end: string, ...args: RedisArgument[]): Promise<[string, string[]][]>;

  // ---- Pub/sub -------------------------------------------------------------------------
  publish(channel: string, message: string): Promise<number>;
  /** Subscribe this connection; messages arrive as `on('message', (channel, message) => ...)`. */
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;

  // ---- Events (`message`, and `error` / `ready` / `connect` of a connection FrontMCP owns) ---
  on(event: string, listener: RedisEventListener): unknown;
  removeListener(event: string, listener: RedisEventListener): unknown;

  // ---- Connection ------------------------------------------------------------------------
  ping(): Promise<string>;
  /** Close after pending replies. FrontMCP calls it only on a connection it opened. */
  quit(): Promise<unknown>;
  /** Close now. FrontMCP calls it only on a connection it opened. */
  disconnect(): void;
  /**
   * A new connection with the same settings, for subscribing (a subscribed connection runs no
   * other commands). The copy belongs to whoever asked for it.
   */
  duplicate(): FrontMcpRedisClient;
  /** Connect a client created with `lazyConnect`. */
  connect?(): Promise<unknown>;
  /** Queue commands and send them together (the storage adapter's `mset` on a single node). */
  pipeline?(): FrontMcpRedisPipeline;

  // ---- Cluster ---------------------------------------------------------------------------
  /** True for a Redis Cluster client. */
  readonly isCluster?: boolean;
  /** A cluster's nodes of one role; FrontMCP asks for the masters, to scan each of them. */
  nodes?(role: 'master'): FrontMcpRedisClient[];
}

/** A seed node of a cluster: `{ host, port }`, `'host:port'`, or a `redis://` / `rediss://` URL. */
export type RedisClusterNode = { host: string; port?: number } | string;

/** How to reach a Redis Cluster. */
export interface RedisClusterConfig {
  /**
   * Seed nodes. One reachable node is enough: the rest of the cluster is discovered from it.
   * Default: the config's own `host` and `port` (or `url`).
   */
  nodes?: RedisClusterNode[];
  /**
   * ioredis `ClusterOptions`, applied over FrontMCP's defaults. Its `redisOptions` are applied over
   * the per-node defaults (password, TLS, `maxRetriesPerRequest: 3`).
   */
  options?: Record<string, unknown>;
}

/**
 * `true`: the configured host/port (or url) is a Redis Cluster endpoint, such as an AWS ElastiCache
 * configuration endpoint. An object names the seed nodes or tunes the cluster client.
 */
export type RedisClusterOption = boolean | RedisClusterConfig;

/**
 * A Redis client you created: an ioredis `Redis` or `Cluster`, a node-redis client or cluster
 * (`createClient()` / `createCluster()` from `redis` or `@redis/client`), or a
 * {@link FrontMcpRedisClient}. FrontMCP never closes it: you do, after the server stops.
 */
export type RedisClientInput = FrontMcpRedisClient | object;

/** What a client was recognized as. */
export type RedisClientKind = 'ioredis' | 'ioredis-cluster' | 'node-redis' | 'node-redis-cluster' | 'custom';

/** Connection settings FrontMCP builds a client from. */
export interface RedisConnectionSettings {
  /** `redis://` / `rediss://` URL; `host`, `port`, `password`, `db` and `tls` fill in what it leaves out. */
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  /** Connect to a Redis Cluster. */
  cluster?: RedisClusterOption;
}

/** Options of {@link createRedisConnection}. */
export interface CreateRedisConnectionOptions extends RedisConnectionSettings {
  /** A client you created; when set, the connection settings must be left out. */
  client?: RedisClientInput;
  /** Prefix of the rate-limited connection-error log line of a client FrontMCP opens. */
  label?: string;
  logger?: { warn: (message: string, ...meta: unknown[]) => void };
  /**
   * ioredis options for a client FrontMCP opens, over its defaults (`lazyConnect: false`,
   * `maxRetriesPerRequest: 3`). For a cluster, `lazyConnect` and `enableReadyCheck` apply to the
   * cluster and the rest to each node.
   */
  ioredisOptions?: Record<string, unknown>;
  /** Skip the rate-limited error listener (the caller attaches its own). */
  noErrorListener?: boolean;
}

/** A client from {@link createRedisConnection}, and who looks after it. */
export interface RedisConnection {
  /**
   * The client. For a client you passed in, `quit()` and `disconnect()` do nothing, so no feature
   * can close it; `duplicate()` still opens a real copy, which its caller closes.
   */
  readonly client: FrontMcpRedisClient;
  /** True when FrontMCP opened the client from settings and closes it on shutdown. */
  readonly owned: boolean;
  readonly kind: RedisClientKind;
  readonly isCluster: boolean;
}
