// file: libs/cli/src/commands/build/__tests__/adapters.spec.ts

import { ADAPTERS, nodeAdapter, lambdaAdapter, cloudflareAdapter, vercelAdapter } from '../adapters';

describe('Build Adapters', () => {
  describe('ADAPTERS registry', () => {
    it('should have node adapter', () => {
      expect(ADAPTERS.node).toBeDefined();
    });

    it('should have vercel adapter', () => {
      expect(ADAPTERS.vercel).toBeDefined();
    });

    it('should have lambda adapter', () => {
      expect(ADAPTERS.lambda).toBeDefined();
    });

    it('should have cloudflare adapter', () => {
      expect(ADAPTERS.cloudflare).toBeDefined();
    });
  });

  describe('nodeAdapter', () => {
    it('should have commonjs module format', () => {
      expect(nodeAdapter.moduleFormat).toBe('commonjs');
    });

    it('should return empty entry template', () => {
      expect(nodeAdapter.getEntryTemplate()).toBe('');
    });

    it('should not require bundling', () => {
      expect(nodeAdapter.shouldBundle).toBeUndefined();
    });
  });

  describe('nodeAdapter Docker compatibility', () => {
    it('should not generate a setup template', () => {
      expect(nodeAdapter.getSetupTemplate).toBeUndefined();
    });

    it('should not have a config file or post-bundle hook', () => {
      expect(nodeAdapter.configFileName).toBeUndefined();
      expect(nodeAdapter.getConfig).toBeUndefined();
      expect(nodeAdapter.postBundle).toBeUndefined();
      expect(nodeAdapter.bundleOutput).toBeUndefined();
    });

    it('should produce no wrapper regardless of entry path', () => {
      expect(nodeAdapter.getEntryTemplate('./main.js')).toBe('');
      expect(nodeAdapter.getEntryTemplate('./dist/main.js')).toBe('');
    });
  });

  describe('lambdaAdapter', () => {
    it('should have esnext module format', () => {
      expect(lambdaAdapter.moduleFormat).toBe('esnext');
    });

    it('should require bundling', () => {
      expect(lambdaAdapter.shouldBundle).toBe(true);
    });

    it('should have bundle output filename', () => {
      expect(lambdaAdapter.bundleOutput).toBe('handler.cjs');
    });

    it('should generate setup template with FRONTMCP_SERVERLESS', () => {
      const setup = lambdaAdapter.getSetupTemplate?.();
      expect(setup).toContain("process.env.FRONTMCP_SERVERLESS = '1'");
    });

    it('should generate entry template with serverless-express', () => {
      const entry = lambdaAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain('@codegenie/serverless-express');
      expect(entry).toContain('./main.js');
      expect(entry).toContain('getServerlessHandlerAsync');
      expect(entry).toContain('export const handler');
    });
  });

  describe('cloudflareAdapter', () => {
    it('should have commonjs module format', () => {
      expect(cloudflareAdapter.moduleFormat).toBe('commonjs');
    });

    it('should generate entry template with FRONTMCP_SERVERLESS', () => {
      const entry = cloudflareAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain("process.env.FRONTMCP_SERVERLESS = '1'");
    });

    it('should generate entry template with Cloudflare fetch handler', () => {
      const entry = cloudflareAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain('./main.js');
      expect(entry).toContain('getServerlessHandlerAsync');
      expect(entry).toContain('module.exports');
      expect(entry).toContain('fetch');
    });

    it('should have getConfig method', () => {
      expect(cloudflareAdapter.getConfig).toBeDefined();
    });

    it('should generate wrangler.toml config', () => {
      const config = cloudflareAdapter.getConfig?.('/test');
      expect(config).toContain('name = "frontmcp-worker"');
      expect(config).toContain('main = "dist/index.js"');
      expect(config).toContain('compatibility_date');
    });

    it('should have configFileName as wrangler.toml', () => {
      expect(cloudflareAdapter.configFileName).toBe('wrangler.toml');
    });
  });

  describe('vercelAdapter', () => {
    it('should have esnext module format', () => {
      expect(vercelAdapter.moduleFormat).toBe('esnext');
    });

    it('should require bundling', () => {
      expect(vercelAdapter.shouldBundle).toBe(true);
    });

    it('should have bundle output filename', () => {
      expect(vercelAdapter.bundleOutput).toBe('handler.cjs');
    });

    it('should generate setup template with FRONTMCP_SERVERLESS', () => {
      const setup = vercelAdapter.getSetupTemplate?.();
      expect(setup).toContain("process.env.FRONTMCP_SERVERLESS = '1'");
    });

    it('should generate entry template with handler function', () => {
      const entry = vercelAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain('./main.js');
      expect(entry).toContain('getServerlessHandlerAsync');
      expect(entry).toContain('export default');
    });

    it('should have getConfig method', () => {
      expect(vercelAdapter.getConfig).toBeDefined();
    });

    it('should have configFileName', () => {
      expect(vercelAdapter.configFileName).toBe('vercel.json');
    });

    it('should have postBundle hook', () => {
      expect(vercelAdapter.postBundle).toBeDefined();
    });
  });
});
