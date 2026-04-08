/**
 * E2E Tests for frontmcp.config schema validation.
 * Tests the Zod schema that validates deployment configurations.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { validateConfig } from '@frontmcp/cli';

const FIXTURES = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'));
}

describe('frontmcp.config schema validation (E2E)', () => {
  describe('valid configurations', () => {
    it('should accept minimal config', () => {
      const config = validateConfig(loadFixture('minimal.config.json'));
      expect(config.name).toBe('test-server');
      expect(config.deployments).toHaveLength(1);
      expect(config.deployments[0].target).toBe('node');
    });

    it('should accept multi-target deployment', () => {
      const config = validateConfig(loadFixture('multi-target.config.json'));
      expect(config.deployments).toHaveLength(4);
      const targets = config.deployments.map((d) => d.target);
      expect(targets).toEqual(['distributed', 'cli', 'cloudflare', 'browser']);
    });

    it('should accept distributed target with full server config', () => {
      const config = validateConfig(loadFixture('with-server.config.json'));
      const distributed = config.deployments[0] as Record<string, unknown>;
      expect(distributed.target).toBe('distributed');

      const server = distributed.server as Record<string, unknown>;
      expect(server).toBeDefined();

      const http = server.http as Record<string, unknown>;
      expect(http.port).toBe(9090);

      const cors = http.cors as Record<string, unknown>;
      expect(cors.origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
      expect(cors.credentials).toBe(true);

      const csp = server.csp as Record<string, unknown>;
      expect(csp.enabled).toBe(true);

      const cookies = server.cookies as Record<string, unknown>;
      expect(cookies.affinity).toBe('__custom_node');
      expect(cookies.sameSite).toBe('Lax');

      const ha = distributed.ha as Record<string, unknown>;
      expect(ha.heartbeatIntervalMs).toBe(10000);
    });

    it('should accept cloudflare with server (cors + cookies, no port)', () => {
      const config = validateConfig(loadFixture('multi-target.config.json'));
      const cf = config.deployments.find((d) => d.target === 'cloudflare') as Record<string, unknown>;
      const server = cf.server as Record<string, unknown>;
      expect(server).toBeDefined();

      const cookies = server.cookies as Record<string, unknown>;
      expect(cookies.affinity).toBe('__cf_node');
    });

    it('should accept per-target env vars', () => {
      const config = validateConfig({
        name: 'env-test',
        deployments: [
          {
            target: 'distributed',
            env: { REDIS_HOST: 'redis.prod', NODE_ENV: 'production' },
          },
        ],
      });
      const deployment = config.deployments[0] as Record<string, unknown>;
      const env = deployment.env as Record<string, string>;
      expect(env.REDIS_HOST).toBe('redis.prod');
    });

    it('should accept browser target without server', () => {
      const config = validateConfig(loadFixture('multi-target.config.json'));
      const browser = config.deployments.find((d) => d.target === 'browser');
      expect(browser).toBeDefined();
      expect((browser as Record<string, unknown>).server).toBeUndefined();
    });
  });

  describe('invalid configurations', () => {
    it('should reject name with spaces', () => {
      expect(() => validateConfig(loadFixture('invalid-name.config.json'))).toThrow('Invalid frontmcp.config');
    });

    it('should reject empty deployments array', () => {
      expect(() => validateConfig(loadFixture('empty-deployments.config.json'))).toThrow('Invalid frontmcp.config');
    });

    it('should reject ha field on non-distributed target', () => {
      expect(() => validateConfig(loadFixture('wrong-target-field.config.json'))).toThrow('Invalid frontmcp.config');
    });

    it('should reject server on browser target', () => {
      expect(() =>
        validateConfig({
          name: 'bad',
          deployments: [{ target: 'browser', server: { http: { port: 3000 } } }],
        }),
      ).toThrow('Invalid frontmcp.config');
    });

    it('should reject port > 65535', () => {
      expect(() =>
        validateConfig({
          name: 'bad',
          deployments: [{ target: 'node', server: { http: { port: 99999 } } }],
        }),
      ).toThrow('Invalid frontmcp.config');
    });

    it('should reject unknown target type', () => {
      expect(() =>
        validateConfig({
          name: 'bad',
          deployments: [{ target: 'docker' }],
        }),
      ).toThrow('Invalid frontmcp.config');
    });

    it('should reject wrangler on non-cloudflare target', () => {
      expect(() =>
        validateConfig({
          name: 'bad',
          deployments: [{ target: 'node', wrangler: { name: 'test' } }],
        }),
      ).toThrow('Invalid frontmcp.config');
    });
  });

  describe('helper functions', () => {
    it('findDeployment should find by target', () => {
      const { findDeployment } = require('@frontmcp/cli');
      const config = validateConfig(loadFixture('multi-target.config.json'));
      expect(findDeployment(config, 'cli')?.target).toBe('cli');
      expect(findDeployment(config, 'vercel')).toBeUndefined();
    });

    it('getDeploymentTargets should return all targets', () => {
      const { getDeploymentTargets } = require('@frontmcp/cli');
      const config = validateConfig(loadFixture('multi-target.config.json'));
      expect(getDeploymentTargets(config)).toEqual(['distributed', 'cli', 'cloudflare', 'browser']);
    });
  });
});
