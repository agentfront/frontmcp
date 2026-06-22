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
    // #368 round-3 — switched from 'esnext' to 'commonjs' to eliminate the
    // strict-ESM bundle problem (TS-emitted extensionless imports rejected
    // by rspack). Lambda's runtime accepts CJS handlers either way.
    it('should have commonjs module format', () => {
      expect(lambdaAdapter.moduleFormat).toBe('commonjs');
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
      // Round-3: emits CJS exports, not ESM.
      expect(entry).toContain('exports.handler');
    });
  });

  describe('cloudflareAdapter', () => {
    it('uses ES Module format (Module Worker — required for nodejs_compat)', () => {
      // CommonJS `module.exports` is read as a Service Worker, where
      // nodejs_compat cannot externalize Node builtins and the build fails.
      expect(cloudflareAdapter.moduleFormat).toBe('esnext');
    });

    it('sets serverless + worker env flags in the setup template (imported first)', () => {
      const setup = cloudflareAdapter.getSetupTemplate?.();
      expect(setup).toContain("process.env.FRONTMCP_SERVERLESS = '1'");
      // FRONTMCP_WORKER selects the Web fetch handler; it MUST be set before the
      // @FrontMcp decorator evaluates, hence the dedicated setup module.
      expect(setup).toContain("process.env.FRONTMCP_WORKER = '1'");
    });

    it('generates an ES Module worker entry that imports setup first', () => {
      const entry = cloudflareAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain("import './serverless-setup.js'");
      expect(entry).toContain("import './main.js'");
      expect(entry).toContain('getServerlessHandlerAsync');
      // Module Worker shape, not Service Worker.
      expect(entry).toContain('export default');
      expect(entry).not.toContain('module.exports');
    });

    it('invokes the handler Web-natively and ships no Node req/res shim', () => {
      const entry = cloudflareAdapter.getEntryTemplate('./main.js');
      // The handler is called with the Web Request — no Node req/res.
      expect(entry).toContain('handler(request)');
      // Guard against the old hand-rolled shim creeping back.
      expect(entry).not.toContain('statusCode');
      expect(entry).not.toContain('setHeader');
      expect(entry).not.toContain('app(req, res)');
    });

    it('bridges Worker bindings (vars + secrets) into process.env so the SDK can read them', () => {
      const entry = cloudflareAdapter.getEntryTemplate('./main.js');
      // The fetch handler receives `env`; copy its string bindings into
      // process.env (string-only, so KV/DO/R2 object bindings are skipped) — the
      // SDK reads MCP_SESSION_SECRET et al. from process.env, which workerd does
      // NOT auto-populate from bindings at the adapter's compat date. Without this
      // a deployed worker 500s with SessionSecretRequiredError.
      expect(entry).toContain('process.env[key] = env[key]');
      expect(entry).toContain("typeof env[key] === 'string'");
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

    it('always emits the nodejs_compat flag (the worker imports @frontmcp/sdk → Node builtins)', () => {
      const config = cloudflareAdapter.getConfig?.('/test');
      // Without this the deployed Worker cannot boot — node:* builtins are
      // only available behind nodejs_compat.
      expect(config).toContain('compatibility_flags = ["nodejs_compat"]');
    });

    it('defaults compatibility_date to one that enables full nodejs_compat (>= 2024-09-23)', () => {
      const config = cloudflareAdapter.getConfig?.('/test');
      expect(config).toContain('compatibility_date = "2024-09-23"');
    });

    it('merges user compatibilityFlags while always keeping nodejs_compat first', () => {
      const config = cloudflareAdapter.getConfig?.('/tmp', {
        target: 'cloudflare' as const,
        wrangler: { compatibilityFlags: ['nodejs_compat_populate_process_env'] },
      });
      expect(config).toContain('compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]');
    });

    it('dedupes nodejs_compat when the user also lists it explicitly', () => {
      const config = cloudflareAdapter.getConfig?.('/tmp', {
        target: 'cloudflare' as const,
        wrangler: { compatibilityFlags: ['nodejs_compat'] },
      });
      expect(config).toContain('compatibility_flags = ["nodejs_compat"]');
    });

    it('should have configFileName as wrangler.toml', () => {
      expect(cloudflareAdapter.configFileName).toBe('wrangler.toml');
    });
  });

  describe('vercelAdapter', () => {
    // #368 round-3 — switched from 'esnext' to 'commonjs'; see lambda comment.
    it('should have commonjs module format', () => {
      expect(vercelAdapter.moduleFormat).toBe('commonjs');
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
      // Round-3: emits CJS module.exports = handler (with .default for compat).
      expect(entry).toContain('module.exports');
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
      expect(config).toContain('compatibility_date = "2024-09-23"');
    });

    it('round-2: falls back to defaults when no deployment is supplied', () => {
      const config = cloudflareAdapter.getConfig?.('/tmp');
      expect(config).toContain('name = "frontmcp-worker"');
      expect(config).toContain('compatibility_date = "2024-09-23"');
    });
  });

  describe('vercelAdapter / lambdaAdapter CJS entries (#368 round-3)', () => {
    // Round 1: entries used `import` syntax with a sibling `{"type":"module"}`
    //          package.json — rspack treated it as strict ESM and rejected
    //          extensionless TS-emitted relative imports.
    // Round 2: added rspack `byDependency.fullySpecified: false` — partial
    //          relief but the user's retest still hit "Module not found" on
    //          extensionless imports plus new `await import('openai')` errors.
    // Round 3: switched both adapters to `commonjs` entries (mirrors the
    //          stable cloudflare adapter). No sibling type:module file is
    //          emitted, rspack is in CJS mode, fully-specified isn't enforced.
    it('vercel adapter declares commonjs (no sibling type:module package.json emitted)', () => {
      expect(vercelAdapter.moduleFormat).toBe('commonjs');
    });
    it('lambda adapter declares commonjs (no sibling type:module package.json emitted)', () => {
      expect(lambdaAdapter.moduleFormat).toBe('commonjs');
    });

    it('vercel entry uses CJS require()/module.exports (not import/export)', () => {
      const entry = vercelAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain("require('./main.js')");
      expect(entry).toContain('module.exports');
      expect(entry).not.toMatch(/^\s*import\s/m);
      expect(entry).not.toMatch(/^\s*export\s/m);
    });

    it('lambda entry uses CJS require()/exports.handler (not import/export)', () => {
      const entry = lambdaAdapter.getEntryTemplate('./main.js');
      expect(entry).toContain("require('./main.js')");
      expect(entry).toContain('exports.handler');
      expect(entry).not.toMatch(/^\s*import\s/m);
      expect(entry).not.toMatch(/^\s*export\s/m);
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
