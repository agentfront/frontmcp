// file: libs/cli/src/commands/build/__tests__/adapters.spec.ts

import { ADAPTERS, nodeAdapter, lambdaAdapter, cloudflareAdapter, vercelAdapter, distributedAdapter } from '../adapters';

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
      // #374: main now points at the path the build actually emits.
      expect(config).toContain('main = "dist/cloudflare/index.js"');
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

  describe('cloudflareAdapter validate (#375)', () => {
    it('throws when the user config declares unconditional sqlite storage', () => {
      expect(() => cloudflareAdapter.validate?.({ sqlite: { path: '~/db.sqlite' } })).toThrow(
        /sqlite storage is not supported on --target cloudflare/,
      );
    });

    it('throws when the user config declares unconditional redis (ioredis) storage', () => {
      expect(() => cloudflareAdapter.validate?.({ redis: { host: 'localhost' } })).toThrow(
        /redis.*not supported on --target cloudflare/,
      );
    });

    it('passes when neither sqlite nor redis is declared', () => {
      expect(() => cloudflareAdapter.validate?.({})).not.toThrow();
    });

    it('passes when decoratorConfig is undefined (plain config / no decorator)', () => {
      expect(() => cloudflareAdapter.validate?.(undefined)).not.toThrow();
    });

    it('round-2: throws when source AST shows env-gated sqlite (#375 retest)', () => {
      // The runtime-evaluated config object resolves to {} when REDIS_HOST is unset,
      // but the bundled worker still ships the sqlite branch. The source-AST
      // scan picks up the key regardless of value evaluation.
      expect(() =>
        cloudflareAdapter.validate?.({}, { keysSeenInSource: ['sqlite'] }),
      ).toThrow(/sqlite storage is not supported on --target cloudflare/);
    });

    it('round-2: throws when source AST shows env-gated redis (#375 retest)', () => {
      expect(() =>
        cloudflareAdapter.validate?.({}, { keysSeenInSource: ['redis', 'http'] }),
      ).toThrow(/redis.*not supported on --target cloudflare/);
    });

    it('round-2: passes when keysSeenInSource has no sqlite/redis', () => {
      expect(() =>
        cloudflareAdapter.validate?.({}, { keysSeenInSource: ['http', 'cors', 'logger'] }),
      ).not.toThrow();
    });
  });

  describe('cloudflareAdapter wrangler.toml (#374)', () => {
    it('opts in to alwaysWriteConfig so wrangler.toml stays in sync with the build output', () => {
      expect(cloudflareAdapter.alwaysWriteConfig).toBe(true);
    });

    it('emits wrangler.toml main pointing at dist/cloudflare/index.js', () => {
      const config = cloudflareAdapter.getConfig?.('/tmp');
      expect(typeof config).toBe('string');
      expect(config).toContain('main = "dist/cloudflare/index.js"');
    });

    it('round-2: merges deployments[].wrangler.{name,compatibilityDate} into the rendered TOML', () => {
      const deployment = {
        target: 'cloudflare' as const,
        wrangler: { name: 'frontegg-bin', compatibilityDate: '2025-01-01' },
      };
      const config = cloudflareAdapter.getConfig?.('/tmp', deployment);
      expect(config).toContain('name = "frontegg-bin"');
      expect(config).toContain('compatibility_date = "2025-01-01"');
      expect(config).toContain('main = "dist/cloudflare/index.js"');
    });

    it('round-2: falls back to defaults when deployment.wrangler is partial', () => {
      const deployment = {
        target: 'cloudflare' as const,
        wrangler: { name: 'just-a-name' },
      };
      const config = cloudflareAdapter.getConfig?.('/tmp', deployment);
      expect(config).toContain('name = "just-a-name"');
      expect(config).toContain('compatibility_date = "2024-01-01"');
    });

    it('round-2: falls back to defaults when no deployment is supplied', () => {
      const config = cloudflareAdapter.getConfig?.('/tmp');
      expect(config).toContain('name = "frontmcp-worker"');
      expect(config).toContain('compatibility_date = "2024-01-01"');
    });
  });

  describe('vercelAdapter / lambdaAdapter ESM-in-CJS regression (#368)', () => {
    // The entry templates use `import` syntax. Without a sibling
    // `{"type": "module"}` package.json (or .mjs extension), rspack parses
    // them as CJS when the parent project is `"type": "commonjs"` and the
    // build fails. The build pipeline drops the package.json now; the
    // adapter still declares moduleFormat='esnext' so the build wiring fires.
    it('vercel adapter is declared esnext (so the build emits a sibling package.json)', () => {
      expect(vercelAdapter.moduleFormat).toBe('esnext');
    });
    it('lambda adapter is declared esnext (so the build emits a sibling package.json)', () => {
      expect(lambdaAdapter.moduleFormat).toBe('esnext');
    });

    it('round-2: lambda adapter validate hook fails when @codegenie/serverless-express is missing', () => {
      // The current cwd is the monorepo root; `@codegenie/serverless-express`
      // is not declared anywhere in this repo's package.json, so the walk
      // should fail and the hook should throw with an actionable message.
      // This test will need adjustment if the dep is later added — that's
      // intentional, since presence-check tests reflect the actual repo state.
      expect(() => lambdaAdapter.validate?.(undefined)).toThrow(/@codegenie\/serverless-express/);
    });
  });

  describe('distributedAdapter', () => {
    // #367: the build emits the HA bootstrap as serverless-setup.js (not
    // ha-setup.js). The entry must require the file the build actually writes
    // — otherwise `node dist/distributed/index.js` crashes immediately with
    // MODULE_NOT_FOUND.
    it('requires the file the build actually emits (serverless-setup.js)', () => {
      const entry = distributedAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain("require('./serverless-setup.js')");
      expect(entry).not.toContain("require('./ha-setup.js')");
    });

    it('emits a setup template that sets FRONTMCP_DEPLOYMENT_MODE=distributed', () => {
      const setup = distributedAdapter.getSetupTemplate?.();
      expect(setup).toContain("process.env.FRONTMCP_DEPLOYMENT_MODE = 'distributed'");
    });

    it('uses commonjs module format', () => {
      expect(distributedAdapter.moduleFormat).toBe('commonjs');
    });
  });
});
