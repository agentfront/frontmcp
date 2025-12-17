/**
 * Dependency Resolver Tests
 *
 * Tests for the DependencyResolver class.
 */

import {
  DependencyResolver,
  createResolver,
  createClaudeResolver,
  createOpenAIResolver,
  resolveDependencies,
  generateImportMapForPackages,
  DependencyResolutionError,
  NoProviderError,
} from '../resolver';

describe('DependencyResolver', () => {
  describe('constructor', () => {
    it('should create resolver with default options', () => {
      const resolver = new DependencyResolver();
      expect(resolver).toBeInstanceOf(DependencyResolver);
    });

    it('should create resolver with platform option', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      expect(resolver).toBeInstanceOf(DependencyResolver);
    });

    it('should create resolver with custom registry', () => {
      const resolver = new DependencyResolver({
        customRegistry: {
          'my-lib': {
            packageName: 'my-lib',
            defaultVersion: '1.0.0',
            providers: {
              cloudflare: { url: 'https://example.com/my-lib.js' },
            },
          },
        },
      });
      expect(resolver).toBeInstanceOf(DependencyResolver);
    });
  });

  describe('resolve', () => {
    it('should resolve a known package', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const result = resolver.resolve('react');

      expect(result.packageName).toBe('react');
      expect(result.cdnUrl).toContain('cloudflare');
      expect(result.provider).toBe('cloudflare');
    });

    it('should throw for unknown package in strict mode', () => {
      const resolver = new DependencyResolver({ strictMode: true });
      expect(() => resolver.resolve('unknown-package-xyz')).toThrow(DependencyResolutionError);
    });

    it('should also throw for unknown package when strict mode is off (resolve still throws)', () => {
      // Note: resolve() always throws for unknown packages
      // strictMode affects resolveMany() which skips errors
      const resolver = new DependencyResolver({ strictMode: false });
      expect(() => resolver.resolve('unknown-package-xyz')).toThrow(DependencyResolutionError);
    });

    it('should use override when provided', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const result = resolver.resolve('react', {
        url: 'https://custom.cdn.com/react.js',
        global: 'CustomReact',
      });

      expect(result.cdnUrl).toBe('https://custom.cdn.com/react.js');
      expect(result.global).toBe('CustomReact');
    });

    it('should include version in result', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const result = resolver.resolve('react');

      expect(result.version).toBeDefined();
      expect(result.version.length).toBeGreaterThan(0);
    });

    it('should include esm flag', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const result = resolver.resolve('react');

      expect(typeof result.esm).toBe('boolean');
    });
  });

  describe('resolveMany', () => {
    it('should resolve multiple packages', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const results = resolver.resolveMany(['react', 'lodash']);

      expect(results.length).toBe(2);
      expect(results.map((r) => r.packageName)).toContain('react');
      expect(results.map((r) => r.packageName)).toContain('lodash');
    });

    it('should skip unknown packages', () => {
      const resolver = new DependencyResolver({ strictMode: false });
      const results = resolver.resolveMany(['react', 'unknown-xyz']);

      expect(results.length).toBe(1);
      expect(results[0].packageName).toBe('react');
    });

    it('should include peer dependencies', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const results = resolver.resolveMany(['react-dom']);

      const packageNames = results.map((r) => r.packageName);
      expect(packageNames).toContain('react-dom');
      expect(packageNames).toContain('react');
    });

    it('should dedupe results', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const results = resolver.resolveMany(['react', 'react-dom']);

      const reactCount = results.filter((r) => r.packageName === 'react').length;
      expect(reactCount).toBe(1);
    });
  });

  describe('resolveFromSource', () => {
    it('should resolve imports from source code with externals list', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const source = `
        import React from 'react';
        import { Chart } from 'chart.js';
        import { helper } from './utils';
      `;
      // resolveFromSource requires externals parameter
      const results = resolver.resolveFromSource(source, ['react', 'chart.js']);

      const packageNames = results.map((r) => r.packageName);
      expect(packageNames).toContain('react');
      expect(packageNames).toContain('chart.js');
      // Should not include relative import
      expect(packageNames).not.toContain('./utils');
    });

    it('should filter by externals list', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const source = `
        import React from 'react';
        import { Chart } from 'chart.js';
        import lodash from 'lodash';
      `;
      const results = resolver.resolveFromSource(source, ['react', 'lodash']);

      const packageNames = results.map((r) => r.packageName);
      expect(packageNames).toContain('react');
      expect(packageNames).toContain('lodash');
      // chart.js not in externals, should be excluded
      expect(packageNames).not.toContain('chart.js');
    });
  });

  describe('generateImportMap', () => {
    it('should generate import map from resolved dependencies', () => {
      const resolver = new DependencyResolver({ platform: 'claude' });
      const results = resolver.resolveMany(['react', 'lodash']);
      const importMap = resolver.generateImportMap(results);

      expect(importMap.imports['react']).toBeDefined();
      expect(importMap.imports['lodash']).toBeDefined();
      expect(importMap.imports['react']).toContain('https://');
    });
  });

  describe('getRegistry', () => {
    it('should return the merged registry', () => {
      const resolver = new DependencyResolver();
      const registry = resolver.getRegistry();

      expect(registry['react']).toBeDefined();
      expect(registry['lodash']).toBeDefined();
    });
  });
});

describe('Factory Functions', () => {
  describe('createResolver', () => {
    it('should create resolver with options', () => {
      const resolver = createResolver({ platform: 'claude' });
      expect(resolver).toBeInstanceOf(DependencyResolver);
    });
  });

  describe('createClaudeResolver', () => {
    it('should create Claude-optimized resolver', () => {
      const resolver = createClaudeResolver();
      const result = resolver.resolve('react');

      expect(result.cdnUrl).toContain('cloudflare');
    });
  });

  describe('createOpenAIResolver', () => {
    it('should create OpenAI-optimized resolver', () => {
      const resolver = createOpenAIResolver();
      const result = resolver.resolve('react');

      // OpenAI prefers esm.sh or jsdelivr
      expect(result.cdnUrl).toBeDefined();
    });
  });
});

describe('Convenience Functions', () => {
  describe('resolveDependencies', () => {
    it('should resolve from source code with externals', () => {
      const source = `import React from 'react'; import lodash from 'lodash';`;
      const results = resolveDependencies(source, ['react', 'lodash']);
      expect(results.length).toBe(2);
    });

    it('should resolve packages with platform option', () => {
      const source = `import React from 'react';`;
      const results = resolveDependencies(source, ['react'], { platform: 'claude' });
      expect(results[0].cdnUrl).toContain('cloudflare');
    });
  });

  describe('generateImportMapForPackages', () => {
    it('should generate import map directly from package names', () => {
      const importMap = generateImportMapForPackages(['react', 'lodash'], { platform: 'claude' });

      expect(importMap.imports['react']).toBeDefined();
      expect(importMap.imports['lodash']).toBeDefined();
    });
  });
});

describe('Error Classes', () => {
  describe('DependencyResolutionError', () => {
    it('should include package name', () => {
      const error = new DependencyResolutionError('test-package', 'Not found');
      expect(error.packageName).toBe('test-package');
      expect(error.message).toContain('test-package');
    });
  });

  describe('NoProviderError', () => {
    it('should extend DependencyResolutionError', () => {
      const error = new NoProviderError('test-package', 'claude');
      expect(error).toBeInstanceOf(DependencyResolutionError);
      expect(error.platform).toBe('claude');
    });
  });
});
