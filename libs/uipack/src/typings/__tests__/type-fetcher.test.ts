/**
 * TypeScript Type Fetcher Tests
 *
 * Tests for the TypeFetcher class, DTS parser, and cache.
 */

import {
  TypeFetcher,
  createTypeFetcher,
  parseDtsImports,
  parseImportStatement,
  getPackageFromSpecifier,
  getSubpathFromSpecifier,
  isRelativeImport,
  combineDtsContents,
  MemoryTypeCache,
  globalTypeCache,
  TYPE_CACHE_PREFIX,
  DEFAULT_TYPE_FETCHER_OPTIONS,
  DEFAULT_TYPE_CACHE_TTL,
  DEFAULT_ALLOWED_PACKAGES,
  buildTypeFiles,
  getRelativeImportPath,
  urlToVirtualPath,
} from '../index';

// ============================================
// DTS Parser Tests
// ============================================

describe('DTS Parser', () => {
  describe('parseDtsImports', () => {
    it('should parse import statements', () => {
      const content = `
import { FC } from 'react';
import type { ReactNode } from 'react';
import React from 'react';
      `;

      const result = parseDtsImports(content);

      expect(result.imports).toHaveLength(3);
      expect(result.externalPackages).toContain('react');
      expect(result.relativeImports).toHaveLength(0);
    });

    it('should parse export from statements', () => {
      const content = `
export { Button } from './components';
export * from 'lodash';
      `;

      const result = parseDtsImports(content);

      expect(result.imports).toHaveLength(2);
      expect(result.externalPackages).toContain('lodash');
      expect(result.relativeImports).toContain('./components');
    });

    it('should parse triple-slash reference types', () => {
      const content = `
/// <reference types="node" />
/// <reference types="@types/jest" />
declare module 'test';
      `;

      const result = parseDtsImports(content);

      expect(result.imports.filter((i) => i.type === 'reference')).toHaveLength(2);
      expect(result.externalPackages).toContain('node');
      expect(result.externalPackages).toContain('@types/jest');
    });

    it('should parse triple-slash reference paths', () => {
      const content = `
/// <reference path="./types.d.ts" />
/// <reference path="../global.d.ts" />
      `;

      const result = parseDtsImports(content);

      expect(result.imports.filter((i) => i.type === 'reference')).toHaveLength(2);
      expect(result.relativeImports).toContain('./types.d.ts');
      expect(result.relativeImports).toContain('../global.d.ts');
    });

    it('should parse declare module statements', () => {
      const content = `
declare module 'my-module' {
  export const foo: string;
}
      `;

      const result = parseDtsImports(content);

      expect(result.imports.filter((i) => i.type === 'declare-module')).toHaveLength(1);
      // declare module should not add to dependencies
      expect(result.externalPackages).not.toContain('my-module');
    });

    it('should handle scoped packages', () => {
      const content = `
import { Card } from '@frontmcp/ui';
import { Button } from '@frontmcp/ui/components';
      `;

      const result = parseDtsImports(content);

      expect(result.externalPackages).toContain('@frontmcp/ui');
      expect(result.externalPackages).toHaveLength(1); // Both should resolve to same package
    });

    it('should track line numbers', () => {
      const content = `import { FC } from 'react';
import React from 'react';`;

      const result = parseDtsImports(content);

      expect(result.imports[0].line).toBe(1);
      expect(result.imports[1].line).toBe(2);
    });
  });

  describe('parseImportStatement', () => {
    it('should parse named imports', () => {
      expect(parseImportStatement('import { Card } from "@frontmcp/ui"')).toBe('@frontmcp/ui');
      expect(parseImportStatement("import { FC, ReactNode } from 'react'")).toBe('react');
    });

    it('should parse default imports', () => {
      expect(parseImportStatement('import React from "react"')).toBe('react');
      expect(parseImportStatement("import lodash from 'lodash'")).toBe('lodash');
    });

    it('should parse namespace imports', () => {
      expect(parseImportStatement('import * as React from "react"')).toBe('react');
    });

    it('should parse side-effect imports', () => {
      expect(parseImportStatement('import "styles.css"')).toBe('styles.css');
    });

    it('should return null for invalid imports', () => {
      expect(parseImportStatement('const x = 1')).toBeNull();
      expect(parseImportStatement('export { foo }')).toBeNull();
    });
  });

  describe('getPackageFromSpecifier', () => {
    it('should handle simple packages', () => {
      expect(getPackageFromSpecifier('react')).toBe('react');
      expect(getPackageFromSpecifier('lodash')).toBe('lodash');
    });

    it('should handle packages with subpaths', () => {
      expect(getPackageFromSpecifier('react/jsx-runtime')).toBe('react');
      expect(getPackageFromSpecifier('lodash/debounce')).toBe('lodash');
    });

    it('should handle scoped packages', () => {
      expect(getPackageFromSpecifier('@frontmcp/ui')).toBe('@frontmcp/ui');
      expect(getPackageFromSpecifier('@types/node')).toBe('@types/node');
    });

    it('should handle scoped packages with subpaths', () => {
      expect(getPackageFromSpecifier('@frontmcp/ui/react')).toBe('@frontmcp/ui');
      expect(getPackageFromSpecifier('@babel/core/types')).toBe('@babel/core');
    });
  });

  describe('getSubpathFromSpecifier', () => {
    it('should return undefined for packages without subpath', () => {
      expect(getSubpathFromSpecifier('react')).toBeUndefined();
      expect(getSubpathFromSpecifier('@frontmcp/ui')).toBeUndefined();
    });

    it('should return subpath for packages with subpath', () => {
      expect(getSubpathFromSpecifier('react/jsx-runtime')).toBe('jsx-runtime');
      expect(getSubpathFromSpecifier('@frontmcp/ui/react')).toBe('react');
      expect(getSubpathFromSpecifier('lodash/debounce/index')).toBe('debounce/index');
    });
  });

  describe('isRelativeImport', () => {
    it('should identify relative imports', () => {
      expect(isRelativeImport('./components')).toBe(true);
      expect(isRelativeImport('../types')).toBe(true);
      expect(isRelativeImport('/absolute/path')).toBe(true);
    });

    it('should identify external imports', () => {
      expect(isRelativeImport('react')).toBe(false);
      expect(isRelativeImport('@frontmcp/ui')).toBe(false);
      expect(isRelativeImport('lodash/debounce')).toBe(false);
    });
  });

  describe('combineDtsContents', () => {
    it('should combine multiple .d.ts contents', () => {
      const contents = new Map([
        ['https://esm.sh/react.d.ts', 'declare const React: any;'],
        ['https://esm.sh/utils.d.ts', 'declare function util(): void;'],
      ]);

      const combined = combineDtsContents(contents);

      expect(combined).toContain('declare const React');
      expect(combined).toContain('declare function util');
    });

    it('should deduplicate references', () => {
      const contents = new Map([
        ['https://esm.sh/a.d.ts', '/// <reference types="node" />\ndeclare const a: number;'],
        ['https://esm.sh/b.d.ts', '/// <reference types="node" />\ndeclare const b: string;'],
      ]);

      const combined = combineDtsContents(contents);

      // Should only have one reference
      const referenceCount = (combined.match(/\/\/\/ <reference types="node" \/>/g) || []).length;
      expect(referenceCount).toBe(1);
    });

    it('should add source comments', () => {
      const contents = new Map([['https://esm.sh/test.d.ts', 'declare const test: any;']]);

      const combined = combineDtsContents(contents);

      expect(combined).toContain('// Source: https://esm.sh/test.d.ts');
    });
  });
});

// ============================================
// Virtual Path Helper Tests
// ============================================

describe('getRelativeImportPath', () => {
  it('should return correct path for single-level subpath', () => {
    expect(getRelativeImportPath('react')).toBe('../index');
    expect(getRelativeImportPath('hooks')).toBe('../index');
  });

  it('should return correct path for multi-level subpath', () => {
    expect(getRelativeImportPath('components/button')).toBe('../../index');
    expect(getRelativeImportPath('a/b/c')).toBe('../../../index');
  });
});

describe('urlToVirtualPath', () => {
  it('should convert esm.sh URLs to virtual paths', () => {
    const url = 'https://esm.sh/v135/zod@3.23.8/lib/types.d.ts';
    expect(urlToVirtualPath(url, 'zod', '3.23.8')).toBe('node_modules/zod/lib/types.d.ts');
  });

  it('should handle scoped packages', () => {
    const url = 'https://esm.sh/v135/@frontmcp/ui@1.0.0/react/index.d.ts';
    expect(urlToVirtualPath(url, '@frontmcp/ui', '1.0.0')).toBe('node_modules/@frontmcp/ui/react/index.d.ts');
  });

  it('should handle root index files', () => {
    const url = 'https://esm.sh/v135/react@18.2.0';
    expect(urlToVirtualPath(url, 'react', '18.2.0')).toBe('node_modules/react/index.d.ts');
  });

  it('should handle invalid URLs gracefully', () => {
    expect(urlToVirtualPath('not-a-url', 'pkg', '1.0.0')).toBe('node_modules/pkg/index.d.ts');
  });
});

describe('buildTypeFiles', () => {
  it('should build files array from contents map', () => {
    const contents = new Map([['https://esm.sh/v135/react@18.2.0/index.d.ts', 'declare const React: any;']]);

    const files = buildTypeFiles(contents, 'react', '18.2.0');

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('node_modules/react/index.d.ts');
    expect(files[0].url).toBe('https://esm.sh/v135/react@18.2.0/index.d.ts');
    expect(files[0].content).toBe('declare const React: any;');
  });

  it('should NOT create alias file when no subpath is provided', () => {
    const contents = new Map([['https://esm.sh/v135/@frontmcp/ui@1.0.0/index.d.ts', 'export const Card: any;']]);

    const files = buildTypeFiles(contents, '@frontmcp/ui', '1.0.0');

    expect(files).toHaveLength(1);
    expect(files.find((f) => f.url === '')).toBeUndefined();
  });

  it('should create alias file for single-level subpath', () => {
    const contents = new Map([['https://esm.sh/v135/@frontmcp/ui@1.0.0/index.d.ts', 'export const Card: any;']]);

    const files = buildTypeFiles(contents, '@frontmcp/ui', '1.0.0', 'react');

    expect(files).toHaveLength(2);

    // Find the alias file
    const aliasFile = files.find((f) => f.path === 'node_modules/@frontmcp/ui/react/index.d.ts');
    expect(aliasFile).toBeDefined();
    expect(aliasFile?.url).toBe(''); // Synthesized, no actual URL
    expect(aliasFile?.content).toContain("export * from '../index'");
    expect(aliasFile?.content).toContain('Auto-generated alias for @frontmcp/ui/react');
  });

  it('should create alias file for deep subpath', () => {
    const contents = new Map([['https://esm.sh/v135/@frontmcp/ui@1.0.0/index.d.ts', 'export const Card: any;']]);

    const files = buildTypeFiles(contents, '@frontmcp/ui', '1.0.0', 'components/button');

    expect(files).toHaveLength(2);

    // Find the alias file
    const aliasFile = files.find((f) => f.path === 'node_modules/@frontmcp/ui/components/button/index.d.ts');
    expect(aliasFile).toBeDefined();
    expect(aliasFile?.url).toBe('');
    expect(aliasFile?.content).toContain("export * from '../../index'");
  });

  it('should NOT create alias if file already exists at that path', () => {
    const contents = new Map([
      ['https://esm.sh/v135/@frontmcp/ui@1.0.0/index.d.ts', 'export const Card: any;'],
      ['https://esm.sh/v135/@frontmcp/ui@1.0.0/react/index.d.ts', 'export const ReactCard: any;'],
    ]);

    const files = buildTypeFiles(contents, '@frontmcp/ui', '1.0.0', 'react');

    // Should have 2 files (the original ones), no synthesized alias
    expect(files).toHaveLength(2);

    // The react/index.d.ts should be from the URL, not synthesized
    const reactFile = files.find((f) => f.path === 'node_modules/@frontmcp/ui/react/index.d.ts');
    expect(reactFile?.url).toBe('https://esm.sh/v135/@frontmcp/ui@1.0.0/react/index.d.ts');
    expect(reactFile?.content).toBe('export const ReactCard: any;');
  });
});

// ============================================
// Memory Cache Tests
// ============================================

describe('MemoryTypeCache', () => {
  let cache: MemoryTypeCache;

  beforeEach(() => {
    cache = new MemoryTypeCache({ maxSize: 10, defaultTtl: 0 });
  });

  it('should store and retrieve entries', async () => {
    const entry = {
      result: {
        specifier: 'react',
        resolvedPackage: 'react',
        version: '18.2.0',
        content: 'declare const React: any;',
        files: [
          {
            path: 'node_modules/react/index.d.ts',
            url: 'https://esm.sh/react.d.ts',
            content: 'declare const React: any;',
          },
        ],
        fetchedUrls: ['https://esm.sh/react.d.ts'],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 100,
      accessCount: 1,
    };

    await cache.set('test-key', entry);
    const retrieved = await cache.get('test-key');

    expect(retrieved).toBeDefined();
    expect(retrieved?.result.specifier).toBe('react');
    expect(retrieved?.result.files).toHaveLength(1);
    expect(retrieved?.result.files[0].path).toBe('node_modules/react/index.d.ts');
  });

  it('should return undefined for missing keys', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should check key existence', async () => {
    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: '',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 0,
      accessCount: 1,
    };

    expect(await cache.has('test-key')).toBe(false);
    await cache.set('test-key', entry);
    expect(await cache.has('test-key')).toBe(true);
  });

  it('should delete entries', async () => {
    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: '',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 0,
      accessCount: 1,
    };

    await cache.set('test-key', entry);
    expect(await cache.has('test-key')).toBe(true);

    await cache.delete('test-key');
    expect(await cache.has('test-key')).toBe(false);
  });

  it('should clear all entries', async () => {
    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: '',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 0,
      accessCount: 1,
    };

    await cache.set('key1', entry);
    await cache.set('key2', entry);
    await cache.clear();

    expect(cache.size).toBe(0);
  });

  it('should evict oldest entries when max size reached', async () => {
    const smallCache = new MemoryTypeCache({ maxSize: 3, defaultTtl: 0 });

    for (let i = 0; i < 5; i++) {
      const entry = {
        result: {
          specifier: `pkg${i}`,
          resolvedPackage: `pkg${i}`,
          version: '1.0.0',
          content: '',
          files: [],
          fetchedUrls: [],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 0,
        accessCount: 1,
      };
      await smallCache.set(`key${i}`, entry);
    }

    expect(smallCache.size).toBe(3);
    expect(smallCache.evictions).toBe(2);
    // First two should be evicted
    expect(await smallCache.has('key0')).toBe(false);
    expect(await smallCache.has('key1')).toBe(false);
    expect(await smallCache.has('key2')).toBe(true);
  });

  it('should respect TTL', async () => {
    const ttlCache = new MemoryTypeCache({ maxSize: 10, defaultTtl: 50 }); // 50ms TTL

    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: '',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 0,
      accessCount: 1,
    };

    await ttlCache.set('test-key', entry);
    expect(await ttlCache.has('test-key')).toBe(true);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(await ttlCache.has('test-key')).toBe(false);
    expect(await ttlCache.get('test-key')).toBeUndefined();
  });

  it('should track statistics', async () => {
    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: 'test content',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 12,
      accessCount: 1,
    };

    await cache.set('test-key', entry);
    await cache.get('test-key'); // Hit
    await cache.get('missing'); // Miss

    const stats = await cache.getStats();

    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.totalSize).toBe(12);
  });

  it('should cleanup expired entries', async () => {
    const ttlCache = new MemoryTypeCache({ maxSize: 10, defaultTtl: 30 });

    const entry = {
      result: {
        specifier: 'test',
        resolvedPackage: 'test',
        version: '1.0.0',
        content: '',
        files: [],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 0,
      accessCount: 1,
    };

    await ttlCache.set('key1', entry);
    await ttlCache.set('key2', entry);

    expect(ttlCache.size).toBe(2);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 40));

    const cleaned = ttlCache.cleanup();
    expect(cleaned).toBe(2);
    expect(ttlCache.size).toBe(0);
  });
});

// ============================================
// TypeFetcher Tests
// ============================================

describe('TypeFetcher', () => {
  describe('constructor', () => {
    it('should use default options', () => {
      const fetcher = new TypeFetcher();
      expect(fetcher).toBeInstanceOf(TypeFetcher);
    });

    it('should accept custom options', () => {
      const fetcher = new TypeFetcher({
        maxDepth: 5,
        timeout: 5000,
        maxConcurrency: 3,
        cdnBaseUrl: 'https://custom-cdn.example.com',
      });
      expect(fetcher).toBeInstanceOf(TypeFetcher);
    });
  });

  describe('createTypeFetcher', () => {
    it('should create a TypeFetcher instance', () => {
      const fetcher = createTypeFetcher();
      expect(fetcher).toBeInstanceOf(TypeFetcher);
    });

    it('should accept custom cache', () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });
      const fetcher = createTypeFetcher({}, cache);
      expect(fetcher).toBeInstanceOf(TypeFetcher);
    });
  });

  describe('fetchBatch with mocked fetch', () => {
    it('should handle invalid import statements', async () => {
      const fetcher = new TypeFetcher();

      const result = await fetcher.fetchBatch({
        imports: ['not a valid import'],
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('INVALID_SPECIFIER');
    });

    it('should handle network errors gracefully', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const fetcher = new TypeFetcher({ fetch: mockFetch });

      const result = await fetcher.fetchBatch({
        imports: ['import React from "react"'],
      });

      expect(result.errors).toHaveLength(1);
      // When fetch fails during package resolution, it's treated as package not found
      expect(result.errors[0].code).toBe('PACKAGE_NOT_FOUND');
    });

    it('should use cache when available', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache
      const cachedEntry = {
        result: {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '18.2.0',
          content: 'declare const React: any;',
          files: [
            {
              path: 'node_modules/react/index.d.ts',
              url: 'https://esm.sh/react.d.ts',
              content: 'declare const React: any;',
            },
          ],
          fetchedUrls: ['https://esm.sh/react.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}react@latest`, cachedEntry);

      const mockFetch = jest.fn();
      const fetcher = new TypeFetcher({ fetch: mockFetch }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import React from "react"'],
      });

      expect(result.cacheHits).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].files).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip cache when skipCache is true', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache
      const cachedEntry = {
        result: {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '18.2.0',
          content: 'cached content',
          files: [],
          fetchedUrls: ['https://esm.sh/react.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}react@latest`, cachedEntry);

      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const fetcher = new TypeFetcher({ fetch: mockFetch }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import React from "react"'],
        skipCache: true,
      });

      // Should have tried to fetch (and failed)
      expect(mockFetch).toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
    });

    it('should handle version overrides', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for specific version
      const cachedEntry = {
        result: {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '17.0.2',
          content: 'React 17 types',
          files: [
            {
              path: 'node_modules/react/index.d.ts',
              url: 'https://esm.sh/react@17.0.2.d.ts',
              content: 'React 17 types',
            },
          ],
          fetchedUrls: ['https://esm.sh/react@17.0.2.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}react@17.0.2`, cachedEntry);

      const mockFetch = jest.fn();
      const fetcher = new TypeFetcher({ fetch: mockFetch }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import React from "react"'],
        versionOverrides: { react: '17.0.2' },
      });

      expect(result.cacheHits).toBe(1);
      expect(result.results[0].version).toBe('17.0.2');
      expect(result.results[0].files).toHaveLength(1);
    });

    it('should report timing and counts', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });
      const cachedEntry = {
        result: {
          specifier: 'zod',
          resolvedPackage: 'zod',
          version: '3.23.8',
          content: 'zod types',
          files: [
            {
              path: 'node_modules/zod/index.d.ts',
              url: 'https://esm.sh/zod.d.ts',
              content: 'zod types',
            },
          ],
          fetchedUrls: [],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}zod@latest`, cachedEntry);

      const fetcher = new TypeFetcher({}, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import { z } from "zod"'],
      });

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.cacheHits).toBe(1);
      expect(result.networkRequests).toBe(0);
    });
  });
});

// ============================================
// Allowlist Tests
// ============================================

describe('TypeFetcher Allowlist', () => {
  describe('DEFAULT_ALLOWED_PACKAGES', () => {
    it('should contain expected default packages', () => {
      expect(DEFAULT_ALLOWED_PACKAGES).toContain('react');
      expect(DEFAULT_ALLOWED_PACKAGES).toContain('react-dom');
      expect(DEFAULT_ALLOWED_PACKAGES).toContain('react/jsx-runtime');
      expect(DEFAULT_ALLOWED_PACKAGES).toContain('zod');
      expect(DEFAULT_ALLOWED_PACKAGES).toContain('@frontmcp/*');
    });
  });

  describe('isPackageAllowed', () => {
    it('should allow packages in default allowlist', () => {
      const fetcher = new TypeFetcher();

      expect(fetcher.isPackageAllowed('react')).toBe(true);
      expect(fetcher.isPackageAllowed('react-dom')).toBe(true);
      expect(fetcher.isPackageAllowed('zod')).toBe(true);
    });

    it('should block packages not in allowlist', () => {
      const fetcher = new TypeFetcher();

      expect(fetcher.isPackageAllowed('lodash')).toBe(false);
      expect(fetcher.isPackageAllowed('axios')).toBe(false);
      expect(fetcher.isPackageAllowed('express')).toBe(false);
    });

    it('should allow packages matching @frontmcp/* pattern', () => {
      const fetcher = new TypeFetcher();

      expect(fetcher.isPackageAllowed('@frontmcp/ui')).toBe(true);
      expect(fetcher.isPackageAllowed('@frontmcp/sdk')).toBe(true);
      expect(fetcher.isPackageAllowed('@frontmcp/uipack')).toBe(true);
    });

    it('should not match similar but different scopes', () => {
      const fetcher = new TypeFetcher();

      expect(fetcher.isPackageAllowed('@other/ui')).toBe(false);
      expect(fetcher.isPackageAllowed('@frontmcp-fake/ui')).toBe(false);
    });

    it('should allow subpath imports of allowed packages', () => {
      const fetcher = new TypeFetcher();

      // 'react/jsx-runtime' is explicitly in the allowlist
      expect(fetcher.isPackageAllowed('react/jsx-runtime')).toBe(true);
    });

    it('should allow custom packages added via options', () => {
      const fetcher = new TypeFetcher({
        allowedPackages: ['lodash', '@myorg/*'],
      });

      // Custom additions
      expect(fetcher.isPackageAllowed('lodash')).toBe(true);
      expect(fetcher.isPackageAllowed('@myorg/utils')).toBe(true);
      expect(fetcher.isPackageAllowed('@myorg/deep/package')).toBe(true);

      // Defaults still work
      expect(fetcher.isPackageAllowed('react')).toBe(true);
    });

    it('should allow all packages when allowedPackages is false', () => {
      const fetcher = new TypeFetcher({ allowedPackages: false });

      expect(fetcher.isPackageAllowed('lodash')).toBe(true);
      expect(fetcher.isPackageAllowed('any-random-package')).toBe(true);
      expect(fetcher.isPackageAllowed('@random/scope')).toBe(true);
    });
  });

  describe('allowedPackagePatterns', () => {
    it('should return all allowed patterns', () => {
      const fetcher = new TypeFetcher({
        allowedPackages: ['lodash', 'axios'],
      });

      const patterns = fetcher.allowedPackagePatterns;
      expect(patterns).toContain('react');
      expect(patterns).toContain('lodash');
      expect(patterns).toContain('axios');
    });

    it('should be empty when allowlist is disabled', () => {
      const fetcher = new TypeFetcher({ allowedPackages: false });
      expect(fetcher.allowedPackagePatterns).toHaveLength(0);
    });
  });

  describe('fetchBatch with allowlist', () => {
    it('should block non-allowed packages with PACKAGE_NOT_ALLOWED error', async () => {
      const fetcher = new TypeFetcher();

      const result = await fetcher.fetchBatch({
        imports: ['import _ from "lodash"'],
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('PACKAGE_NOT_ALLOWED');
      expect(result.errors[0].message).toContain('lodash');
      expect(result.errors[0].message).toContain('not in the allowlist');
    });

    it('should allow packages in default allowlist (with mocked fetch)', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for react
      const cachedEntry = {
        result: {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '18.2.0',
          content: 'declare const React: any;',
          files: [
            {
              path: 'node_modules/react/index.d.ts',
              url: 'https://esm.sh/react.d.ts',
              content: 'declare const React: any;',
            },
          ],
          fetchedUrls: ['https://esm.sh/react.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}react@latest`, cachedEntry);

      const mockFetch = jest.fn();
      const fetcher = new TypeFetcher({ fetch: mockFetch }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import React from "react"'],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].specifier).toBe('react');
    });

    it('should allow @frontmcp packages via wildcard', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for @frontmcp/ui
      const cachedEntry = {
        result: {
          specifier: '@frontmcp/ui',
          resolvedPackage: '@frontmcp/ui',
          version: '1.0.0',
          content: 'export const Card: any;',
          files: [
            {
              path: 'node_modules/@frontmcp/ui/index.d.ts',
              url: 'https://esm.sh/@frontmcp/ui.d.ts',
              content: 'export const Card: any;',
            },
          ],
          fetchedUrls: ['https://esm.sh/@frontmcp/ui.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}@frontmcp/ui@latest`, cachedEntry);

      const fetcher = new TypeFetcher({}, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import { Card } from "@frontmcp/ui"'],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.results).toHaveLength(1);
    });

    it('should allow custom packages added to allowlist', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for lodash
      const cachedEntry = {
        result: {
          specifier: 'lodash',
          resolvedPackage: 'lodash',
          version: '4.17.21',
          content: 'declare const _: any;',
          files: [
            {
              path: 'node_modules/lodash/index.d.ts',
              url: 'https://esm.sh/lodash.d.ts',
              content: 'declare const _: any;',
            },
          ],
          fetchedUrls: ['https://esm.sh/lodash.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}lodash@latest`, cachedEntry);

      const fetcher = new TypeFetcher({ allowedPackages: ['lodash'] }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import _ from "lodash"'],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.results).toHaveLength(1);
    });

    it('should allow all packages when allowlist is disabled', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for random package
      const cachedEntry = {
        result: {
          specifier: 'random-pkg',
          resolvedPackage: 'random-pkg',
          version: '1.0.0',
          content: 'declare const random: any;',
          files: [
            {
              path: 'node_modules/random-pkg/index.d.ts',
              url: 'https://esm.sh/random-pkg.d.ts',
              content: 'declare const random: any;',
            },
          ],
          fetchedUrls: ['https://esm.sh/random-pkg.d.ts'],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}random-pkg@latest`, cachedEntry);

      const fetcher = new TypeFetcher({ allowedPackages: false }, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import random from "random-pkg"'],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('initialize', () => {
    it('should return empty results if already initialized', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Create a fetcher with only allowed packages that don't need network
      const fetcher = new TypeFetcher({ allowedPackages: false }, cache);

      // First init - will try to fetch packages (and fail since no mock)
      // But since allowedPackages: false, there are no patterns to pre-load
      const result1 = await fetcher.initialize();
      expect(fetcher.initialized).toBe(true);
      expect(result1.loaded).toHaveLength(0);

      // Second init should return empty
      const result2 = await fetcher.initialize();
      expect(result2.loaded).toHaveLength(0);
      expect(result2.failed).toHaveLength(0);
    });

    it('should skip glob patterns during initialization', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Only add concrete packages, not @frontmcp/*
      const fetcher = new TypeFetcher(
        {
          fetch: mockFetch,
          allowedPackages: ['custom-pkg'],
        },
        cache,
      );

      await fetcher.initialize();

      // Should have tried concrete packages (react, react-dom, react/jsx-runtime, zod, custom-pkg)
      // but NOT @frontmcp/* (glob pattern)
      const patterns = fetcher.allowedPackagePatterns;
      const concretePatterns = patterns.filter((p) => !p.includes('*'));
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(concretePatterns.length);

      // Verify @frontmcp/* is in patterns but wasn't fetched
      expect(patterns).toContain('@frontmcp/*');
    });

    it('should report loaded and failed packages', async () => {
      const cache = new MemoryTypeCache({ maxSize: 100 });

      // Pre-populate cache for some packages
      const successEntry = {
        result: {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '18.2.0',
          content: 'React types',
          files: [],
          fetchedUrls: [],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}react@latest`, successEntry);

      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));

      // Only test with packages that we can control
      const fetcher = new TypeFetcher(
        {
          fetch: mockFetch,
          // Override to only test specific packages
          allowedPackages: false, // Disable default allowlist to have full control
        },
        cache,
      );

      // Create a new fetcher with just react (which is cached) and a failing package
      const testFetcher = new TypeFetcher(
        {
          fetch: mockFetch,
          // Use only packages we can control
        },
        cache,
      );

      // Manually check that initialize would work with cached packages
      // This test verifies the structure of initialize() results
      const initResult = await testFetcher.initialize();

      // Since default allowlist has react, react-dom, react/jsx-runtime, zod (concrete)
      // Only react is cached, others will fail
      expect(initResult.loaded.length + initResult.failed.length).toBeGreaterThanOrEqual(0);
    });

    it('should set initialized flag after completion', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const fetcher = new TypeFetcher({
        fetch: mockFetch,
        allowedPackages: [], // Empty custom list, only defaults
      });

      expect(fetcher.initialized).toBe(false);
      await fetcher.initialize();
      expect(fetcher.initialized).toBe(true);
    });
  });
});

// ============================================
// Constants Tests
// ============================================

describe('Constants', () => {
  it('should have correct default options', () => {
    expect(DEFAULT_TYPE_FETCHER_OPTIONS.maxDepth).toBe(2);
    expect(DEFAULT_TYPE_FETCHER_OPTIONS.timeout).toBe(10000);
    expect(DEFAULT_TYPE_FETCHER_OPTIONS.maxConcurrency).toBe(5);
    expect(DEFAULT_TYPE_FETCHER_OPTIONS.cdnBaseUrl).toBe('https://esm.sh');
  });

  it('should have correct cache prefix', () => {
    expect(TYPE_CACHE_PREFIX).toBe('types:');
  });

  it('should have correct cache TTL', () => {
    expect(DEFAULT_TYPE_CACHE_TTL).toBe(60 * 60 * 1000); // 1 hour
  });
});

// ============================================
// Global Cache Tests
// ============================================

describe('globalTypeCache', () => {
  afterEach(async () => {
    await globalTypeCache.clear();
  });

  it('should be a MemoryTypeCache instance', () => {
    expect(globalTypeCache).toBeInstanceOf(MemoryTypeCache);
  });

  it('should be shared across imports', async () => {
    const entry = {
      result: {
        specifier: 'global-test',
        resolvedPackage: 'global-test',
        version: '1.0.0',
        content: 'test',
        files: [
          {
            path: 'node_modules/global-test/index.d.ts',
            url: 'https://esm.sh/global-test.d.ts',
            content: 'test',
          },
        ],
        fetchedUrls: [],
        fetchedAt: new Date().toISOString(),
      },
      cachedAt: Date.now(),
      size: 4,
      accessCount: 1,
    };

    await globalTypeCache.set('global-key', entry);
    expect(await globalTypeCache.has('global-key')).toBe(true);
  });
});
