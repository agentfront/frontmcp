/**
 * Partition Key Resolver
 *
 * Resolves a partition key string from a PartitionKey config and context.
 */

import type { PartitionKey, PartitionKeyContext } from './types';

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
      return ctx.clientIp ?? 'unknown-ip';
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
