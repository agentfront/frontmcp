import * as os from 'node:os';
import * as path from 'node:path';
import { EsmCacheManager } from '../esm-cache';

/**
 * In-memory file store backing @frontmcp/utils mocks.
 */
const store = new Map<string, string>();

// Track directories implicitly from stored file paths
function getDirectoryEntries(dirPath: string): string[] {
  const entries = new Set<string>();
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      const firstSegment = rest.split('/')[0];
      if (firstSegment) entries.add(firstSegment);
    }
  }
  return [...entries];
}

function hasEntriesUnder(dirPath: string): boolean {
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  readFile: jest.fn(async (p: string) => {
    const val = store.get(p);
    if (val === undefined) throw new Error(`ENOENT: ${p}`);
    return val;
  }),
  writeFile: jest.fn(async (p: string, content: string) => {
    store.set(p, content);
  }),
  fileExists: jest.fn(async (p: string) => store.has(p) || hasEntriesUnder(p)),
  readJSON: jest.fn(async <T>(p: string): Promise<T | undefined> => {
    const val = store.get(p);
    if (!val) return undefined;
    return JSON.parse(val) as T;
  }),
  writeJSON: jest.fn(async (p: string, data: unknown) => {
    store.set(p, JSON.stringify(data));
  }),
  ensureDir: jest.fn(async () => undefined),
  rm: jest.fn(async (p: string) => {
    for (const key of [...store.keys()]) {
      if (key.startsWith(p)) store.delete(key);
    }
  }),
  readdir: jest.fn(async (dirPath: string) => getDirectoryEntries(dirPath)),
  sha256Hex: jest.fn((input: string) => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }),
  isValidMcpUri: jest.fn((uri: string) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)),
}));

describe('EsmCacheManager', () => {
  const cacheDir = path.join(os.tmpdir(), 'test-esm-cache');
  let cache: EsmCacheManager;

  beforeEach(() => {
    store.clear();
    cache = new EsmCacheManager({ cacheDir, maxAgeMs: 60_000 });
  });

  describe('put()', () => {
    it('writes bundle.mjs and meta.json', async () => {
      const entry = await cache.put('@acme/tools', '1.0.0', 'export default {}', 'https://esm.sh/@acme/tools@1.0.0');

      expect(entry.packageName).toBe('@acme/tools');
      expect(entry.resolvedVersion).toBe('1.0.0');
      expect(entry.packageUrl).toBe('https://esm.sh/@acme/tools@1.0.0');
      expect(entry.bundlePath).toContain('bundle.mjs');
      expect(entry.cachedAt).toBeGreaterThan(0);

      // Verify bundle was written
      expect(store.get(entry.bundlePath)).toBe('export default {}');
    });

    it('stores etag when provided', async () => {
      const entry = await cache.put('@acme/tools', '1.0.0', 'code', 'https://esm.sh/x', '"abc123"');
      expect(entry.etag).toBe('"abc123"');
    });

    it('omits etag when not provided', async () => {
      const entry = await cache.put('@acme/tools', '1.0.0', 'code', 'https://esm.sh/x');
      expect(entry.etag).toBeUndefined();
    });

    it('rejects packageUrl without valid URI scheme', async () => {
      await expect(cache.put('@acme/tools', '1.0.0', 'code', 'no-scheme')).rejects.toThrow(
        'URI must have a valid scheme',
      );
    });
  });

  describe('get()', () => {
    it('returns entry when cached and fresh', async () => {
      await cache.put('@acme/tools', '1.0.0', 'code', 'https://esm.sh/x');
      const entry = await cache.get('@acme/tools', '1.0.0');

      expect(entry).toBeDefined();
      expect(entry!.packageName).toBe('@acme/tools');
      expect(entry!.resolvedVersion).toBe('1.0.0');
    });

    it('returns undefined when not cached', async () => {
      const entry = await cache.get('@acme/tools', '1.0.0');
      expect(entry).toBeUndefined();
    });

    it('returns undefined when expired', async () => {
      const shortTtlCache = new EsmCacheManager({ cacheDir, maxAgeMs: 1 });
      await shortTtlCache.put('@acme/tools', '1.0.0', 'code', 'https://esm.sh/x');

      await new Promise((r) => setTimeout(r, 5));

      const entry = await shortTtlCache.get('@acme/tools', '1.0.0');
      expect(entry).toBeUndefined();
    });

    it('returns from in-memory cache even when bundle file is deleted from disk', async () => {
      await cache.put('@acme/tools', '1.0.0', 'code', 'https://esm.sh/x');
      const entry = await cache.get('@acme/tools', '1.0.0');

      if (entry) {
        store.delete(entry.bundlePath);
      }

      // In-memory cache still has the entry (with bundleContent)
      const result = await cache.get('@acme/tools', '1.0.0');
      expect(result).toBeDefined();
      expect(result!.bundleContent).toBe('code');
    });

    it('returns undefined when meta.json is empty/null', async () => {
      const { sha256Hex } = jest.requireMock('@frontmcp/utils') as { sha256Hex: (s: string) => string };
      const hash = sha256Hex('@acme/tools@1.0.0');
      const metaPath = path.join(cacheDir, hash, 'meta.json');
      store.set(metaPath, 'null');

      const result = await cache.get('@acme/tools', '1.0.0');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidate()', () => {
    it('removes all versions of a package', async () => {
      await cache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');
      await cache.put('@acme/tools', '2.0.0', 'v2', 'https://esm.sh/b');
      await cache.put('@other/pkg', '1.0.0', 'other', 'https://esm.sh/c');

      await cache.invalidate('@acme/tools');

      expect(await cache.get('@acme/tools', '1.0.0')).toBeUndefined();
      expect(await cache.get('@acme/tools', '2.0.0')).toBeUndefined();
      expect(await cache.get('@other/pkg', '1.0.0')).toBeDefined();
    });

    it('does nothing when cache dir does not exist', async () => {
      const emptyCache = new EsmCacheManager({ cacheDir: '/nonexistent/path' });
      await expect(emptyCache.invalidate('@acme/tools')).resolves.toBeUndefined();
    });

    it('handles readdir error gracefully', async () => {
      const { readdir } = jest.requireMock('@frontmcp/utils') as { readdir: jest.Mock };
      readdir.mockRejectedValueOnce(new Error('permission denied'));

      // Put something so cacheDir "exists"
      await cache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');
      await expect(cache.invalidate('@acme/tools')).resolves.toBeUndefined();
    });
  });

  describe('cleanup()', () => {
    it('removes expired entries and returns count', async () => {
      const shortTtlCache = new EsmCacheManager({ cacheDir, maxAgeMs: 1 });
      await shortTtlCache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');
      await shortTtlCache.put('@acme/tools', '2.0.0', 'v2', 'https://esm.sh/b');

      await new Promise((r) => setTimeout(r, 5));

      const removed = await shortTtlCache.cleanup();
      expect(removed).toBe(2);
    });

    it('does not remove fresh entries', async () => {
      await cache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');
      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });

    it('accepts custom maxAgeMs override', async () => {
      await cache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');

      await new Promise((r) => setTimeout(r, 5));

      const removed = await cache.cleanup(1);
      expect(removed).toBe(1);
    });

    it('returns 0 when cache dir does not exist', async () => {
      const emptyCache = new EsmCacheManager({ cacheDir: '/nonexistent/path' });
      const removed = await emptyCache.cleanup();
      expect(removed).toBe(0);
    });

    it('handles readdir error gracefully', async () => {
      const { readdir } = jest.requireMock('@frontmcp/utils') as { readdir: jest.Mock };
      readdir.mockRejectedValueOnce(new Error('permission denied'));

      await cache.put('@acme/tools', '1.0.0', 'v1', 'https://esm.sh/a');
      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });
  });

  describe('readBundle()', () => {
    it('reads content from disk', async () => {
      const entry = await cache.put('@acme/tools', '1.0.0', 'export default 42;', 'https://esm.sh/x');
      const content = await cache.readBundle(entry);
      expect(content).toBe('export default 42;');
    });
  });

  describe('defaults', () => {
    it('uses default cache dir and max age', () => {
      const defaultCache = new EsmCacheManager();
      expect(defaultCache).toBeInstanceOf(EsmCacheManager);
    });
  });
});
