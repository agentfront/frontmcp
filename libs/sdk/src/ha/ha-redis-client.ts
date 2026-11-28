/**
 * The Redis clients of the HA manager and the transport bus (#646, #1503), opened from the server's
 * `redis`: a single node, a cluster, or the app's own client. Kept in the HA module, which only a
 * distributed deployment loads, so a browser bundle doesn't carry the connection factory.
 */
import {
  createRedisConnection,
  isRedisConnection,
  redisConnectionOf,
  type FrontMcpRedisClient,
  type RedisErrorListenerOptions,
} from '@frontmcp/utils';

/**
 * Open the HA client, or its subscriber. A client FrontMCP opens reconnects on its own and has a
 * permanent, rate-limited 'error' listener.
 *
 * The subscriber is a connection of its own (a subscribed connection runs no other commands): a
 * second one from the config, or a `duplicate()` of the app's client, which FrontMCP then owns.
 * The app's own client comes back behind a guard whose `quit()`/`disconnect()` close nothing.
 */
export function createHaRedisClient(
  redis: unknown,
  label: 'ha' | 'ha-subscriber',
  logger?: RedisErrorListenerOptions['logger'],
): FrontMcpRedisClient {
  if (!redis || !isRedisConnection(redis)) {
    throw new Error('Distributed HA requires a TCP Redis (ioredis); Vercel KV over REST has no Lua/pub-sub support');
  }
  const connection = redisConnectionOf(redis);
  if (connection.client !== undefined && label === 'ha-subscriber') {
    return createRedisConnection({ client: connection.client }).client.duplicate();
  }
  return createRedisConnection({ ...connection, label, logger }).client;
}
