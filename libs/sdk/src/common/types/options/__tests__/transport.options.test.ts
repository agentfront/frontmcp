// common/types/options/__tests__/transport.options.test.ts

import {
  transportOptionsSchema,
  persistenceConfigSchema,
  TransportOptionsInput,
  expandProtocolConfig,
  toLegacyProtocolFlags,
  PROTOCOL_PRESETS,
} from '../transport';

// Helper to safely access redis properties (handles union type with Vercel KV)
function getRedisProperty<K extends string>(redis: unknown, key: K): unknown {
  if (!redis || typeof redis !== 'object') return undefined;
  return (redis as Record<string, unknown>)[key];
}

describe('persistenceConfigSchema', () => {
  describe('default values', () => {
    it('should apply default defaultTtlMs of 3600000 (1 hour)', () => {
      const result = persistenceConfigSchema.parse({});
      expect(result.defaultTtlMs).toBe(3600000);
    });
  });

  describe('optional redis config', () => {
    it('should accept persistence without redis', () => {
      const result = persistenceConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept persistence with redis', () => {
      const result = persistenceConfigSchema.safeParse({
        redis: { host: 'localhost' },
      });
      expect(result.success).toBe(true);
    });

    it('should accept persistence with defaultTtlMs', () => {
      const result = persistenceConfigSchema.safeParse({
        defaultTtlMs: 7200000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultTtlMs).toBe(7200000);
      }
    });
  });

  describe('validation', () => {
    it('should reject negative defaultTtlMs', () => {
      const result = persistenceConfigSchema.safeParse({ defaultTtlMs: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject zero defaultTtlMs', () => {
      const result = persistenceConfigSchema.safeParse({ defaultTtlMs: 0 });
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
  });

  describe('protocol preset defaults', () => {
    it('should default to legacy protocol preset', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.protocol).toBe('legacy');
    });

    it('should accept protocol preset names', () => {
      const presets = ['modern', 'legacy', 'stateless-api', 'full'] as const;
      for (const preset of presets) {
        const result = transportOptionsSchema.parse({ protocol: preset });
        expect(result.protocol).toBe(preset);
      }
    });

    it('should accept custom protocol config', () => {
      const result = transportOptionsSchema.parse({
        protocol: { legacy: true, sse: true, streamable: false },
      });
      expect(result.protocol).toEqual({ legacy: true, sse: true, streamable: false });
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
    it('should accept persistence config with redis', () => {
      const result = transportOptionsSchema.parse({
        persistence: {
          redis: { host: 'localhost' },
          defaultTtlMs: 7200000,
        },
      });
      expect(result.persistence).not.toBe(false);
      const persistence = result.persistence as { redis?: Record<string, unknown>; defaultTtlMs?: number };
      expect(getRedisProperty(persistence?.redis, 'host')).toBe('localhost');
      expect(persistence?.defaultTtlMs).toBe(7200000);
    });

    it('should accept persistence: false to explicitly disable', () => {
      const result = transportOptionsSchema.parse({
        persistence: false,
      });
      expect(result.persistence).toBe(false);
    });

    it('should accept empty persistence object', () => {
      const result = transportOptionsSchema.parse({
        persistence: {},
      });
      expect(result.persistence).toBeDefined();
      expect(result.persistence).not.toBe(false);
    });
  });

  describe('distributed mode', () => {
    it('should default distributedMode to false', () => {
      const result = transportOptionsSchema.parse({});
      expect(result.distributedMode).toBe(false);
    });

    it('should accept distributedMode: true', () => {
      const result = transportOptionsSchema.parse({ distributedMode: true });
      expect(result.distributedMode).toBe(true);
    });

    it('should accept distributedMode: auto', () => {
      const result = transportOptionsSchema.parse({ distributedMode: 'auto' });
      expect(result.distributedMode).toBe('auto');
    });

    it('should accept providerCaching option', () => {
      const result = transportOptionsSchema.parse({ providerCaching: false });
      expect(result.providerCaching).toBe(false);
    });
  });

  describe('full config', () => {
    it('should parse complete transport config with protocol preset', () => {
      const input: TransportOptionsInput = {
        sessionMode: 'stateless',
        platformDetection: { customOnly: false },
        protocol: 'legacy',
        persistence: {
          redis: { host: 'redis.example.com', port: 6380 },
        },
        distributedMode: 'auto',
        providerCaching: false,
      };

      const result = transportOptionsSchema.parse(input);

      expect(result.sessionMode).toBe('stateless');
      expect(result.protocol).toBe('legacy');
      expect(result.persistence).not.toBe(false);
      expect(result.distributedMode).toBe('auto');
      expect(result.providerCaching).toBe(false);
    });

    it('should parse complete transport config with custom protocol', () => {
      const input: TransportOptionsInput = {
        sessionMode: 'stateless',
        protocol: {
          sse: true,
          streamable: true,
          json: true,
          stateless: true,
          legacy: true,
          strictSession: false,
        },
      };

      const result = transportOptionsSchema.parse(input);

      expect(result.sessionMode).toBe('stateless');
      expect(result.protocol).toEqual({
        sse: true,
        streamable: true,
        json: true,
        stateless: true,
        legacy: true,
        strictSession: false,
      });
    });
  });
});

describe('expandProtocolConfig', () => {
  it('should return legacy preset for undefined', () => {
    const result = expandProtocolConfig(undefined);
    expect(result).toEqual(PROTOCOL_PRESETS.legacy);
  });

  it('should expand modern preset', () => {
    const result = expandProtocolConfig('modern');
    expect(result).toEqual({
      sse: true,
      streamable: true,
      json: false,
      stateless: false,
      legacy: false,
      strictSession: true,
    });
  });

  it('should expand legacy preset', () => {
    const result = expandProtocolConfig('legacy');
    expect(result).toEqual({
      sse: true,
      streamable: true,
      json: false,
      stateless: false,
      legacy: true,
      strictSession: true,
    });
  });

  it('should expand stateless-api preset', () => {
    const result = expandProtocolConfig('stateless-api');
    expect(result).toEqual({
      sse: false,
      streamable: false,
      json: false,
      stateless: true,
      legacy: false,
      strictSession: false,
    });
  });

  it('should expand full preset', () => {
    const result = expandProtocolConfig('full');
    expect(result).toEqual({
      sse: true,
      streamable: true,
      json: true,
      stateless: true,
      legacy: true,
      strictSession: false,
    });
  });

  it('should merge custom config with legacy defaults', () => {
    const result = expandProtocolConfig({ json: true });
    expect(result).toEqual({
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: true,
      strictSession: true,
    });
  });

  it('should use all custom values when provided', () => {
    const result = expandProtocolConfig({
      sse: false,
      streamable: false,
      json: true,
      stateless: true,
      legacy: false,
      strictSession: false,
    });
    expect(result).toEqual({
      sse: false,
      streamable: false,
      json: true,
      stateless: true,
      legacy: false,
      strictSession: false,
    });
  });
});

describe('toLegacyProtocolFlags', () => {
  it('should convert modern preset to legacy flags', () => {
    const result = toLegacyProtocolFlags('modern');
    expect(result).toEqual({
      enableLegacySSE: false,
      enableSseListener: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      enableStatefulHttp: false,
      requireSessionForStreamable: true,
    });
  });

  it('should convert legacy preset to legacy flags', () => {
    const result = toLegacyProtocolFlags('legacy');
    expect(result).toEqual({
      enableLegacySSE: true,
      enableSseListener: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      enableStatefulHttp: false,
      requireSessionForStreamable: true,
    });
  });

  it('should convert undefined (defaults to legacy) to legacy flags', () => {
    const result = toLegacyProtocolFlags(undefined);
    expect(result).toEqual({
      enableLegacySSE: true,
      enableSseListener: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      enableStatefulHttp: false,
      requireSessionForStreamable: true,
    });
  });

  it('should convert custom protocol config to legacy flags', () => {
    const result = toLegacyProtocolFlags({
      sse: false,
      streamable: false,
      json: true,
      stateless: true,
      legacy: true,
      strictSession: false,
    });
    expect(result).toEqual({
      enableLegacySSE: true,
      enableSseListener: false,
      enableStreamableHttp: false,
      enableStatelessHttp: true,
      enableStatefulHttp: true,
      requireSessionForStreamable: false,
    });
  });
});
