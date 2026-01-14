// common/types/options/__tests__/redis.options.test.ts

import { redisOptionsSchema, RedisOptions, RedisOptionsInput } from '../redis';

// Helper to safely access redis properties (handles union type with Vercel KV)
function getRedisProperty<K extends string>(redis: RedisOptions | undefined, key: K): unknown {
  if (!redis) return undefined;
  return (redis as unknown as Record<string, unknown>)[key];
}

describe('redisOptionsSchema', () => {
  describe('required fields', () => {
    it('should require host', () => {
      const result = redisOptionsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid host', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost' });
      expect(result.success).toBe(true);
    });

    it('should reject empty host', () => {
      const result = redisOptionsSchema.safeParse({ host: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('default values', () => {
    it('should apply default port of 6379', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost' });
      expect(getRedisProperty(result, 'port')).toBe(6379);
    });

    it('should apply default db of 0', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost' });
      expect(getRedisProperty(result, 'db')).toBe(0);
    });

    it('should apply default tls of false', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost' });
      expect(getRedisProperty(result, 'tls')).toBe(false);
    });

    it('should apply default keyPrefix of mcp:', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost' });
      expect(result.keyPrefix).toBe('mcp:');
    });

    it('should apply default defaultTtlMs of 3600000 (1 hour)', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost' });
      expect(result.defaultTtlMs).toBe(3600000);
    });
  });

  describe('optional fields', () => {
    it('should accept custom port', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost', port: 6380 });
      expect(getRedisProperty(result, 'port')).toBe(6380);
    });

    it('should accept password', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost', password: 'secret' });
      expect(getRedisProperty(result, 'password')).toBe('secret');
    });

    it('should accept tls enabled', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost', tls: true });
      expect(getRedisProperty(result, 'tls')).toBe(true);
    });

    it('should accept custom keyPrefix', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost', keyPrefix: 'myapp:' });
      expect(result.keyPrefix).toBe('myapp:');
    });

    it('should accept custom defaultTtlMs', () => {
      const result = redisOptionsSchema.parse({ host: 'localhost', defaultTtlMs: 7200000 });
      expect(result.defaultTtlMs).toBe(7200000);
    });
  });

  describe('validation', () => {
    it('should reject negative port', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost', port: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer port', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost', port: 6379.5 });
      expect(result.success).toBe(false);
    });

    it('should reject negative db', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost', db: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject negative defaultTtlMs', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost', defaultTtlMs: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject zero defaultTtlMs', () => {
      const result = redisOptionsSchema.safeParse({ host: 'localhost', defaultTtlMs: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('should infer correct input type', () => {
      const input: RedisOptionsInput = { host: 'localhost' };
      expect(input.host).toBe('localhost');
      expect(input.port).toBeUndefined();
    });

    it('should infer correct output type', () => {
      const result: RedisOptions = redisOptionsSchema.parse({ host: 'localhost' });
      expect(getRedisProperty(result, 'host')).toBe('localhost');
      expect(getRedisProperty(result, 'port')).toBe(6379); // default applied
    });
  });

  describe('edge cases', () => {
    describe('port boundary values', () => {
      it('should accept port 1 (minimum valid)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', port: 1 });
        expect(result.success).toBe(true);
      });

      it('should accept port 65535 (maximum valid)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', port: 65535 });
        expect(result.success).toBe(true);
      });

      it('should reject port 65536 (exceeds max)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', port: 65536 });
        expect(result.success).toBe(false);
      });

      it('should reject port 0 (reserved)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', port: 0 });
        expect(result.success).toBe(false);
      });
    });

    describe('hostname formats', () => {
      it('should accept IPv4 addresses', () => {
        const result = redisOptionsSchema.safeParse({ host: '192.168.1.100' });
        expect(result.success).toBe(true);
      });

      it('should accept IPv6 addresses', () => {
        const result = redisOptionsSchema.safeParse({ host: '::1' });
        expect(result.success).toBe(true);
      });

      it('should accept hostnames with hyphens', () => {
        const result = redisOptionsSchema.safeParse({ host: 'redis-primary-01' });
        expect(result.success).toBe(true);
      });

      it('should accept fully qualified domain names', () => {
        const result = redisOptionsSchema.safeParse({ host: 'redis.cluster.example.com' });
        expect(result.success).toBe(true);
      });

      it('should reject whitespace-only host', () => {
        const result = redisOptionsSchema.safeParse({ host: '   ' });
        expect(result.success).toBe(false);
      });
    });

    describe('password edge cases', () => {
      it('should accept password with special characters', () => {
        const result = redisOptionsSchema.parse({ host: 'localhost', password: 'p@ss!w0rd#$%^&*()' });
        expect(getRedisProperty(result, 'password')).toBe('p@ss!w0rd#$%^&*()');
      });

      it('should accept empty string password', () => {
        const result = redisOptionsSchema.parse({ host: 'localhost', password: '' });
        expect(getRedisProperty(result, 'password')).toBe('');
      });

      it('should accept password with unicode characters', () => {
        const result = redisOptionsSchema.parse({ host: 'localhost', password: 'パスワード123' });
        expect(getRedisProperty(result, 'password')).toBe('パスワード123');
      });
    });

    describe('TTL edge cases', () => {
      it('should accept very large TTL values', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', defaultTtlMs: 86400000 * 365 });
        expect(result.success).toBe(true);
        expect(result.data?.defaultTtlMs).toBe(86400000 * 365);
      });

      it('should accept minimum valid TTL (1ms)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', defaultTtlMs: 1 });
        expect(result.success).toBe(true);
      });
    });

    describe('keyPrefix edge cases', () => {
      it('should accept keyPrefix with special characters', () => {
        const result = redisOptionsSchema.parse({ host: 'localhost', keyPrefix: 'app:v2:session:' });
        expect(result.keyPrefix).toBe('app:v2:session:');
      });

      it('should accept very long keyPrefix', () => {
        const longPrefix = 'a'.repeat(100) + ':';
        const result = redisOptionsSchema.parse({ host: 'localhost', keyPrefix: longPrefix });
        expect(result.keyPrefix).toBe(longPrefix);
      });

      it('should accept empty keyPrefix', () => {
        const result = redisOptionsSchema.parse({ host: 'localhost', keyPrefix: '' });
        expect(result.keyPrefix).toBe('');
      });
    });

    describe('db edge cases', () => {
      it('should accept db 15 (common max)', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', db: 15 });
        expect(result.success).toBe(true);
      });

      it('should accept high db numbers', () => {
        const result = redisOptionsSchema.safeParse({ host: 'localhost', db: 100 });
        expect(result.success).toBe(true);
      });
    });
  });
});
