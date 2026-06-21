/**
 * Additional coverage for SkilledOpenApiPlugin paths the main plugin.spec.ts
 * does not reach:
 *   - the `injectSkillCatalogIntoSearchTool` ListTools.Did hook (all branches)
 *   - host-injected runtime deps (`SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN`) and the
 *     `attach(source)` callback (success + throwing) via the bundle-sync factory
 *   - `resolveRuntimeDeps` rejecting a non-object / throwing provider lookup
 */

import 'reflect-metadata';

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BundleStore } from '@frontmcp/adapters/skills';
import { ScopeEntry } from '@frontmcp/sdk';

import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import SkilledOpenApiPlugin, { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN } from '../skilled-openapi.plugin';
import { searchSkillDescription } from '../tools/search-skill.schema';
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

/**
 * Build a plugin instance whose `get(token)` delegates to a caller-supplied
 * resolver so we can drive `injectSkillCatalogIntoSearchTool` without a real
 * FrontMCP scope.
 */
function makePluginWithGet(getImpl: (token: unknown) => unknown): SkilledOpenApiPlugin {
  const plugin = new SkilledOpenApiPlugin({ source: { type: 'static', path: '/x' } });
  (plugin as unknown as { get: (t: unknown) => unknown }).get = getImpl;
  return plugin;
}

/** Minimal fake skill registry whose `getSkills` returns a single mcp skill. */
function fakeSkillRegistryWithOne() {
  return {
    getSkills: jest.fn(() => [{ metadata: { name: 'billing', description: 'Manage billing' } }]),
  };
}

describe('SkilledOpenApiPlugin.injectSkillCatalogIntoSearchTool', () => {
  function flowCtxWith(tools: unknown): { state: { tools: unknown } } {
    return { state: { tools } } as never;
  }

  it('returns early when there are no tools in the flow state', async () => {
    const getSpy = jest.fn();
    const plugin = makePluginWithGet(getSpy);
    await plugin.injectSkillCatalogIntoSearchTool(flowCtxWith(undefined) as never);
    await plugin.injectSkillCatalogIntoSearchTool(flowCtxWith([]) as never);
    // No `this.get` should have been called when the tool list is empty.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns early when the search_skill tool is not in the list', async () => {
    const getSpy = jest.fn();
    const plugin = makePluginWithGet(getSpy);
    await plugin.injectSkillCatalogIntoSearchTool(
      flowCtxWith([{ tool: { metadata: { name: 'some_other_tool' } } }]) as never,
    );
    // No skill-catalog work is done; `this.get` is never reached.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('appends the live skill catalog onto the search_skill description', async () => {
    const target = { tool: { metadata: { name: 'search_skill', description: 'orig' } } };
    const skills = fakeSkillRegistryWithOne();
    const plugin = makePluginWithGet((token) => {
      if (token === BundleSyncService) return {} as never;
      if (token === ScopeEntry) return { skills } as never;
      return undefined;
    });

    await plugin.injectSkillCatalogIntoSearchTool(flowCtxWith([target]) as never);

    expect(target.tool.metadata.description).toContain(searchSkillDescription);
    expect(target.tool.metadata.description).toContain('billing');
    expect(target.tool.metadata.description).toContain('---');
  });

  it('falls back to the static description when the catalog is empty', async () => {
    const target = { tool: { metadata: { name: 'search_skill', description: 'orig' } } };
    const emptySkills = { getSkills: jest.fn(() => []) };
    const plugin = makePluginWithGet((token) => {
      if (token === BundleSyncService) return {} as never;
      if (token === ScopeEntry) return { skills: emptySkills } as never;
      return undefined;
    });

    await plugin.injectSkillCatalogIntoSearchTool(flowCtxWith([target]) as never);

    // No catalog => exactly the static base, no separator.
    expect(target.tool.metadata.description).toBe(searchSkillDescription);
  });

  it('still injects when BundleSyncService is not yet resolvable (the get() throws)', async () => {
    const target = { tool: { metadata: { name: 'search_skill', description: 'orig' } } };
    const skills = fakeSkillRegistryWithOne();
    const plugin = makePluginWithGet((token) => {
      if (token === BundleSyncService) throw new Error('sync service not ready');
      if (token === ScopeEntry) return { skills } as never;
      return undefined;
    });

    await plugin.injectSkillCatalogIntoSearchTool(flowCtxWith([target]) as never);

    // The catch is swallowed; the catalog is still derived from scope.skills.
    expect(target.tool.metadata.description).toContain('billing');
  });
});

describe('SkilledOpenApiPlugin host-injected runtime deps (attach)', () => {
  async function makeBundleFile(): Promise<{ dir: string; bundlePath: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-rt-deps-'));
    const bundlePath = path.join(dir, 'bundle.json');
    await fs.writeFile(bundlePath, JSON.stringify(validBundle), 'utf8');
    return { dir, bundlePath };
  }

  function fakeLogger() {
    return {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };
  }

  function syncFactory(opts: { source: { type: 'static'; path: string } }) {
    const providers = SkilledOpenApiPlugin.dynamicProviders({
      ...opts,
      requireSignature: false,
      dev: true,
    });
    return providers.find((p: { provide: unknown }) => p.provide === BundleSyncService) as {
      useFactory: (...args: unknown[]) => Promise<BundleSyncService>;
    };
  }

  it('invokes runtimeDeps.attach with the live source when a host registers them', async () => {
    const { dir, bundlePath } = await makeBundleFile();
    try {
      const factory = syncFactory({ source: { type: 'static', path: bundlePath } });
      const logger = fakeLogger();
      const attach = jest.fn();
      const runtimeDeps = { attach, disablePolling: true };
      const fakeScope = {
        logger,
        skills: { registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })) },
        providers: {
          get: jest.fn((token: unknown) =>
            token === SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN ? runtimeDeps : undefined,
          ),
        },
      };
      const sync = await factory.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
      expect(attach).toHaveBeenCalledTimes(1);
      // attach receives the live SkillBundleSource (has a `start`/`onChange` API).
      const [source] = attach.mock.calls[0];
      expect(typeof source.onChange).toBe('function');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('warns but continues when runtimeDeps.attach throws', async () => {
    const { dir, bundlePath } = await makeBundleFile();
    try {
      const factory = syncFactory({ source: { type: 'static', path: bundlePath } });
      const logger = fakeLogger();
      const attach = jest.fn(() => {
        throw new Error('attach-boom');
      });
      const runtimeDeps = { attach };
      const fakeScope = {
        logger,
        skills: { registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })) },
        providers: {
          get: jest.fn((token: unknown) =>
            token === SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN ? runtimeDeps : undefined,
          ),
        },
      };
      const sync = await factory.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/attach threw/));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores a non-object value registered under the runtime-deps token', async () => {
    const { dir, bundlePath } = await makeBundleFile();
    try {
      const factory = syncFactory({ source: { type: 'static', path: bundlePath } });
      const logger = fakeLogger();
      const fakeScope = {
        logger,
        skills: { registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })) },
        providers: {
          // Returns a non-object => resolveRuntimeDeps yields undefined; no attach.
          get: jest.fn((token: unknown) =>
            token === SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN ? 'not-an-object' : undefined,
          ),
        },
      };
      const sync = await factory.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
      // No attach warning fires for the standard / no-injection path.
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/attach threw/));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('treats a throwing runtime-deps provider lookup as no injection', async () => {
    const { dir, bundlePath } = await makeBundleFile();
    try {
      const factory = syncFactory({ source: { type: 'static', path: bundlePath } });
      const logger = fakeLogger();
      const fakeScope = {
        logger,
        skills: { registerSkillContent: jest.fn(async () => ({ id: 's', unregister: async () => {} })) },
        providers: {
          get: jest.fn(() => {
            throw new Error('token not registered');
          }),
        },
      };
      const sync = await factory.useFactory(fakeScope, new HiddenOpRegistry(), new BundleStore());
      expect(sync).toBeInstanceOf(BundleSyncService);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
