import { EsmCacheError, EsmManifestInvalidError, EsmPackageLoadError } from '../../errors/esm.errors';
import type { EsmCacheEntry, EsmCacheManager } from '../esm-cache';
import { normalizeEsmExport } from '../esm-manifest';
import { EsmModuleLoader } from '../esm-module-loader';
import { VersionResolver } from '../version-resolver';

// Mock VersionResolver
jest.mock('../version-resolver');

// Mock esm-manifest
jest.mock('../esm-manifest', () => ({
  normalizeEsmExport: jest.fn((mod: unknown) => mod),
}));

// Mock node:url
jest.mock('node:url', () => ({
  pathToFileURL: jest.fn((p: string) => ({ href: `file://${p}` })),
}));

describe('EsmModuleLoader', () => {
  let mockCache: jest.Mocked<EsmCacheManager>;
  let mockResolve: jest.Mock;
  let loader: EsmModuleLoader;

  const specifier = {
    scope: '@acme',
    name: 'tools',
    fullName: '@acme/tools',
    range: '^1.0.0',
    raw: '@acme/tools@^1.0.0',
  };

  beforeEach(() => {
    mockCache = {
      get: jest.fn(),
      put: jest.fn(),
      invalidate: jest.fn(),
      cleanup: jest.fn(),
      readBundle: jest.fn(),
    } as unknown as jest.Mocked<EsmCacheManager>;

    mockResolve = jest.fn();
    (VersionResolver as jest.MockedClass<typeof VersionResolver>).mockImplementation(
      () =>
        ({
          resolve: mockResolve,
        }) as unknown as VersionResolver,
    );

    loader = new EsmModuleLoader({ cache: mockCache });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveVersion()', () => {
    it('delegates to VersionResolver', async () => {
      mockResolve.mockResolvedValue({
        resolvedVersion: '1.2.0',
        availableVersions: ['1.0.0', '1.2.0'],
      });

      const version = await loader.resolveVersion(specifier);
      expect(version).toBe('1.2.0');
      expect(mockResolve).toHaveBeenCalledWith(specifier);
    });
  });

  describe('load()', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;
      mockResolve.mockResolvedValue({
        resolvedVersion: '1.2.0',
        availableVersions: ['1.0.0', '1.2.0'],
      });
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    it('returns from cache when hit (no fetch)', async () => {
      const cachedEntry: EsmCacheEntry = {
        packageUrl: 'https://esm.sh/@acme/tools@1.2.0?bundle',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.mjs',
      };

      mockCache.get.mockResolvedValue(cachedEntry);

      // Mock dynamic import for the cached file
      const mockModule = { name: '@acme/tools', version: '1.2.0', tools: [] };
      jest
        .spyOn(loader as unknown as { importFromPath: (p: string) => Promise<unknown> }, 'importFromPath' as never)
        .mockResolvedValue(mockModule as never);

      const result = await loader.load(specifier);

      expect(result.source).toBe('cache');
      expect(result.resolvedVersion).toBe('1.2.0');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('prefers the cached file path over in-memory bundle content in Node mode', async () => {
      const cachedEntry: EsmCacheEntry = {
        packageUrl: 'https://esm.sh/@acme/tools@1.2.0?bundle',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.cjs',
        bundleContent: 'module.exports = { default: { name: "stale" } };',
      };

      mockCache.get.mockResolvedValue(cachedEntry);

      const mockModule = { name: '@acme/tools', version: '1.2.0', tools: [] };
      const importFromPathSpy = jest
        .spyOn(loader as unknown as { importFromPath: (p: string) => Promise<unknown> }, 'importFromPath' as never)
        .mockResolvedValue(mockModule as never);
      const importBundleSpy = jest
        .spyOn(loader as unknown as { importBundle: (source: string) => Promise<unknown> }, 'importBundle' as never)
        .mockResolvedValue({ name: 'wrong-path' } as never);

      const result = await loader.load(specifier);

      expect(result.source).toBe('cache');
      expect(result.manifest.name).toBe('@acme/tools');
      expect(importFromPathSpy).toHaveBeenCalledWith('/tmp/cache/bundle.cjs');
      expect(importBundleSpy).not.toHaveBeenCalled();
    });

    it('falls back to in-memory bundle content when the cached file import fails', async () => {
      const cachedEntry: EsmCacheEntry = {
        packageUrl: 'https://esm.sh/@acme/tools@1.2.0?bundle',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.cjs',
        bundleContent: 'module.exports = { default: { name: "fallback" } };',
      };

      mockCache.get.mockResolvedValue(cachedEntry);

      const fallbackModule = { name: '@acme/tools', version: '1.2.0', tools: [] };
      const importFromPathSpy = jest
        .spyOn(loader as unknown as { importFromPath: (p: string) => Promise<unknown> }, 'importFromPath' as never)
        .mockRejectedValue(new Error('ENOENT') as never);
      const importBundleSpy = jest
        .spyOn(loader as unknown as { importBundle: (source: string) => Promise<unknown> }, 'importBundle' as never)
        .mockResolvedValue(fallbackModule as never);

      const result = await loader.load(specifier);

      expect(result.source).toBe('cache');
      expect(result.manifest.name).toBe('@acme/tools');
      expect(importFromPathSpy).toHaveBeenCalledWith('/tmp/cache/bundle.cjs');
      expect(importBundleSpy).toHaveBeenCalledWith(cachedEntry.bundleContent);
    });

    it('fetches from network on cache miss', async () => {
      mockCache.get.mockResolvedValue(undefined);

      const bundleContent = 'export default { name: "test", version: "1.0.0" }';
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => bundleContent,
        headers: { get: (key: string) => (key === 'etag' ? '"abc"' : null) },
      });

      const mockEntry: EsmCacheEntry = {
        packageUrl: 'url',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.mjs',
      };
      mockCache.put.mockResolvedValue(mockEntry);

      // Mock the private importFromPath method
      const mockModule = { name: '@acme/tools', version: '1.2.0', tools: [] };
      jest
        .spyOn(loader as unknown as Record<string, unknown>, 'importFromPath' as never)
        .mockResolvedValue(mockModule as never);

      const result = await loader.load(specifier);

      expect(result.source).toBe('network');
      expect(result.resolvedVersion).toBe('1.2.0');
      expect(mockCache.put).toHaveBeenCalledWith(
        '@acme/tools',
        '1.2.0',
        bundleContent,
        expect.stringContaining('@acme/tools@1.2.0'),
        '"abc"',
      );
    });

    it('throws timeout error on fetch abort', async () => {
      mockCache.get.mockResolvedValue(undefined);
      mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      await expect(loader.load(specifier)).rejects.toThrow('Timeout');
    });

    it('throws on non-ok fetch response', async () => {
      mockCache.get.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(loader.load(specifier)).rejects.toThrow('esm.sh returned 500');
      await expect(loader.load(specifier)).rejects.toThrow(EsmPackageLoadError);
    });

    it('throws on generic fetch error', async () => {
      mockCache.get.mockResolvedValue(undefined);
      mockFetch.mockRejectedValue(new Error('connection refused'));

      await expect(loader.load(specifier)).rejects.toThrow('Failed to fetch ESM bundle');
    });

    it('uses custom esmBaseUrl in fetch URL', async () => {
      const customLoader = new EsmModuleLoader({
        cache: mockCache,
        esmBaseUrl: 'https://my-esm.example.com',
      });

      mockCache.get.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'export default {}',
        headers: { get: () => null },
      });

      const mockEntry: EsmCacheEntry = {
        packageUrl: 'url',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.mjs',
      };
      mockCache.put.mockResolvedValue(mockEntry);

      jest
        .spyOn(customLoader as unknown as Record<string, unknown>, 'importFromPath' as never)
        .mockResolvedValue({} as never);

      await customLoader.load(specifier);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://my-esm.example.com/');
    });
  });

  describe('typed errors (#766)', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({ resolvedVersion: '1.2.0', availableVersions: ['1.2.0'] });
    });

    it('names the package in an EsmManifestInvalidError when the export is not a manifest', async () => {
      mockCache.get.mockResolvedValue({
        packageUrl: 'https://esm.sh/@acme/tools@1.2.0?bundle',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.mjs',
      });
      jest
        .spyOn(loader as unknown as Record<string, unknown>, 'importFromPath' as never)
        .mockResolvedValue({} as never);
      (normalizeEsmExport as jest.Mock).mockImplementationOnce(() => {
        throw new Error('ESM module export must be an object');
      });

      const failure = loader.load(specifier);

      await expect(failure).rejects.toThrow(EsmManifestInvalidError);
      await expect(failure).rejects.toThrow('Invalid manifest in ESM package "@acme/tools"');
    });

    it('throws an EsmCacheError for a cached entry with nothing to import', async () => {
      mockCache.get.mockResolvedValue({
        packageUrl: 'https://esm.sh/@acme/tools@1.2.0?bundle',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '',
      });

      await expect(loader.load(specifier)).rejects.toThrow(EsmCacheError);
    });
  });

  describe('importMap (#766)', () => {
    const mapped = { zod: 'https://cdn.example.com/zod.mjs' };

    beforeEach(() => {
      mockResolve.mockResolvedValue({ resolvedVersion: '1.2.0', availableVersions: ['1.2.0'] });
      (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'import{z}from"zod";export default {}',
        headers: { get: () => null },
      });
      mockCache.get.mockResolvedValue(undefined);
      mockCache.put.mockResolvedValue({
        packageUrl: 'url',
        packageName: '@acme/tools',
        resolvedVersion: '1.2.0',
        cachedAt: Date.now(),
        bundlePath: '/tmp/cache/bundle.mjs',
      });
    });

    it('fetches the bundle with the mapped packages external and caches it rewritten, apart from unmapped builds', async () => {
      const mapLoader = new EsmModuleLoader({ cache: mockCache, importMap: mapped });
      jest
        .spyOn(mapLoader as unknown as Record<string, unknown>, 'importFromPath' as never)
        .mockResolvedValue({} as never);

      const result = await mapLoader.load(specifier);

      const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
      expect(fetchMock.mock.calls[0][0]).toBe('https://esm.sh/@acme/tools@1.2.0?bundle&external=zod');
      const [, cacheVersion, content] = mockCache.put.mock.calls[0];
      expect(cacheVersion).toMatch(/^1\.2\.0\+import-map\.[0-9a-f]{12}$/);
      expect(mockCache.get).toHaveBeenCalledWith('@acme/tools', cacheVersion);
      expect(content).toBe('import{z}from"https://cdn.example.com/zod.mjs";export default {}');
      expect(result.resolvedVersion).toBe('1.2.0');
    });
  });

  describe('constructor options', () => {
    it('uses default timeout of 30000', () => {
      const l = new EsmModuleLoader({ cache: mockCache });
      expect(l).toBeInstanceOf(EsmModuleLoader);
    });

    it('accepts custom timeout', () => {
      const l = new EsmModuleLoader({ cache: mockCache, timeout: 5000 });
      expect(l).toBeInstanceOf(EsmModuleLoader);
    });

    it('accepts logger', () => {
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const l = new EsmModuleLoader({
        cache: mockCache,
        logger: logger as unknown as ConstructorParameters<typeof EsmModuleLoader>[0] extends { logger?: infer L }
          ? L
          : never,
      });
      expect(l).toBeInstanceOf(EsmModuleLoader);
    });
  });
});
