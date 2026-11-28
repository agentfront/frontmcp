/**
 * The one place FrontMCP opens or adopts a Redis client (#1503).
 *
 * - Connection settings (`host`/`port`, or a `url`) open an ioredis `Redis`, exactly as before.
 * - The same settings with `cluster` open an ioredis `Cluster` from that endpoint (or the given
 *   seed nodes), with what AWS ElastiCache needs: hostnames kept for TLS, and TLS and the password
 *   applied to every node.
 * - A `client` the application made is adopted: an ioredis `Redis`/`Cluster` or a FrontMcpRedisClient
 *   as it is, a node-redis client/cluster behind {@link NodeRedisClientAdapter}. FrontMCP never closes it.
 *
 * ioredis is required only when a client is opened, so a bundle that never opens one doesn't carry it.
 */
import { StorageConfigError } from '../errors';
import { attachRedisErrorListener } from '../redis-error-listener';
import {
  describeRedisUrlConflicts,
  mergeRedisUrlFields,
  readRedisUrl,
  type RedisUrlMerge,
  type RedisUrlSiblingFields,
} from '../redis-url';
import { borrowRedisClient } from './borrow';
import {
  detectRedisClientKind,
  incompleteRedisClientMessage,
  missingRedisClientMethods,
  UNSUPPORTED_REDIS_CLIENT_MESSAGE,
} from './detect';
import { NodeRedisClientAdapter, type NodeRedisLike } from './node-redis-adapter';
import type {
  CreateRedisConnectionOptions,
  FrontMcpRedisClient,
  RedisClientKind,
  RedisClusterConfig,
  RedisClusterNode,
  RedisConnection,
  RedisConnectionSettings,
} from './types';

type IoredisModule = typeof import('ioredis');
type IoredisClass = IoredisModule['default'];
type IoredisOptions = import('ioredis').RedisOptions;

/** ioredis, required when a client is opened, so that browser builds never bundle it. */
export function loadIoredis(): IoredisClass {
  try {
    return require('ioredis').default || require('ioredis');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Check if it's a bundler/ESM issue and provide helpful error
    if (msg.includes('Dynamic require') || msg.includes('require is not defined')) {
      throw new Error(
        `Failed to load ioredis: ${msg}. ` +
          'This typically happens with ESM bundlers (esbuild, Vite). ' +
          'Ensure your bundler externalizes ioredis or use CJS mode.',
        { cause: error },
      );
    }

    throw new Error('ioredis is required for Redis storage adapter. Install it with: npm install ioredis', {
      cause: error,
    });
  }
}

/** What every client FrontMCP opens starts from. */
const BASE_OPTIONS = { lazyConnect: false, maxRetriesPerRequest: 3 } as const;

/**
 * How often a cluster that has never been reached retries before its commands fail. A single node
 * fails a command after `maxRetriesPerRequest: 3`; an ioredis Cluster would queue it for as long as
 * the cluster stays down, so a server could hang at startup. Once up, it reconnects indefinitely.
 */
const INITIAL_CLUSTER_RETRIES = 3;

/** ioredis's own reconnect delay for a cluster. */
function clusterRetryDelay(times: number): number {
  return Math.min(100 + times * 2, 2000);
}

/** Options of a Cluster as a whole; the rest of `ioredisOptions` go to each node. */
const CLUSTER_LEVEL_OPTIONS = new Set([
  'lazyConnect',
  'enableReadyCheck',
  'enableOfflineQueue',
  'scaleReads',
  'keyPrefix',
]);

/** The connection fields a URL leaves out, as ioredis options. */
function toFillInOptions({ port, password, db, tls }: RedisUrlMerge['fillIns']): IoredisOptions {
  return {
    ...(port !== undefined ? { port } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(tls ? { tls: {} } : {}),
  };
}

/**
 * The ioredis options for a url and the fields beside it: what the URL states, then what the fields
 * fill in. ioredis would keep a username-only URL's empty password over a filled-in one, so it gets
 * these options instead of the URL. A field that contradicts the URL throws a StorageConfigError;
 * undefined for a URL only ioredis reads.
 */
export function urlConnectionOptions(url: string, fields: RedisUrlSiblingFields): IoredisOptions | undefined {
  const merge = mergeRedisUrlFields(url, fields);
  if (!merge) return undefined;
  if (merge.conflicts.length > 0) {
    throw new StorageConfigError('redis', describeRedisUrlConflicts(merge.conflicts));
  }
  const { queryOptions, tls, ...stated } = merge.connection;
  return { ...queryOptions, ...stated, ...toFillInOptions(merge.fillIns), ...(tls ? { tls: {} } : {}) };
}

/** Whether `cluster` asks for a cluster client. */
export function wantsRedisCluster(cluster: RedisConnectionSettings['cluster']): boolean {
  return cluster === true || (typeof cluster === 'object' && cluster !== null);
}

function clusterConfigOf(cluster: RedisConnectionSettings['cluster']): RedisClusterConfig {
  return typeof cluster === 'object' && cluster !== null ? cluster : {};
}

/** A seed node as ioredis takes it, with what a `redis://` node URL states about the connection. */
interface SeedNode {
  host: string;
  port: number;
  password?: string;
  username?: string;
  tls?: boolean;
  /** The URL scheme of a seed given as a URL. */
  scheme?: 'redis' | 'rediss';
}

function parseSeedNode(node: RedisClusterNode): SeedNode {
  if (typeof node !== 'string') {
    if (!node || typeof node.host !== 'string' || node.host.length === 0) {
      throw new StorageConfigError('redis', 'redis.cluster.nodes: each node needs a host');
    }
    return { host: node.host, port: node.port ?? 6379 };
  }
  if (/^rediss?:\/\//i.test(node)) {
    const read = readRedisUrl(node);
    if (!read?.host) throw new StorageConfigError('redis', `redis.cluster.nodes: "${node}" is not a usable Redis URL`);
    return {
      host: read.host,
      port: read.port ?? 6379,
      password: read.password,
      username: read.username,
      tls: read.tls,
      scheme: read.tls ? 'rediss' : 'redis',
    };
  }
  // `host:port`, `[ipv6]:port`, or a bare host
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d+))?$/.exec(node.trim());
  const host = match?.[1] ?? match?.[2];
  if (!host) throw new StorageConfigError('redis', `redis.cluster.nodes: "${node}" is not host:port`);
  return { host, port: match?.[3] ? Number(match[3]) : 6379 };
}

/**
 * The seed nodes and the per-node connection options of a cluster: from `cluster.nodes`, else the
 * config's own endpoint (`host`/`port`, or the `url` with what the fields beside it fill in).
 */
function clusterEndpoint(settings: RedisConnectionSettings): { nodes: SeedNode[]; node: IoredisOptions } {
  const { url, host, port, password, db, tls } = settings;
  if (db !== undefined && db !== 0) {
    throw new StorageConfigError('redis', `redis.db is ${db}, but a Redis Cluster has database 0 only`);
  }
  const fromUrl = url ? urlConnectionOptions(url, { host, port, password, db, tls }) : undefined;
  if (url && !fromUrl) {
    throw new StorageConfigError('redis', 'redis.url must be a redis:// or rediss:// URL to reach a Redis Cluster');
  }
  if (fromUrl?.db !== undefined && fromUrl.db !== 0) {
    throw new StorageConfigError(
      'redis',
      `redis.url names database ${fromUrl.db}, but a Redis Cluster has database 0 only`,
    );
  }

  const explicit = clusterConfigOf(settings.cluster).nodes;
  const seeds: SeedNode[] =
    explicit && explicit.length > 0
      ? explicit.map(parseSeedNode)
      : fromUrl
        ? [{ host: String(fromUrl.host ?? 'localhost'), port: Number(fromUrl.port ?? 6379) }]
        : host
          ? [{ host, port: port ?? 6379 }]
          : [];
  if (seeds.length === 0) {
    throw new StorageConfigError(
      'redis',
      'redis.cluster needs a node to start from: set host (or url), or cluster.nodes',
    );
  }

  // Every node of a cluster is reached the same way, so the seed list is read as a whole: one scheme,
  // one set of credentials. TLS is on when the url, the config or any seed asks for it, so a seed list
  // never connects in cleartext to a node another seed reaches over TLS.
  const schemes = new Set(seeds.map((seed) => seed.scheme).filter((scheme) => scheme !== undefined));
  if (schemes.size > 1) {
    throw new StorageConfigError(
      'redis',
      'redis.cluster.nodes mixes redis:// and rediss:// seeds; a cluster reaches every node the same way: ' +
        'use rediss:// for all of them (TLS), or redis:// for all',
    );
  }
  const nodePassword = fromUrl?.password ?? password ?? oneSeedValue(seeds, 'password');
  const nodeUsername = fromUrl?.username ?? oneSeedValue(seeds, 'username');
  const nodeTls = Boolean(fromUrl?.tls) || tls === true || seeds.some((seed) => seed.tls === true);
  return {
    nodes: seeds.map(({ host: seedHost, port: seedPort }) => ({ host: seedHost, port: seedPort })),
    node: {
      ...(nodePassword !== undefined ? { password: nodePassword } : {}),
      ...(nodeUsername !== undefined ? { username: nodeUsername } : {}),
      ...(nodeTls ? { tls: {} } : {}),
    },
  };
}

/** The one value the seed URLs give for a credential, refusing seeds that disagree. */
function oneSeedValue(seeds: SeedNode[], field: 'password' | 'username'): string | undefined {
  const values = new Set(seeds.map((seed) => seed[field]).filter((value) => value !== undefined));
  if (values.size > 1) {
    throw new StorageConfigError(
      'redis',
      `redis.cluster.nodes give different ${field}s; a cluster takes one for every node`,
    );
  }
  return values.values().next().value;
}

/** Options without the ones set to undefined, which must not clear what the settings say (TLS from a rediss:// seed). */
function definedOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

/** An ioredis Cluster from connection settings. */
function openIoredisCluster(
  settings: RedisConnectionSettings,
  overrides: Record<string, unknown>,
): FrontMcpRedisClient {
  const { nodes, node } = clusterEndpoint(settings);
  const { redisOptions: userNodeOptions, ...userClusterOptions } = clusterConfigOf(settings.cluster).options ?? {};

  const clusterLevel: Record<string, unknown> = { lazyConnect: BASE_OPTIONS.lazyConnect };
  const nodeLevel: Record<string, unknown> = { maxRetriesPerRequest: BASE_OPTIONS.maxRetriesPerRequest, ...node };
  for (const [name, value] of Object.entries(definedOptions(overrides))) {
    (CLUSTER_LEVEL_OPTIONS.has(name) ? clusterLevel : nodeLevel)[name] = value;
  }

  let reachedOnce = false;
  const RedisClass = loadIoredis();
  const cluster = new RedisClass.Cluster(nodes, {
    // Keep the hostname: ElastiCache's TLS certificate names it, not the address it resolves to
    // (the ioredis README's note on ElastiCache).
    dnsLookup: (address: string, callback: (error: Error | null, address: string) => void) => callback(null, address),
    clusterRetryStrategy: (times: number) =>
      reachedOnce || times <= INITIAL_CLUSTER_RETRIES ? clusterRetryDelay(times) : null,
    ...clusterLevel,
    ...userClusterOptions,
    redisOptions: { ...nodeLevel, ...definedOptions((userNodeOptions ?? {}) as Record<string, unknown>) },
  });
  cluster.once('ready', () => {
    reachedOnce = true;
  });
  return cluster as unknown as FrontMcpRedisClient;
}

/** An ioredis Redis from connection settings: the options FrontMCP always used. */
function openIoredisClient(settings: RedisConnectionSettings, overrides: Record<string, unknown>): FrontMcpRedisClient {
  const { url, host, port, password, db, tls } = settings;
  const urlOptions = url ? urlConnectionOptions(url, { host, port, password, db, tls }) : undefined;
  const RedisClass = loadIoredis();
  const base = { ...BASE_OPTIONS, ...overrides };
  let client: InstanceType<IoredisClass>;
  if (urlOptions) {
    client = new RedisClass({ ...base, ...urlOptions });
  } else if (url) {
    // A URL ioredis reads by itself (a socket path, another scheme)
    client = new RedisClass(url, base);
  } else {
    // ioredisOptions come last: a caller that hands over its own ioredis options (a TLS object, a
    // keyPrefix) has them applied as given
    client = new RedisClass({
      ...BASE_OPTIONS,
      host: host ?? 'localhost',
      port: port ?? 6379,
      password,
      db: db ?? 0,
      tls: tls ? {} : undefined,
      ...overrides,
    });
  }
  return client as unknown as FrontMcpRedisClient;
}

/**
 * Adopt a client the application made, recognized by its shape. It is never closed by FrontMCP:
 * its `quit()`/`disconnect()` become no-ops here, while `duplicate()` still opens a real copy.
 *
 * @param strict refuse an object that isn't recognizable as a Redis client (otherwise it is used as
 *   given, as `RedisStorageAdapter({ client })` always did)
 */
export function adoptRedisClient(
  client: object,
  options: { strict?: boolean } = {},
): { client: FrontMcpRedisClient; kind: RedisClientKind; isCluster: boolean } {
  const kind = detectRedisClientKind(client);
  if (kind === 'node-redis' || kind === 'node-redis-cluster') {
    refuseNodeRedisKeyPrefix(client);
    const isCluster = kind === 'node-redis-cluster';
    return {
      client: new NodeRedisClientAdapter(client as NodeRedisLike, { cluster: isCluster, owned: false }),
      kind,
      isCluster,
    };
  }
  if (kind === undefined && options.strict) throw new StorageConfigError('redis', UNSUPPORTED_REDIS_CLIENT_MESSAGE);
  if (kind === 'custom' && options.strict) {
    const missing = missingRedisClientMethods(client);
    if (missing.length > 0) throw new StorageConfigError('redis', incompleteRedisClientMessage(missing));
  }
  const adopted = borrowRedisClient(client) as FrontMcpRedisClient;
  return { client: adopted, kind: kind ?? 'custom', isCluster: adopted.isCluster === true };
}

/**
 * node-redis (v5+) can prefix every key it sends (`keyPrefix`), but only in its own commands: the
 * adapter sends raw `sendCommand` calls, which node-redis passes through unprefixed. Applying the
 * prefix in the adapter would mean knowing the key positions of every command, the keys of every
 * script and the patterns of every SCAN, and a mistake there would read or write other keys without
 * any error, so a prefixed client is refused with a way out instead.
 */
function refuseNodeRedisKeyPrefix(client: object): void {
  const { _keyPrefix: keyPrefix } = client as { _keyPrefix?: unknown };
  if (keyPrefix === undefined || keyPrefix === null || String(keyPrefix) === '') return;
  throw new StorageConfigError(
    'redis',
    `redis.client is a node-redis client with keyPrefix "${String(keyPrefix)}", which FrontMCP's commands would not get: ` +
      "create the client without keyPrefix and set the keyPrefix of the FrontMCP option instead (redis.keyPrefix, or the store's own)",
  );
}

/** Whether connection settings are given beside a `client`. */
function settingsBesideClient(options: CreateRedisConnectionOptions): string[] {
  return (['url', 'host', 'port', 'password', 'db', 'tls', 'cluster'] as const).filter(
    (field) => options[field] !== undefined && !(field === 'cluster' && options.cluster === false),
  );
}

/**
 * Open (or adopt) the Redis client of one feature.
 *
 * @example a single node, as FrontMCP always opened it
 * ```ts
 * const { client } = createRedisConnection({ host: 'localhost', port: 6379 });
 * ```
 * @example an AWS ElastiCache cluster (cluster mode on, in-transit encryption on)
 * ```ts
 * const { client } = createRedisConnection({ host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com', tls: true, cluster: true });
 * ```
 * @example a client you made (ioredis or node-redis)
 * ```ts
 * const { client, owned } = createRedisConnection({ client: myCluster }); // owned === false
 * ```
 */
export function createRedisConnection(options: CreateRedisConnectionOptions): RedisConnection {
  if (options.client !== undefined) {
    const beside = settingsBesideClient(options);
    if (beside.length > 0) {
      throw new StorageConfigError(
        'redis',
        `redis.client carries its own connection; drop ${beside.join(', ')} beside it (or drop client)`,
      );
    }
    if (typeof options.client !== 'object' || options.client === null) {
      throw new StorageConfigError('redis', UNSUPPORTED_REDIS_CLIENT_MESSAGE);
    }
    const adopted = adoptRedisClient(options.client, { strict: true });
    return { ...adopted, owned: false };
  }

  const overrides = options.ioredisOptions ?? {};
  const isCluster = wantsRedisCluster(options.cluster);
  const client = isCluster ? openIoredisCluster(options, overrides) : openIoredisClient(options, overrides);
  if (!options.noErrorListener) {
    attachRedisErrorListener(client, { label: options.label ?? 'redis', logger: options.logger });
  }
  return { client, owned: true, kind: isCluster ? 'ioredis-cluster' : 'ioredis', isCluster };
}
