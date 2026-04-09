import { frontmcpConfigSchema } from '../frontmcp-config.schema';

describe('frontmcpConfigSchema', () => {
  describe('valid configs', () => {
    it('should accept minimal config', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept full multi-target config', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        version: '1.0.0',
        entry: './src/main.ts',
        deployments: [
          {
            target: 'distributed',
            ha: { heartbeatIntervalMs: 5000 },
            server: {
              http: { port: 8080, cors: { origins: ['https://app.example.com'], credentials: true } },
              csp: { enabled: true, directives: { 'default-src': "'self'" } },
              cookies: { affinity: '__myapp_node', sameSite: 'Strict' },
              headers: { hsts: 'max-age=31536000', custom: { 'X-App': 'frontmcp' } },
            },
          },
          { target: 'cli', js: true, cli: { description: 'My CLI', outputDefault: 'text' } },
          { target: 'cloudflare', wrangler: { name: 'my-worker' } },
          { target: 'browser' },
          { target: 'vercel' },
          { target: 'lambda' },
          { target: 'sdk' },
        ],
        build: {
          esbuild: { external: ['better-sqlite3'], minify: true },
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept distributed target with HA config', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'ha-server',
        deployments: [
          {
            target: 'distributed',
            ha: {
              heartbeatIntervalMs: 5000,
              heartbeatTtlMs: 15000,
              takeoverGracePeriodMs: 3000,
              redisKeyPrefix: 'myapp:ha:',
            },
            server: { http: { port: 8080 }, cookies: { affinity: '__myapp' } },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept node target with server.http config', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'node-server',
        deployments: [{ target: 'node', server: { http: { port: 4000 } } }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept cloudflare with server (cors/cookies but no port)', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'cf-server',
        deployments: [
          {
            target: 'cloudflare',
            server: {
              http: { cors: { origins: ['https://app.com'] } },
              cookies: { affinity: '__cf_node' },
              csp: { enabled: true, directives: { 'default-src': "'self'" } },
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept $schema field', () => {
      const result = frontmcpConfigSchema.safeParse({
        $schema: './node_modules/@frontmcp/cli/frontmcp.schema.json',
        name: 'my-server',
        deployments: [{ target: 'node' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept per-target env vars', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [
          {
            target: 'distributed',
            env: { REDIS_HOST: 'redis.prod.internal', NODE_ENV: 'production' },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept CSP with array directives inside deployment', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'csp-server',
        deployments: [
          {
            target: 'node',
            server: {
              csp: {
                enabled: true,
                directives: {
                  'default-src': "'self'",
                  'script-src': ["'self'", 'https://cdn.example.com'],
                },
              },
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid configs', () => {
    it('should reject missing name', () => {
      const result = frontmcpConfigSchema.safeParse({
        deployments: [{ target: 'node' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid name', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'invalid name with spaces',
        deployments: [{ target: 'node' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty deployments', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown deployment target', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'docker' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid port inside deployment', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node', server: { http: { port: 99999 } } }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject ha on non-distributed target', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node', ha: { heartbeatIntervalMs: 5000 } }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject wrangler on non-cloudflare target', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node', wrangler: { name: 'test' } }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject cli config on non-cli target', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node', cli: { description: 'test' } }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid sameSite value inside deployment', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node', server: { cookies: { sameSite: 'Invalid' as 'Strict' } } }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject server on browser target', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'browser', server: { http: { port: 3000 } } }],
      });
      expect(result.success).toBe(false);
    });
  });
});
