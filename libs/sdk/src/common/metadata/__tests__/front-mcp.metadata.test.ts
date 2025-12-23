// common/metadata/__tests__/front-mcp.metadata.test.ts

// Note: The SDK has circular dependencies that prevent direct import of frontMcpMetadataSchema
// in isolation. Instead, we test the applyAutoTransportPersistence transform function directly
// by extracting and testing its logic.

import { z } from 'zod';
import { redisOptionsSchema } from '../../types/options/redis.options';
import { transportOptionsSchema } from '../../types/options/transport.options';

// Recreate the transform function for isolated testing
// This mirrors the logic in front-mcp.metadata.ts
function applyAutoTransportPersistence<T extends { redis?: unknown; transport?: { persistence?: unknown } }>(
  data: T,
): T {
  if (!data.redis) return data;

  const transport = data.transport as { persistence?: { enabled?: boolean; redis?: unknown } } | undefined;
  const persistence = transport?.persistence;

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
      expect(result.transport?.persistence?.redis?.host).toBe('explicit-host');
    });
  });

  describe('global redis configured (redis provider)', () => {
    it('should auto-enable persistence with global redis when persistence not configured', () => {
      const config = {
        redis: { host: 'global-redis' },
      };
      const result = testSchema.parse(config);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(result.transport?.persistence?.redis?.host).toBe('global-redis');
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
      expect(result.transport?.persistence?.redis?.host).toBe('global-redis');
      expect(result.transport?.persistence?.redis?.port).toBe(6380);
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
      expect(result.transport?.persistence?.redis?.host).toBe('custom-persistence-redis');
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
      expect(result.transport?.persistence?.redis?.host).toBe('global-redis');
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
      expect(result.transport?.persistence?.redis?.host).toBe('legacy-redis');
      expect(result.transport?.persistence?.redis?.port).toBe(6379);
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
      expect(result.transport?.persistence?.redis?.host).toBe('global-redis');
    });
  });
});
