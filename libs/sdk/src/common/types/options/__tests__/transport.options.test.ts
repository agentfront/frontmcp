// common/types/options/__tests__/transport.options.test.ts

import {
  transportOptionsSchema,
  transportPersistenceConfigSchema,
  TransportOptions,
  TransportOptionsInput,
  TransportPersistenceConfig,
} from '../transport.options';

// Helper to safely access redis properties (handles union type with Vercel KV)
function getRedisProperty<K extends string>(redis: unknown, key: K): unknown {
  if (!redis || typeof redis !== 'object') return undefined;
  return (redis as Record<string, unknown>)[key];
}

describe('transportPersistenceConfigSchema', () => {
  describe('default values', () => {
    it('should apply default enabled of false', () => {
      const result = transportPersistenceConfigSchema.parse({});
      expect(result.enabled).toBe(false);
    });

    it('should apply default defaultTtlMs of 3600000 (1 hour)', () => {
      const result = transportPersistenceConfigSchema.parse({});
      expect(result.defaultTtlMs).toBe(3600000);
    });
  });

  describe('optional redis config', () => {
    it('should accept persistence without redis when disabled', () => {
      const result = transportPersistenceConfigSchema.safeParse({ enabled: false });
      expect(result.success).toBe(true);
    });

    it('should accept persistence with redis when enabled', () => {
      const result = transportPersistenceConfigSchema.safeParse({
        enabled: true,
        redis: { host: 'localhost' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validation', () => {
    it('should reject negative defaultTtlMs', () => {
      const result = transportPersistenceConfigSchema.safeParse({ defaultTtlMs: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject zero defaultTtlMs', () => {
      const result = transportPersistenceConfigSchema.safeParse({ defaultTtlMs: 0 });
      expect(result.success).toBe(false);
    });
  });
});

describe('transportOptionsSchema', () => {
  describe('session lifecycle defaults', () => {
    it('should apply default sessionMode of stateful', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.sessionMode).toBe('stateful');
    });

    it('should apply default transportIdMode of uuid', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.transportIdMode).toBe('uuid');
    });
  });

  describe('transport protocol defaults', () => {
    it('should apply default enableLegacySSE of false', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.enableLegacySSE).toBe(false);
    });

    it('should apply default enableSseListener of true', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.enableSseListener).toBe(true);
    });

    it('should apply default enableStreamableHttp of true', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.enableStreamableHttp).toBe(true);
    });

    it('should apply default enableStatelessHttp of false', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.enableStatelessHttp).toBe(false);
    });

    it('should apply default enableStatefulHttp of false', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.enableStatefulHttp).toBe(false);
    });

    it('should apply default requireSessionForStreamable of true', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.requireSessionForStreamable).toBe(true);
    });
  });

  describe('session mode options', () => {
    it('should accept stateful session mode', () => {
      const result = transportOptionsSchema.parse({ sessionMode: 'stateful' });
      expect(result.sessionMode).toBe('stateful');
    });

    it('should accept stateless session mode', () => {
      const result = transportOptionsSchema.parse({ sessionMode: 'stateless' });
      expect(result.sessionMode).toBe('stateless');
    });

    it('should accept function for session mode', () => {
      const fn = (issuer: string) => 'stateful' as const;
      const result = transportOptionsSchema.parse({ sessionMode: fn });
      expect(typeof result.sessionMode).toBe('function');
    });
  });

  describe('transport id mode options', () => {
    it('should accept uuid transport id mode', () => {
      const result = transportOptionsSchema.parse({ transportIdMode: 'uuid' });
      expect(result.transportIdMode).toBe('uuid');
    });

    it('should accept jwt transport id mode', () => {
      const result = transportOptionsSchema.parse({ transportIdMode: 'jwt' });
      expect(result.transportIdMode).toBe('jwt');
    });

    it('should accept function for transport id mode', () => {
      const fn = (issuer: string) => 'uuid' as const;
      const result = transportOptionsSchema.parse({ transportIdMode: fn });
      expect(typeof result.transportIdMode).toBe('function');
    });
  });

  describe('platform detection', () => {
    it('should accept platform detection config', () => {
      const result = transportOptionsSchema.parse({
        platformDetection: {
          customOnly: true,
          mappings: [{ pattern: 'test', platform: 'claude' }],
        },
      });
      expect(result.platformDetection?.customOnly).toBe(true);
    });
  });

  describe('persistence config', () => {
    it('should accept persistence config', () => {
      const result = transportOptionsSchema.parse({
        persistence: {
          enabled: true,
          redis: { host: 'localhost' },
          defaultTtlMs: 7200000,
        },
      });
      expect(result.persistence?.enabled).toBe(true);
      expect(getRedisProperty(result.persistence?.redis, 'host')).toBe('localhost');
    });
  });

  describe('full config', () => {
    it('should parse complete transport config', () => {
      const input: TransportOptionsInput = {
        sessionMode: 'stateless',
        transportIdMode: 'jwt',
        platformDetection: { customOnly: false },
        enableLegacySSE: true,
        enableSseListener: false,
        enableStreamableHttp: true,
        enableStatelessHttp: true,
        enableStatefulHttp: true,
        requireSessionForStreamable: false,
        persistence: {
          enabled: true,
          redis: { host: 'redis.example.com', port: 6380 },
        },
      };

      const result = transportOptionsSchema.parse(input);

      expect(result.sessionMode).toBe('stateless');
      expect(result.transportIdMode).toBe('jwt');
      expect(result.enableLegacySSE).toBe(true);
      expect(result.enableSseListener).toBe(false);
      expect(result.enableStreamableHttp).toBe(true);
      expect(result.enableStatelessHttp).toBe(true);
      expect(result.enableStatefulHttp).toBe(true);
      expect(result.requireSessionForStreamable).toBe(false);
      expect(result.persistence?.enabled).toBe(true);
    });
  });
});
