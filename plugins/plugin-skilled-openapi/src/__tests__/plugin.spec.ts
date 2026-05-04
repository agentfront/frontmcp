/**
 * Tests for SkilledOpenApiPlugin construction + dynamicProviders shape.
 *
 * The plugin is decorated with @Plugin which doesn't run side effects we can
 * easily exercise without a full FrontMCP scope; instead we focus on:
 *   - constructor parses options strictly (zod throws on invalid input)
 *   - constructor warns when dev=true or requireSignature=false
 *   - dynamicProviders returns the expected provider tokens
 *   - asCredentialResolverToken cast helper is callable (covers symbols.ts)
 */

import 'reflect-metadata';

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BundleStore } from '@frontmcp/adapters/skills';

import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import SkilledOpenApiPlugin from '../skilled-openapi.plugin';
import {
  asCredentialResolverToken,
  SkilledOpenApiConfig,
  SkilledOpenApiCredentialResolver,
} from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';

const validBundle = {
  schemaVersion: 1,
  bundleId: 'plugin:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'http://127.0.0.1:9999' }],
  authBindings: { def: { kind: 'none' } },
  skills: [],
  operations: {},
};

describe('SkilledOpenApiPlugin', () => {
  describe('constructor', () => {
    it('parses minimal valid options', () => {
      const plugin = new SkilledOpenApiPlugin({
        source: { type: 'static', path: '/tmp/x.json' },
      });
      expect(plugin.options.source.type).toBe('static');
      expect(plugin.options.requireSignature).toBe(true);
    });

    it('throws on invalid options (zod)', () => {
      expect(() => new SkilledOpenApiPlugin({ source: { type: 'static' } as never })).toThrow();
    });

    it('warns on dev=true', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        new SkilledOpenApiPlugin({ source: { type: 'static', path: '/x' }, dev: true });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dev=true/));
      } finally {
        warn.mockRestore();
      }
    });

    it('warns on requireSignature=false without dev=true', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        new SkilledOpenApiPlugin({
          source: { type: 'static', path: '/x' },
          requireSignature: false,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/requireSignature=false/));
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when both requireSignature=true and dev=false (default safe config)', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        new SkilledOpenApiPlugin({ source: { type: 'static', path: '/x' } });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('dynamicProviders', () => {
    it('returns providers for config / hidden-ops / bundle-store / resolver / guard / sync', () => {
      const providers = SkilledOpenApiPlugin.dynamicProviders({
        source: { type: 'static', path: '/x' },
      });
      const tokens = providers.map((p: { provide: unknown }) => p.provide);
      expect(tokens).toContain(SkilledOpenApiConfig);
      expect(tokens).toContain(HiddenOpRegistry);
      expect(tokens).toContain(BundleStore);
      expect(tokens).toContain(SkilledOpenApiCredentialResolver);
      expect(tokens).toContain(AuthorityGuard);
      expect(tokens).toContain(BundleSyncService);
    });

    it('seeds the in-memory credential resolver from `credentials` option', async () => {
      const providers = SkilledOpenApiPlugin.dynamicProviders({
        source: { type: 'static', path: '/x' },
        credentials: { 'demo-token': 'sk_xxx' },
      });
      const credProvider = providers.find(
        (p: { provide: unknown }) => p.provide === SkilledOpenApiCredentialResolver,
      ) as { useValue: SkilledOpenApiCredentialResolver };
      const value = await credProvider.useValue.resolve('demo-token', { bundleId: 'b' });
      expect(value).toBe('sk_xxx');
    });

    it('bundle-sync factory boots a static source and applies the bundle', async () => {
      // Build a tmp bundle file the static source can load.
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-test-'));
      const bundlePath = path.join(tmpDir, 'bundle.json');
      await fs.writeFile(bundlePath, JSON.stringify(validBundle), 'utf8');

      const providers = SkilledOpenApiPlugin.dynamicProviders({
        source: { type: 'static', path: bundlePath },
        requireSignature: false,
        dev: true,
      });
      const syncProvider = providers.find((p: { provide: unknown }) => p.provide === BundleSyncService) as {
        useFactory: (...args: unknown[]) => Promise<BundleSyncService>;
      };

      // Build minimal scope/registry/store stubs so the factory can run.
      const fakeLogger = {
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        child: jest.fn().mockReturnThis(),
      };
      const fakeScope = {
        logger: fakeLogger,
        skills: {
          registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })),
          unregisterSkill: jest.fn(async () => false),
        },
      };
      const hiddenOps = new HiddenOpRegistry();
      const bundleStore = new BundleStore();

      const sync = await syncProvider.useFactory(fakeScope, hiddenOps, bundleStore);
      expect(sync).toBeInstanceOf(BundleSyncService);

      // Poll up to 1s for the deferred source.start() → bundle apply path.
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && !bundleStore.current()) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(bundleStore.current()?.bundleId).toBe('plugin:test');
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('lazy skill-registry proxy throws when scope.skills is missing', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-test-'));
      const bundlePath = path.join(tmpDir, 'bundle.json');
      // Bundle with at least one skill so apply() reaches registerSkillContent
      // (empty skills would never trigger the proxy access).
      const bundleWithSkill = {
        ...validBundle,
        skills: [{ id: 's', name: 'S', description: 'd', instructions: 'i', operationIds: [] }],
      };
      await fs.writeFile(bundlePath, JSON.stringify(bundleWithSkill), 'utf8');

      const providers = SkilledOpenApiPlugin.dynamicProviders({
        source: { type: 'static', path: bundlePath },
        requireSignature: false,
        dev: true,
      });
      const syncProvider = providers.find((p: { provide: unknown }) => p.provide === BundleSyncService) as {
        useFactory: (...args: unknown[]) => Promise<BundleSyncService>;
      };

      // Logger.child must return an object that ALSO routes its calls back to
      // the root mocks; the proxy throw is logged via scope.logger.child(...)
      // inside the factory.
      const sharedWarn = jest.fn();
      const sharedError = jest.fn();
      const childLogger = {
        warn: sharedWarn,
        info: jest.fn(),
        error: sharedError,
        debug: jest.fn(),
        verbose: jest.fn(),
        child: jest.fn(function this_(): unknown {
          return this;
        }),
      };
      const fakeLogger = {
        warn: sharedWarn,
        info: jest.fn(),
        error: sharedError,
        debug: jest.fn(),
        verbose: jest.fn(),
        child: jest.fn(() => childLogger),
      };
      const fakeScope = { logger: fakeLogger, skills: undefined };
      const sync = await syncProvider.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && sharedWarn.mock.calls.length + sharedError.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(sharedWarn.mock.calls.length + sharedError.mock.calls.length).toBeGreaterThan(0);
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('bundle-sync factory tolerates a malformed source config', async () => {
      const providers = SkilledOpenApiPlugin.dynamicProviders({
        // Use a static source with a path that doesn't exist — source.start()
        // throws but the factory must not throw itself.
        source: { type: 'static', path: '/this/does/not/exist' },
        requireSignature: false,
        dev: true,
      });
      const syncProvider = providers.find((p: { provide: unknown }) => p.provide === BundleSyncService) as {
        useFactory: (...args: unknown[]) => Promise<BundleSyncService>;
      };

      const fakeLogger = {
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        child: jest.fn().mockReturnThis(),
      };
      const fakeScope = {
        logger: fakeLogger,
        skills: { registerSkillContent: jest.fn(), unregisterSkill: jest.fn() },
      };
      const sync = await syncProvider.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && fakeLogger.error.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringMatching(/bundle source failed to start/));
    });
  });

  describe('symbols', () => {
    it('asCredentialResolverToken returns the resolver typed as the abstract token', async () => {
      const resolver = new MemoryCredentialResolver({ k: 'v' });
      const token = asCredentialResolverToken(resolver);
      expect(await token.resolve('k', { bundleId: 'b' })).toBe('v');
    });

    it('SkilledOpenApiConfig.outbound exposes the parsed outbound options', () => {
      const config = new SkilledOpenApiConfig({
        source: { type: 'static', path: '/x', watch: false },
        requireSignature: true,
        trustedKeys: [],
        dev: false,
        outbound: {
          allowPrivateNetworks: false,
          maxConcurrencyPerHost: 5,
          defaultTimeoutMs: 1000,
          defaultMaxResponseBytes: 1024,
          allowHttp: false,
        },
        sourceConflictPolicy: 'static-wins',
      } as never);
      expect(config.outbound.maxConcurrencyPerHost).toBe(5);
    });
  });
});
