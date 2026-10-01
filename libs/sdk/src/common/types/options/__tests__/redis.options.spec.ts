// common/types/options/__tests__/redis.options.spec.ts

import { frontMcpMetadataSchema } from '../../../metadata/front-mcp.metadata';
import { parseRedisUrl, pubsubOptionsSchema, redisOptionsSchema, RedisOptions, RedisOptionsInput } from '../redis';

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

describe('redis: { url } (#680)', () => {
  it('reads host, port, password and db from a redis:// URL', () => {
    const result = redisOptionsSchema.parse({ url: 'redis://:s3cret@cache.internal:6380/2' });
    expect(result).toEqual({
      provider: 'redis',
      host: 'cache.internal',
      port: 6380,
      password: 's3cret',
      db: 2,
      tls: false,
      keyPrefix: 'mcp:',
      defaultTtlMs: 3600000,
    });
  });

  it('turns TLS on for rediss:// and accepts the default ACL user', () => {
    const result = redisOptionsSchema.parse({ url: 'rediss://default:p%40ss@redis.example.com' });
    expect(result).toMatchObject({ provider: 'redis', host: 'redis.example.com', port: 6379, password: 'p@ss', tls: true });
  });

  it('defaults port and db and omits the password when the URL has none', () => {
    const result = redisOptionsSchema.parse({ url: 'redis://localhost' }) as Record<string, unknown>;
    expect(result).toMatchObject({ host: 'localhost', port: 6379, db: 0, tls: false });
    expect(result).not.toHaveProperty('password');
  });

  it('reads the database from ?db= when the path has none', () => {
    expect(redisOptionsSchema.parse({ url: 'redis://localhost:6379?db=4' })).toMatchObject({ db: 4 });
  });

  it('unwraps an IPv6 literal', () => {
    expect(redisOptionsSchema.parse({ url: 'redis://[::1]:6379' })).toMatchObject({ host: '::1' });
  });

  it('keeps keyPrefix and defaultTtlMs next to the url', () => {
    const result = redisOptionsSchema.parse({
      provider: 'redis',
      url: 'redis://localhost',
      keyPrefix: 'app:',
      defaultTtlMs: 1000,
    });
    expect(result).toMatchObject({ provider: 'redis', keyPrefix: 'app:', defaultTtlMs: 1000 });
  });

  it('still parses a vercel-kv url as Vercel KV', () => {
    const result = redisOptionsSchema.parse({ provider: 'vercel-kv', url: 'https://kv.example.com', token: 't' });
    expect(result).toMatchObject({ provider: 'vercel-kv', url: 'https://kv.example.com' });
  });

  it.each([
    ['not a url', 'not a valid URL'],
    ['http://localhost:6379', 'redis:// or rediss://'],
    ['redis://alice:pw@localhost', 'ACL user "alice"'],
    ['redis://localhost/abc', 'database "abc"'],
  ])('rejects %p with a message that says why', (url, message) => {
    const result = redisOptionsSchema.safeParse({ url });
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues.map((issue) => issue.message).join('\n');
    expect(issues).toContain(message);
  });

  it('parses a url on pubsub and on the top-level @FrontMcp config', () => {
    expect(pubsubOptionsSchema.parse({ url: 'redis://localhost:7000' })).toMatchObject({ host: 'localhost', port: 7000 });

    const config = frontMcpMetadataSchema.parse({
      info: { name: 'redis-url', version: '1.0.0' },
      apps: [],
      redis: { url: 'redis://:pw@redis.internal:6390/1' },
    }) as { redis?: unknown; transport?: { persistence?: { redis?: unknown } } };
    const expected = { provider: 'redis', host: 'redis.internal', port: 6390, password: 'pw', db: 1 };
    expect(config.redis).toMatchObject(expected);
    // Transport persistence auto-enables from the top-level block — with the parsed connection.
    expect(config.transport?.persistence?.redis).toMatchObject(expected);
  });
});

describe('parseRedisUrl', () => {
  it('returns the problem as a string', () => {
    expect(parseRedisUrl('redis://')).toEqual(expect.any(String));
    expect(parseRedisUrl('redis://h:1/0')).toEqual({ host: 'h', port: 1, db: 0, tls: false });
  });
});
