// common/metadata/__tests__/front-mcp.metadata.test.ts

// Note: The SDK has circular dependencies that prevent direct import of frontMcpMetadataSchema
// in isolation. Instead, we test the applyAutoTransportPersistence transform function directly
// by extracting and testing its logic.

import { z } from 'zod';
import { redisOptionsSchema, RedisOptions } from '../../types/options/redis.options';
import { transportOptionsSchema } from '../../types/options/transport.options';

// Helper to safely access redis properties (handles union type with Vercel KV)
function getRedisProperty<K extends string>(redis: RedisOptions | undefined, key: K): unknown {
  if (!redis) return undefined;
  return (redis as unknown as Record<string, unknown>)[key];
}

// Type guard for persistence object shape (mirrors front-mcp.metadata.ts)
function isPersistenceObject(
  value: unknown,
): value is { enabled?: boolean; redis?: unknown; defaultTtlMs?: number } | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // Use bracket notation for index signatures
  if ('enabled' in obj && typeof obj['enabled'] !== 'boolean') return false;
  if ('defaultTtlMs' in obj && typeof obj['defaultTtlMs'] !== 'number') return false;
  return true;
}

// Recreate the transform function for isolated testing
// This mirrors the logic in front-mcp.metadata.ts
function applyAutoTransportPersistence<T extends { redis?: unknown; transport?: { persistence?: unknown } }>(
  data: T,
): T {
  if (!data.redis) return data;

  const transport = data.transport as { persistence?: unknown } | undefined;
  const rawPersistence = transport?.persistence;

  if (!isPersistenceObject(rawPersistence)) {
    return data;
  }

  const persistence = rawPersistence;

  if (persistence?.enabled === false) {
    return data;
  }

  if (persistence?.redis) {
    return data;
  }

  if (persistence?.enabled === true && !persistence.redis) {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          ...persistence,
          redis: data.redis,
        },
      },
    };
  }

  if (persistence === undefined) {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          enabled: true,
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
            enabled: true,
            redis: { host: 'explicit-host' },
          },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      const redis = result.transport?.persistence?.redis;
      expect(redis && 'host' in redis ? redis.host : undefined).toBe('explicit-host');
    });
  });

  describe('global redis configured (redis provider)', () => {
    it('should auto-enable persistence with global redis when persistence not configured', () => {
      const config = {
        redis: { host: 'global-redis' },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      const redis = result.transport?.persistence?.redis;
      expect(redis && 'host' in redis ? redis.host : undefined).toBe('global-redis');
    });

    it('should respect explicit persistence: { enabled: false }', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: { enabled: false },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(false);
      expect(result.transport?.persistence?.redis).toBeUndefined();
    });

    it('should use global redis when persistence: { enabled: true } without redis', () => {
      const config = {
        redis: { host: 'global-redis', port: 6380 },
        transport: {
          persistence: { enabled: true },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      const redis = result.transport?.persistence?.redis;
      expect(redis && 'host' in redis ? redis.host : undefined).toBe('global-redis');
      expect(redis && 'port' in redis ? redis.port : undefined).toBe(6380);
    });

    it('should use explicit redis when persistence has its own redis config', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            enabled: true,
            redis: { host: 'custom-persistence-redis' },
          },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('custom-persistence-redis');
    });

    it('should preserve other transport options when auto-enabling persistence', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          sessionMode: 'stateless' as const,
          enableLegacySSE: true,
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.sessionMode).toBe('stateless');
      expect(result.transport?.enableLegacySSE).toBe(true);
      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('global-redis');
    });
  });

  describe('global redis configured (vercel-kv provider)', () => {
    it('should auto-enable persistence with vercel-kv when persistence not configured', () => {
      const config = {
        redis: { provider: 'vercel-kv' as const },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(result.transport?.persistence?.redis?.provider).toBe('vercel-kv');
    });

    it('should use global vercel-kv when persistence: { enabled: true } without redis', () => {
      const config = {
        redis: {
          provider: 'vercel-kv' as const,
          url: 'https://kv.example.com',
          token: 'test-token',
        },
        transport: {
          persistence: { enabled: true },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(result.transport?.persistence?.redis?.provider).toBe('vercel-kv');
      expect((result.transport?.persistence?.redis as { url?: string })?.url).toBe('https://kv.example.com');
    });
  });

  describe('legacy redis format (no provider field)', () => {
    it('should auto-enable persistence with legacy redis format', () => {
      const config = {
        redis: { host: 'legacy-redis', port: 6379 },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('legacy-redis');
      expect(getRedisProperty(result.transport?.persistence?.redis, 'port')).toBe(6379);
    });
  });

  describe('persistence defaultTtlMs preservation', () => {
    it('should preserve custom defaultTtlMs when auto-populating redis', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            enabled: true,
            defaultTtlMs: 7200000,
          },
        },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(result.transport?.persistence?.defaultTtlMs).toBe(7200000);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('global-redis');
    });
  });

  describe('edge cases', () => {
    it('should handle persistence with enabled: true and explicit redis (no modification)', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            enabled: true,
            redis: { host: 'explicit-redis' },
            defaultTtlMs: 3600000,
          },
        },
      };
      const result = testSchema.parse(config);

      // Should use explicit redis, not global
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('explicit-redis');
      expect(result.transport?.persistence?.enabled).toBe(true);
    });

    it('should handle persistence object with only defaultTtlMs (no enabled flag)', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {
            defaultTtlMs: 7200000,
          },
        },
      };
      const result = testSchema.parse(config);

      // persistence.enabled defaults to false in schema, so transform checks Case 3 (enabled: true without redis)
      // which won't match since enabled is false by default, so it falls through
      expect(result.transport?.persistence?.defaultTtlMs).toBe(7200000);
    });

    it('should handle empty persistence object', () => {
      const config = {
        redis: { host: 'global-redis' },
        transport: {
          persistence: {},
        },
      };
      const result = testSchema.parse(config);

      // Empty object gets enabled: false from schema defaults
      expect(result.transport?.persistence?.enabled).toBe(false);
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

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('global-redis');
      expect(getRedisProperty(result.transport?.persistence?.redis, 'port')).toBe(6380);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'password')).toBe('secret');
      expect(getRedisProperty(result.transport?.persistence?.redis, 'db')).toBe(2);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'tls')).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'keyPrefix')).toBe('myapp:');
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
      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.transport?.persistence?.redis, 'host')).toBe('global-redis');
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
            enabled: true,
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

    it('should return true for valid persistence object', () => {
      expect(isPersistenceObject({ enabled: true, defaultTtlMs: 3600000 })).toBe(true);
    });

    it('should return true for empty object', () => {
      expect(isPersistenceObject({})).toBe(true);
    });

    it('should return false for non-object', () => {
      expect(isPersistenceObject('string')).toBe(false);
      expect(isPersistenceObject(123)).toBe(false);
    });

    it('should return false when enabled is not boolean', () => {
      expect(isPersistenceObject({ enabled: 'true' })).toBe(false);
      expect(isPersistenceObject({ enabled: 1 })).toBe(false);
    });

    it('should return false when defaultTtlMs is not number', () => {
      expect(isPersistenceObject({ defaultTtlMs: '3600000' })).toBe(false);
    });
  });
});
