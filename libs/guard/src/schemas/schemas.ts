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
  maxRequests: z.number().int().positive(),
  windowMs: z.number().int().positive().optional().default(60_000),
  partitionBy: partitionKeySchema.optional().default('global'),
});

export const concurrencyConfigSchema = z.object({
  maxConcurrent: z.number().int().positive(),
  queueTimeoutMs: z.number().int().nonnegative().optional().default(0),
  partitionBy: partitionKeySchema.optional().default('global'),
});

export const timeoutConfigSchema = z.object({
  executeMs: z.number().int().positive(),
});

// ============================================
// IP Filter Config Schema
// ============================================

export const ipFilterConfigSchema = z.object({
  allowList: z.array(z.string()).optional(),
  denyList: z.array(z.string()).optional(),
  defaultAction: z.enum(['allow', 'deny']).optional().default('allow'),
  trustProxy: z.boolean().optional().default(false),
  trustedProxyDepth: z.number().int().positive().optional().default(1),
});

// ============================================
// Guard Config Schema (App-Level)
// ============================================

export const guardConfigSchema = z.object({
  enabled: z.boolean(),
  storage: z.looseObject({}).optional(),
  keyPrefix: z.string().optional().default('mcp:guard:'),
  global: rateLimitConfigSchema.optional(),
  globalConcurrency: concurrencyConfigSchema.optional(),
  defaultRateLimit: rateLimitConfigSchema.optional(),
  defaultConcurrency: concurrencyConfigSchema.optional(),
  defaultTimeout: timeoutConfigSchema.optional(),
  ipFilter: ipFilterConfigSchema.optional(),
});
