/**
 * Partition Key Resolver
 *
 * Resolves a partition key string from a PartitionKey config and context.
 */

import type { PartitionKey, PartitionKeyContext } from './types';

/**
 * Bucket for callers whose IP cannot be established.
 *
 * Deliberately not a value that could equal a real IP, so it cannot collide with one.
 */
const UNRESOLVED_IP_PARTITION = 'ip:unresolved';

/**
 * Resolve a partition key string from the given strategy and context.
 */
export function resolvePartitionKey(
  partitionBy: PartitionKey | undefined,
  context: PartitionKeyContext | undefined,
): string {
  if (!partitionBy || partitionBy === 'global') {
    return 'global';
  }

  const ctx: PartitionKeyContext = context ?? { sessionId: 'anonymous' };

  if (typeof partitionBy === 'function') {
    return partitionBy(ctx);
  }

  switch (partitionBy) {
    case 'ip':
      // The socket peer, where one exists (GHSA-p3qf-fcwm-35x4). Then the authenticated
      // user, which the server establishes. Never the session id: a caller sets
      // `mcp-session-id` itself and a request without one is given a fresh UUID, so keying
      // on it would let a caller mint a new budget per request and never be limited.
      //
      // With no identity of either kind the remaining callers share one bounded bucket. That
      // is a deliberate trade: a shared budget still caps total load, where a per-request key
      // caps nothing. It only applies where no peer address exists at all — the web-fetch
      // adapter supplies one on Cloudflare Workers, Deno and Bun, and behind a proxy
      // FRONTMCP_TRUST_PROXY makes the forwarded client IP available.
      return ctx.clientIp ?? (ctx.userId ? `user:${ctx.userId}` : UNRESOLVED_IP_PARTITION);
    case 'session':
      return ctx.sessionId;
    case 'userId':
      return ctx.userId ?? ctx.sessionId;
    default:
      return 'global';
  }
}

/**
 * Build a full storage key combining entity name, partition key, and optional suffix.
 */
export function buildStorageKey(entityName: string, partitionKey: string, suffix?: string): string {
  const parts = [entityName, partitionKey];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join(':');
}
