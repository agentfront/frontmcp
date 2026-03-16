/**
 * Partition Key Types
 */

/**
 * Built-in partition key strategies.
 * - 'ip': partition by client IP
 * - 'session': partition by session ID
 * - 'userId': partition by authenticated user ID
 * - 'global': no partition — shared limit across all callers
 */
export type PartitionKeyStrategy = 'ip' | 'session' | 'userId' | 'global';

/**
 * Custom partition key resolver function.
 */
export type CustomPartitionKeyFn = (ctx: PartitionKeyContext) => string;

/**
 * Context provided to custom partition key resolvers.
 */
export interface PartitionKeyContext {
  sessionId: string;
  clientIp?: string;
  userId?: string;
}

/**
 * Partition key configuration — either a built-in strategy or a custom function.
 */
export type PartitionKey = PartitionKeyStrategy | CustomPartitionKeyFn;
