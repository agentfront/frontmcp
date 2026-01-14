// common/metadata/__tests__/front-mcp.metadata.test.ts

// Note: The SDK has circular dependencies that prevent direct import of frontMcpMetadataSchema
// in isolation. Instead, we test the applyAutoTransportPersistence transform function directly
// by extracting and testing its logic.

import { z } from 'zod';
import { redisOptionsSchema, RedisOptions } from '../../types/options/redis';
import { transportOptionsSchema } from '../../types/options/transport';

// Helper to safely access redis properties (handles union type with Vercel KV)
function getRedisProperty<K extends string>(redis: RedisOptions | undefined, key: K): unknown {
  if (!redis) return undefined;
  return (redis as unknown as Record<string, unknown>)[key];
}

// Type guard for persistence object shape (mirrors front-mcp.metadata.ts)
// New simplified format: false | { redis?, defaultTtlMs? } | undefined
function isPersistenceObject(value: unknown): value is { redis?: unknown; defaultTtlMs?: number } | false | undefined {
  if (value === undefined || value === null) return true;
  if (value === false) return true; // Explicitly disabled
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // Check optional properties have correct types if present
  if ('defaultTtlMs' in obj && typeof obj['defaultTtlMs'] !== 'number') return false;
  return true;
}

// Recreate the transform function for isolated testing
// This mirrors the logic in front-mcp.metadata.ts
// New simplified behavior:
// - persistence: false → explicitly disabled
// - persistence: { redis?: ... } → enabled with config
// - persistence: undefined → auto-enable when global redis exists
function applyAutoTransportPersistence<T extends { redis?: unknown; transport?: { persistence?: unknown } }>(
  data: T,
): T {
  // If no global redis config, nothing to auto-enable
  if (!data.redis) return data;

  // Safe access with type guard validation
  const transport = data.transport as { persistence?: unknown } | undefined;
  const rawPersistence = transport?.persistence;

  // Validate persistence shape at runtime (should always pass after Zod validation)
  if (!isPersistenceObject(rawPersistence)) {
    return data; // Invalid shape, don't modify
  }

  // Case 1: persistence explicitly disabled (false) - respect that
  if (rawPersistence === false) {
    return data;
  }

  // Case 2: persistence is an object with explicit redis config - use that
  if (rawPersistence && typeof rawPersistence === 'object' && 'redis' in rawPersistence && rawPersistence.redis) {
    return data;
  }

  // Case 3: persistence is an object without redis - use global redis
  if (rawPersistence && typeof rawPersistence === 'object') {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          ...rawPersistence,
          redis: data.redis,
        },
      },
    };
  }

  // Case 4: persistence not configured at all - auto-enable with global redis
  if (rawPersistence === undefined) {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          redis: data.redis,
        },
      },
    };
  }

  return data;
}

// Test schema that mimics the relevant parts of frontMcpMetadataSchema
const testSchema = z
  .object({
    redis: redisOptionsSchema.optional(),
    transport: transportOptionsSchema.optional().transform((val) => val ?? transportOptionsSchema.parse({})),
  })
  .transform(applyAutoTransportPersistence);

describe('applyAutoTransportPersistence transform', () => {
  describe('no global redis configured', () => {
    it('should not auto-enable persistence when no redis is configured', () => {
      const config = {};
      const result = testSchema.parse(config);

      // When no global redis, persistence is not auto-enabled
      // persistence remains undefined (optional field not populated)
      expect(result.transport?.persistence).toBeUndefined();
    });

    it('should preserve explicit persistence config when no global redis', () => {
      const config = {
        transport: {
          persistence: {
            redis: { host: 'explicit-host' },
          },
        },
      };
      const result = testSchema.parse(config);

      // Presence of object means persistence is enabled
      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const redis = result.transport?.persistence;
      expect(
        redis &&
          typeof redis === 'object' &&
          'redis' in redis &&
          redis.redis &&
          typeof redis.redis === 'object' &&
          'host' in redis.redis
          ? redis.redis.host
          : undefined,
      ).toBe('explicit-host');
    });
  });

  describe('global redis configured (redis provider)', () => {
    it('should auto-enable persistence with global redis when persistence not configured', () => {
      const config = {
        redis: { host: 'global-redis' },
      };
      const result = testSchema.parse(config);

      // Presence of persistence object means enabled
      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence;
      const redis =
        persistence && typeof persistence === 'object' && 'redis' in persistence ? persistence.redis : undefined;
      expect(redis && 'host' in (redis as object) ? (redis as { host: string }).host : undefined).toBe('global-redis');
    });

    it('should respect explicit persistence: false', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: false as const,
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBe(false);
    });

    it('should use global redis when persistence is empty object', () => {
      const config = {
        redis: { host: 'global-redis', port: 6380 },
        transport: {
          persistence: {},
        },
      };
      const result = testSchema.parse(config);

      // Empty object without redis gets global redis populated
      const persistence = result.transport?.persistence;
      expect(persistence).toBeDefined();
      expect(persistence).not.toBe(false);
      const redis =
        persistence && typeof persistence === 'object' && 'redis' in persistence ? persistence.redis : undefined;
      expect(redis && 'host' in (redis as object) ? (redis as { host: string }).host : undefined).toBe('global-redis');
      expect(redis && 'port' in (redis as object) ? (redis as { port: number }).port : undefined).toBe(6380);
    });

    it('should use explicit redis when persistence has its own redis config', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            redis: { host: 'custom-persistence-redis' },
          },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      expect(
        getRedisProperty(
          (result.transport?.persistence as { redis?: unknown })?.redis as Record<string, unknown>,
          'host',
        ),
      ).toBe('custom-persistence-redis');
    });

    it('should preserve other transport options when auto-enabling persistence', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          sessionMode: 'stateless' as const,
          protocol: { legacy: true }, // New format: protocol.legacy instead of enableLegacySSE
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.sessionMode).toBe('stateless');
      expect(result.transport?.protocol).toBeDefined();
      const protocol = result.transport?.protocol;
      expect(typeof protocol === 'object' && 'legacy' in protocol ? protocol.legacy : undefined).toBe(true);
      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      expect(
        getRedisProperty(
          (result.transport?.persistence as { redis?: unknown })?.redis as Record<string, unknown>,
          'host',
        ),
      ).toBe('global-redis');
    });
  });

  describe('global redis configured (vercel-kv provider)', () => {
    it('should auto-enable persistence with vercel-kv when persistence not configured', () => {
      const config = {
        redis: { provider: 'vercel-kv' as const },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: { provider?: string } };
      expect(persistence?.redis?.provider).toBe('vercel-kv');
    });

    it('should use global vercel-kv when persistence is empty object', () => {
      const config = {
        redis: {
          provider: 'vercel-kv' as const,
          url: 'https://kv.example.com',
          token: 'test-token',
        },
        transport: {
          persistence: {},
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: { provider?: string; url?: string } };
      expect(persistence?.redis?.provider).toBe('vercel-kv');
      expect(persistence?.redis?.url).toBe('https://kv.example.com');
    });
  });

  describe('legacy redis format (no provider field)', () => {
    it('should auto-enable persistence with legacy redis format', () => {
      const config = {
        redis: { host: 'legacy-redis', port: 6379 },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: Record<string, unknown> };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('legacy-redis');
      expect(getRedisProperty(persistence?.redis, 'port')).toBe(6379);
    });
  });

  describe('persistence defaultTtlMs preservation', () => {
    it('should preserve custom defaultTtlMs when auto-populating redis', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            defaultTtlMs: 7200000,
          },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { defaultTtlMs?: number; redis?: Record<string, unknown> };
      expect(persistence?.defaultTtlMs).toBe(7200000);
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('global-redis');
    });
  });

  describe('edge cases', () => {
    it('should handle persistence with explicit redis (no modification)', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            redis: { host: 'explicit-redis' },
            defaultTtlMs: 3600000,
          },
        },
      };
      const result = testSchema.parse(config);

      // Should use explicit redis, not global
      const persistence = result.transport?.persistence as { redis?: Record<string, unknown>; defaultTtlMs?: number };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('explicit-redis');
      expect(persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
    });

    it('should handle persistence object with only defaultTtlMs', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            defaultTtlMs: 7200000,
          },
        },
      };
      const result = testSchema.parse(config);

      // Object without redis gets global redis populated (Case 3 in transform)
      const persistence = result.transport?.persistence as { defaultTtlMs?: number; redis?: Record<string, unknown> };
      expect(persistence?.defaultTtlMs).toBe(7200000);
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('global-redis');
    });

    it('should handle empty persistence object', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {},
        },
      };
      const result = testSchema.parse(config);

      // Empty object gets global redis populated
      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: Record<string, unknown> };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('global-redis');
    });

    it('should preserve all global redis options when auto-populating', () => {
      const config = {
        redis: {
          host: 'global-redis',
          port: 6380,
          password: 'secret',
          db: 2,
          tls: true,
          keyPrefix: 'myapp:',
          defaultTtlMs: 7200000,
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: Record<string, unknown> };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('global-redis');
      expect(getRedisProperty(persistence?.redis, 'port')).toBe(6380);
      expect(getRedisProperty(persistence?.redis, 'password')).toBe('secret');
      expect(getRedisProperty(persistence?.redis, 'db')).toBe(2);
      expect(getRedisProperty(persistence?.redis, 'tls')).toBe(true);
      expect(getRedisProperty(persistence?.redis, 'keyPrefix')).toBe('myapp:');
    });

    it('should handle redis: undefined explicitly', () => {
      const config = {
        redis: undefined,
      };
      const result = testSchema.parse(config);

      // No auto-enable when redis is undefined
      expect(result.transport?.persistence).toBeUndefined();
    });

    it('should handle transport: undefined with global redis', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: undefined,
      };
      const result = testSchema.parse(config);

      // Should still auto-enable even when transport is undefined
      expect(result.transport?.persistence).toBeDefined();
      expect(result.transport?.persistence).not.toBe(false);
      const persistence = result.transport?.persistence as { redis?: Record<string, unknown> };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('global-redis');
    });
  });

  describe('schema validation errors', () => {
    it('should reject invalid redis host (empty string)', () => {
      const config = {
        redis: { host: '' },
      };
      expect(() => testSchema.parse(config)).toThrow();
    });

    it('should reject invalid redis port (negative)', () => {
      const config = {
        redis: { host: 'localhost', port: -1 },
      };
      expect(() => testSchema.parse(config)).toThrow();
    });

    it('should reject invalid persistence defaultTtlMs (negative)', () => {
      const config = {
        transport: {
          persistence: {
            redis: { host: 'localhost' },
            defaultTtlMs: -1,
          },
        },
      };
      expect(() => testSchema.parse(config)).toThrow();
    });
  });

  describe('type guard isPersistenceObject', () => {
    it('should return true for undefined', () => {
      expect(isPersistenceObject(undefined)).toBe(true);
    });

    it('should return true for null', () => {
      expect(isPersistenceObject(null)).toBe(true);
    });

    it('should return true for false (explicitly disabled)', () => {
      expect(isPersistenceObject(false)).toBe(true);
    });

    it('should return true for valid persistence object', () => {
      expect(isPersistenceObject({ defaultTtlMs: 3600000 })).toBe(true);
    });

    it('should return true for persistence object with redis', () => {
      expect(isPersistenceObject({ redis: { host: 'localhost' }, defaultTtlMs: 3600000 })).toBe(true);
    });

    it('should return true for empty object', () => {
      expect(isPersistenceObject({})).toBe(true);
    });

    it('should return false for non-object primitives', () => {
      expect(isPersistenceObject('string')).toBe(false);
      expect(isPersistenceObject(123)).toBe(false);
      expect(isPersistenceObject(true)).toBe(false); // true is not valid, only false is
    });

    it('should return false when defaultTtlMs is not number', () => {
      expect(isPersistenceObject({ defaultTtlMs: '3600000' })).toBe(false);
    });
  });
});
