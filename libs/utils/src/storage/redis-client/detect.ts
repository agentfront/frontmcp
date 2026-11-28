/**
 * Recognize a Redis client by its shape, never with `instanceof`: an app may carry its own copy of
 * ioredis or node-redis (or both `redis` and `@redis/client`), and their classes are not ours.
 */
import type { RedisClientKind } from './types';

type Shape = Record<string, unknown>;

function isObject(value: unknown): value is Shape {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function hasFunctions(value: Shape, names: readonly string[]): boolean {
  return names.every((name) => typeof value[name] === 'function');
}

/** ioredis `Redis` and `Cluster`: `call()`, a `status` string, and an `isCluster` flag. */
function isIoredisShape(value: Shape): boolean {
  return (
    hasFunctions(value, ['call', 'duplicate', 'sendCommand']) &&
    typeof value['status'] === 'string' &&
    typeof value['isCluster'] === 'boolean'
  );
}

/** node-redis v4+ client or cluster: `sendCommand()`, `connect()` and an `isOpen` flag, and no ioredis `status`. */
function isNodeRedisShape(value: Shape): boolean {
  return (
    hasFunctions(value, ['sendCommand', 'connect', 'duplicate']) &&
    typeof value['isOpen'] === 'boolean' &&
    typeof value['status'] !== 'string'
  );
}

/** The commands without which no Redis-backed store can run: what marks an object as a client at all. */
const CORE_COMMANDS = ['get', 'set', 'del'] as const;

/**
 * Every method {@link FrontMcpRedisClient} requires. A client of your own must have all of them to be
 * taken by `redis: { client }`: a feature that calls a missing one would fail later with a TypeError.
 */
export const REQUIRED_REDIS_CLIENT_METHODS = [
  'get',
  'set',
  'del',
  'exists',
  'expire',
  'ttl',
  'incr',
  'decr',
  'incrby',
  'mget',
  'eval',
  'scan',
  'publish',
  'subscribe',
  'unsubscribe',
  'on',
  'removeListener',
  'ping',
  'quit',
  'disconnect',
  'duplicate',
] as const;

/** The required FrontMcpRedisClient methods a custom client lacks; empty for an ioredis or node-redis client. */
export function missingRedisClientMethods(value: unknown): string[] {
  const kind = detectRedisClientKind(value);
  if (kind === undefined) return [...REQUIRED_REDIS_CLIENT_METHODS];
  if (kind !== 'custom') return [];
  const shape = value as Shape;
  return REQUIRED_REDIS_CLIENT_METHODS.filter((name) => typeof shape[name] !== 'function');
}

/**
 * What kind of Redis client `value` is, or `undefined` for something that is not one.
 *
 * - `ioredis` / `ioredis-cluster`: an ioredis `Redis` / `Cluster`.
 * - `node-redis` / `node-redis-cluster`: what `createClient()` / `createCluster()` return.
 * - `custom`: any other object with `get`, `set` and `del`, taken as a FrontMcpRedisClient.
 */
export function detectRedisClientKind(value: unknown): RedisClientKind | undefined {
  if (!isObject(value)) return undefined;
  if (isIoredisShape(value)) return value['isCluster'] === true ? 'ioredis-cluster' : 'ioredis';
  if (isNodeRedisShape(value)) {
    return Array.isArray(value['masters']) && typeof value['nodeClient'] === 'function'
      ? 'node-redis-cluster'
      : 'node-redis';
  }
  return hasFunctions(value, CORE_COMMANDS) ? 'custom' : undefined;
}

/**
 * Whether `value` is a client `redis: { client }` can take: an ioredis or node-redis client or
 * cluster, or an object with every method {@link REQUIRED_REDIS_CLIENT_METHODS} lists.
 */
export function isRedisClientInput(value: unknown): boolean {
  return detectRedisClientKind(value) !== undefined && missingRedisClientMethods(value).length === 0;
}

/** Why `value` can't be taken as `redis: { client }`, or undefined when it can. */
export function redisClientProblem(value: unknown): string | undefined {
  if (detectRedisClientKind(value) === undefined) return UNSUPPORTED_REDIS_CLIENT_MESSAGE;
  const missing = missingRedisClientMethods(value);
  return missing.length > 0 ? incompleteRedisClientMessage(missing) : undefined;
}

/** Why a custom client was refused: the FrontMcpRedisClient methods it lacks. */
export function incompleteRedisClientMessage(missing: readonly string[]): string {
  return `redis.client is missing FrontMcpRedisClient methods: ${missing.join(', ')}`;
}

/** Why a `client` was refused. */
export const UNSUPPORTED_REDIS_CLIENT_MESSAGE =
  'redis.client is not a Redis client FrontMCP can use: pass an ioredis Redis or Cluster, a node-redis client or ' +
  'cluster (createClient() / createCluster()), or an object implementing FrontMcpRedisClient (get, set, del, ...)';
