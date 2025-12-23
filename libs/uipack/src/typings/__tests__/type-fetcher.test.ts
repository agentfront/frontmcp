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
          specifier: 'lodash',
          resolvedPackage: 'lodash',
          version: '4.17.21',
          content: 'lodash types',
          files: [
            {
              path: 'node_modules/lodash/index.d.ts',
              url: 'https://esm.sh/lodash.d.ts',
              content: 'lodash types',
            },
          ],
          fetchedUrls: [],
          fetchedAt: new Date().toISOString(),
        },
        cachedAt: Date.now(),
        size: 100,
        accessCount: 1,
      };
      await cache.set(`${TYPE_CACHE_PREFIX}lodash@latest`, cachedEntry);

      const fetcher = new TypeFetcher({}, cache);

      const result = await fetcher.fetchBatch({
        imports: ['import _ from "lodash"'],
      });

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.cacheHits).toBe(1);
      expect(result.networkRequests).toBe(0);
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
