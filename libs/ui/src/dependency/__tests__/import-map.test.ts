/**
 * Import Map Generator Tests
 *
 * Tests for browser import map generation.
 */

import {
  createImportMap,
  createImportMapFromOverrides,
  mergeImportMaps,
  addScope,
  generateImportMapScriptTag,
  generateImportMapScriptTagMinified,
  generateUMDShim,
  generateCDNScriptTags,
  generateESMScriptTags,
  generateDependencyHTML,
  validateImportMap,
} from '../import-map';
import type { ResolvedDependency, ImportMap } from '../types';

describe('Import Map Generator', () => {
  const mockDependencies: ResolvedDependency[] = [
    {
      packageName: 'react',
      version: '18.2.0',
      cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
      integrity: 'sha384-abc123',
      global: 'React',
      esm: false,
      provider: 'cloudflare',
    },
    {
      packageName: 'react-dom',
      version: '18.2.0',
      cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
      integrity: 'sha384-def456',
      global: 'ReactDOM',
      esm: false,
      provider: 'cloudflare',
    },
    {
      packageName: 'lodash',
      version: '4.17.21',
      cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
      global: '_',
      esm: false,
      provider: 'cloudflare',
    },
  ];

  describe('createImportMap', () => {
    it('should create import map from resolved dependencies', () => {
      const importMap = createImportMap(mockDependencies);

      expect(importMap.imports['react']).toBe(mockDependencies[0].cdnUrl);
      expect(importMap.imports['react-dom']).toBe(mockDependencies[1].cdnUrl);
      expect(importMap.imports['lodash']).toBe(mockDependencies[2].cdnUrl);
    });

    it('should include integrity hashes when available', () => {
      const importMap = createImportMap(mockDependencies);

      expect(importMap.integrity).toBeDefined();
      expect(importMap.integrity?.[mockDependencies[0].cdnUrl]).toBe('sha384-abc123');
      expect(importMap.integrity?.[mockDependencies[1].cdnUrl]).toBe('sha384-def456');
      // lodash has no integrity
      expect(importMap.integrity?.[mockDependencies[2].cdnUrl]).toBeUndefined();
    });

    it('should handle empty dependencies', () => {
      const importMap = createImportMap([]);

      expect(importMap.imports).toEqual({});
    });
  });

  describe('createImportMapFromOverrides', () => {
    it('should create import map from CDN dependency overrides', () => {
      const overrides = {
        'custom-lib': {
          url: 'https://cdn.example.com/custom-lib.js',
          integrity: 'sha384-xyz',
        },
      };
      const importMap = createImportMapFromOverrides(overrides);

      expect(importMap.imports['custom-lib']).toBe('https://cdn.example.com/custom-lib.js');
      expect(importMap.integrity?.['https://cdn.example.com/custom-lib.js']).toBe('sha384-xyz');
    });
  });

  describe('mergeImportMaps', () => {
    it('should merge two import maps', () => {
      const map1: ImportMap = {
        imports: { react: 'https://cdn1.com/react.js' },
      };
      const map2: ImportMap = {
        imports: { lodash: 'https://cdn2.com/lodash.js' },
      };
      const merged = mergeImportMaps(map1, map2);

      expect(merged.imports['react']).toBe('https://cdn1.com/react.js');
      expect(merged.imports['lodash']).toBe('https://cdn2.com/lodash.js');
    });

    it('should override with second map values', () => {
      const map1: ImportMap = {
        imports: { react: 'https://cdn1.com/react.js' },
      };
      const map2: ImportMap = {
        imports: { react: 'https://cdn2.com/react.js' },
      };
      const merged = mergeImportMaps(map1, map2);

      expect(merged.imports['react']).toBe('https://cdn2.com/react.js');
    });

    it('should merge scopes', () => {
      const map1: ImportMap = {
        imports: {},
        scopes: { '/app/': { react: 'https://cdn1.com/react.js' } },
      };
      const map2: ImportMap = {
        imports: {},
        scopes: { '/lib/': { lodash: 'https://cdn2.com/lodash.js' } },
      };
      const merged = mergeImportMaps(map1, map2);

      expect(merged.scopes?.['/app/']).toBeDefined();
      expect(merged.scopes?.['/lib/']).toBeDefined();
    });

    it('should merge integrity', () => {
      const map1: ImportMap = {
        imports: { react: 'https://cdn.com/react.js' },
        integrity: { 'https://cdn.com/react.js': 'sha384-abc' },
      };
      const map2: ImportMap = {
        imports: { lodash: 'https://cdn.com/lodash.js' },
        integrity: { 'https://cdn.com/lodash.js': 'sha384-def' },
      };
      const merged = mergeImportMaps(map1, map2);

      expect(merged.integrity?.['https://cdn.com/react.js']).toBe('sha384-abc');
      expect(merged.integrity?.['https://cdn.com/lodash.js']).toBe('sha384-def');
    });
  });

  describe('addScope', () => {
    it('should add a scope to import map', () => {
      const importMap: ImportMap = { imports: { react: 'https://cdn.com/react.js' } };
      const scoped = addScope(importMap, '/app/', { lodash: 'https://cdn.com/lodash.js' });

      expect(scoped.scopes?.['/app/']['lodash']).toBe('https://cdn.com/lodash.js');
      expect(scoped.imports['react']).toBe('https://cdn.com/react.js');
    });
  });

  describe('generateImportMapScriptTag', () => {
    it('should generate valid script tag', () => {
      const importMap = createImportMap(mockDependencies.slice(0, 1));
      const tag = generateImportMapScriptTag(importMap);

      expect(tag).toContain('<script type="importmap">');
      expect(tag).toContain('</script>');
      expect(tag).toContain('"react"');
      expect(tag).toContain('cdnjs.cloudflare.com');
    });

    it('should escape HTML in URLs', () => {
      const importMap: ImportMap = {
        imports: { test: 'https://cdn.com/lib.js?foo=1&bar=2' },
      };
      const tag = generateImportMapScriptTag(importMap);

      // Should not break JSON
      expect(() => {
        const content = tag.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
        if (content) JSON.parse(content);
      }).not.toThrow();
    });
  });

  describe('generateImportMapScriptTagMinified', () => {
    it('should generate minified script tag', () => {
      const importMap = createImportMap(mockDependencies.slice(0, 1));
      const tag = generateImportMapScriptTagMinified(importMap);

      expect(tag).not.toContain('\n');
      expect(tag).toContain('<script type="importmap">');
    });
  });

  describe('generateUMDShim', () => {
    it('should generate UMD to ESM shim JavaScript code', () => {
      const shim = generateUMDShim(mockDependencies);

      // generateUMDShim returns JavaScript code, not wrapped in script tags
      expect(shim).toContain('window.__esm_shim');
      expect(shim).toContain('React');
      expect(shim).toContain('ReactDOM');
      expect(shim).toContain('_');
    });

    it('should handle empty dependencies', () => {
      const shim = generateUMDShim([]);
      expect(shim).toBe('');
    });

    it('should only include non-ESM dependencies with global names', () => {
      const depsWithoutGlobal: ResolvedDependency[] = [
        {
          packageName: 'some-lib',
          version: '1.0.0',
          cdnUrl: 'https://cdn.com/lib.js',
          esm: true, // ESM deps are excluded from UMD shim
          provider: 'cloudflare',
        },
      ];
      const shim = generateUMDShim(depsWithoutGlobal);
      expect(shim).toBe('');
    });
  });

  describe('generateCDNScriptTags', () => {
    it('should generate script tags for all dependencies', () => {
      const tags = generateCDNScriptTags(mockDependencies);

      // Returns array of script tags
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(3);

      const allTags = tags.join('\n');
      expect(allTags).toContain('<script');
      expect(allTags).toContain('src="https://cdnjs.cloudflare.com');
      expect(allTags).toContain('crossorigin="anonymous"');
    });

    it('should include integrity when available', () => {
      const tags = generateCDNScriptTags(mockDependencies);

      const allTags = tags.join('\n');
      expect(allTags).toContain('integrity="sha384-abc123"');
    });

    it('should handle minified option', () => {
      const tags = generateCDNScriptTags(mockDependencies, { minify: true });

      // When minified, each tag is on single line
      expect(Array.isArray(tags)).toBe(true);
      tags.forEach((tag) => {
        expect(tag).not.toContain('\n');
      });
    });
  });

  describe('generateESMScriptTags', () => {
    it('should generate ESM script tags', () => {
      const esmDeps: ResolvedDependency[] = [
        {
          packageName: 'some-esm-lib',
          version: '1.0.0',
          cdnUrl: 'https://esm.sh/some-lib@1.0.0',
          esm: true,
          provider: 'esm.sh',
        },
      ];
      const tags = generateESMScriptTags(esmDeps);

      // Returns array of script tags
      expect(Array.isArray(tags)).toBe(true);
      const allTags = tags.join('\n');
      expect(allTags).toContain('type="module"');
    });
  });

  describe('generateDependencyHTML', () => {
    it('should generate complete dependency loading HTML', () => {
      const html = generateDependencyHTML(mockDependencies);

      // Should include script tags
      expect(html).toContain('<script');
      expect(html).toContain('src=');
      // Should include UMD shim for globals
      expect(html).toContain('React');
    });

    it('should include import map when requested', () => {
      const html = generateDependencyHTML(mockDependencies, { includeImportMap: true });

      expect(html).toContain('type="importmap"');
    });

    it('should respect minify option', () => {
      const html = generateDependencyHTML(mockDependencies, { minify: true });

      // Minified version should have less whitespace
      const minifiedLines = html.split('\n').filter((l) => l.trim()).length;

      const prettyHtml = generateDependencyHTML(mockDependencies, { minify: false });
      const prettyLines = prettyHtml.split('\n').filter((l) => l.trim()).length;

      expect(minifiedLines).toBeLessThanOrEqual(prettyLines);
    });
  });

  describe('validateImportMap', () => {
    it('should validate correct import map', () => {
      const importMap = createImportMap(mockDependencies);
      const result = validateImportMap(importMap);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect invalid URLs', () => {
      const invalidMap: ImportMap = {
        imports: { test: 'not-a-valid-url' },
      };
      const result = validateImportMap(invalidMap);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect non-HTTPS URLs', () => {
      const httpMap: ImportMap = {
        imports: { test: 'http://insecure.com/lib.js' },
      };
      const result = validateImportMap(httpMap);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('HTTPS'))).toBe(true);
    });

    it('should validate integrity hash format', () => {
      const invalidIntegrity: ImportMap = {
        imports: { test: 'https://cdn.com/lib.js' },
        integrity: { 'https://cdn.com/lib.js': 'invalid-hash' },
      };
      const result = validateImportMap(invalidIntegrity);

      expect(result.valid).toBe(false);
    });
  });
});
