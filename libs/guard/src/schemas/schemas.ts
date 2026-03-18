/**
 * Zod validation schemas for guard configuration.
 */

import { z } from 'zod';

// ============================================
// Partition Key Schema
// ============================================

export const partitionKeySchema = z.union([
  z.enum(['ip', 'session', 'userId', 'global']),
  z.custom<(ctx: { sessionId: string; clientIp?: string; userId?: string }) => string>(
    (val) => typeof val === 'function',
  ),
]);

// ============================================
// Per-Entity Config Schemas
// ============================================

export const rateLimitConfigSchema = z.object({
  maxRequests: z.number().int().positive().describe('Maximum number of requests allowed within the window.'),
  windowMs: z.number().int().positive().optional().default(60_000).describe('Time window in milliseconds.'),
  partitionBy: partitionKeySchema.optional().default('global').describe('Partition key strategy.'),
});

export const concurrencyConfigSchema = z.object({
  maxConcurrent: z.number().int().positive().describe('Maximum number of concurrent executions allowed.'),
  queueTimeoutMs: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Maximum time in ms to wait in queue (0 = no wait).'),
  partitionBy: partitionKeySchema.optional().default('global').describe('Partition key strategy.'),
});

export const timeoutConfigSchema = z.object({
  executeMs: z.number().int().positive().describe('Maximum execution time in milliseconds.'),
});

// ============================================
// IP Filter Config Schema
// ============================================

export const ipFilterConfigSchema = z.object({
  allowList: z.array(z.string()).optional().describe('IP addresses or CIDR ranges to always allow.'),
  denyList: z.array(z.string()).optional().describe('IP addresses or CIDR ranges to always block.'),
  defaultAction: z
    .enum(['allow', 'deny'])
    .optional()
    .default('allow')
    .describe('Default action when IP matches neither list.'),
  trustProxy: z.boolean().optional().default(false).describe('Trust X-Forwarded-For header.'),
  trustedProxyDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe('Max number of proxies to trust from X-Forwarded-For.'),
});

// ============================================
// Guard Config Schema (App-Level)
// ============================================

export const guardConfigSchema = z.object({
  enabled: z.boolean().describe('Whether the guard system is enabled.'),
  storage: z.looseObject({}).optional().describe('Storage backend configuration.'),
  keyPrefix: z.string().optional().default('mcp:guard:').describe('Key prefix for all storage keys.'),
  global: rateLimitConfigSchema.optional().describe('Global rate limit applied to all requests.'),
  globalConcurrency: concurrencyConfigSchema.optional().describe('Global concurrency limit.'),
  defaultRateLimit: rateLimitConfigSchema
    .optional()
    .describe('Default rate limit for entities without explicit config.'),
  defaultConcurrency: concurrencyConfigSchema
    .optional()
    .describe('Default concurrency for entities without explicit config.'),
  defaultTimeout: timeoutConfigSchema.optional().describe('Default timeout for entity execution.'),
  ipFilter: ipFilterConfigSchema.optional().describe('IP filtering configuration.'),
});
