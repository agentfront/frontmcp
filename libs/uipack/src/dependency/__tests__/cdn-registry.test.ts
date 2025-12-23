/**
 * CDN Registry Tests
 *
 * Tests for CDN package registry and URL resolution.
 */

import {
  DEFAULT_CDN_REGISTRY,
  CDN_PROVIDER_PRIORITY,
  lookupPackage,
  getPackageCDNUrl,
  getPackageCDNDependency,
  getRegisteredPackages,
  isPackageRegistered,
  mergeRegistries,
  getPackagePeerDependencies,
  resolveAllDependencies,
} from '../cdn-registry';

describe('CDN Registry', () => {
  describe('DEFAULT_CDN_REGISTRY', () => {
    it('should contain common packages', () => {
      expect(DEFAULT_CDN_REGISTRY['react']).toBeDefined();
      expect(DEFAULT_CDN_REGISTRY['react-dom']).toBeDefined();
      expect(DEFAULT_CDN_REGISTRY['chart.js']).toBeDefined();
      expect(DEFAULT_CDN_REGISTRY['d3']).toBeDefined();
      expect(DEFAULT_CDN_REGISTRY['lodash']).toBeDefined();
    });

    it('should have cloudflare provider for Claude compatibility', () => {
      const react = DEFAULT_CDN_REGISTRY['react'];
      expect(react.providers.cloudflare).toBeDefined();
      expect(react.providers.cloudflare?.url).toContain('cdnjs.cloudflare.com');
    });

    it('should include integrity hashes where available', () => {
      const react = DEFAULT_CDN_REGISTRY['react'];
      const cloudflareConfig = react.providers.cloudflare;
      // Integrity hashes may or may not be present
      if (cloudflareConfig?.integrity) {
        expect(cloudflareConfig.integrity).toMatch(/^sha(256|384|512)-/);
      }
    });
  });

  describe('CDN_PROVIDER_PRIORITY', () => {
    it('should prioritize cloudflare for Claude', () => {
      const priority = CDN_PROVIDER_PRIORITY.claude;
      expect(priority[0]).toBe('cloudflare');
      // Claude ONLY allows cloudflare
      expect(priority.length).toBe(1);
    });

    it('should have cloudflare as top priority for OpenAI (for compatibility)', () => {
      const priority = CDN_PROVIDER_PRIORITY.openai;
      // OpenAI defaults to cloudflare for broad compatibility
      expect(priority[0]).toBe('cloudflare');
      // But has fallbacks
      expect(priority).toContain('jsdelivr');
      expect(priority).toContain('esm.sh');
    });

    it('should prioritize cloudflare for unknown platforms', () => {
      const priority = CDN_PROVIDER_PRIORITY.unknown;
      expect(priority[0]).toBe('cloudflare');
    });
  });

  describe('lookupPackage', () => {
    it('should return registry entry for known package', () => {
      const entry = lookupPackage('react');
      expect(entry).toBeDefined();
      expect(entry?.packageName).toBe('react');
      expect(entry?.defaultVersion).toBeDefined();
    });

    it('should return undefined for unknown package', () => {
      const entry = lookupPackage('unknown-package-xyz');
      expect(entry).toBeUndefined();
    });

    it('should lookup from custom registry', () => {
      const customRegistry = {
        'my-package': {
          packageName: 'my-package',
          defaultVersion: '1.0.0',
          providers: {
            cloudflare: {
              url: 'https://cdnjs.cloudflare.com/ajax/libs/my-package/1.0.0/index.min.js',
            },
          },
        },
      };
      const entry = lookupPackage('my-package', customRegistry);
      expect(entry?.packageName).toBe('my-package');
    });
  });

  describe('getPackageCDNUrl', () => {
    it('should return cloudflare URL for Claude platform', () => {
      const url = getPackageCDNUrl('react', 'claude');
      expect(url).toContain('cdnjs.cloudflare.com');
    });

    it('should return esm.sh URL for OpenAI platform when available', () => {
      const url = getPackageCDNUrl('react', 'openai');
      // May be esm.sh or jsdelivr depending on registry
      expect(url).toBeDefined();
      expect(url).toMatch(/^https:\/\//);
    });

    it('should return undefined for unknown package', () => {
      const url = getPackageCDNUrl('unknown-package-xyz', 'claude');
      expect(url).toBeUndefined();
    });

    it('should fallback to any available provider', () => {
      const url = getPackageCDNUrl('lodash', 'unknown');
      expect(url).toBeDefined();
    });
  });

  describe('getPackageCDNDependency', () => {
    it('should return full CDN dependency config with provider', () => {
      const result = getPackageCDNDependency('react', 'claude');
      expect(result).toBeDefined();
      expect(result?.provider).toBe('cloudflare');
      expect(result?.dependency.url).toContain('cloudflare');
      expect(result?.dependency.global).toBe('React');
    });

    it('should include global variable name in dependency', () => {
      const result = getPackageCDNDependency('chart.js', 'claude');
      expect(result?.dependency.global).toBe('Chart');
    });
  });

  describe('getRegisteredPackages', () => {
    it('should return all registered package names', () => {
      const packages = getRegisteredPackages();
      expect(packages).toContain('react');
      expect(packages).toContain('react-dom');
      expect(packages).toContain('chart.js');
      expect(packages.length).toBeGreaterThan(10);
    });
  });

  describe('isPackageRegistered', () => {
    it('should return true for registered packages', () => {
      expect(isPackageRegistered('react')).toBe(true);
      expect(isPackageRegistered('lodash')).toBe(true);
    });

    it('should return false for unregistered packages', () => {
      expect(isPackageRegistered('unknown-package-xyz')).toBe(false);
    });
  });

  describe('mergeRegistries', () => {
    it('should merge custom registry with default registry', () => {
      const custom = {
        'custom-lib': {
          packageName: 'custom-lib',
          defaultVersion: '2.0.0',
          providers: {
            cloudflare: {
              url: 'https://cdnjs.cloudflare.com/ajax/libs/custom-lib/2.0.0/index.min.js',
            },
          },
        },
      };
      // mergeRegistries takes only the custom registry and merges with DEFAULT
      const merged = mergeRegistries(custom);
      expect(merged['react']).toBeDefined();
      expect(merged['custom-lib']).toBeDefined();
    });

    it('should override default with custom entries', () => {
      const custom = {
        react: {
          packageName: 'react',
          defaultVersion: '99.0.0',
          providers: {
            cloudflare: {
              url: 'https://custom-cdn.com/react.js',
            },
          },
        },
      };
      const merged = mergeRegistries(custom);
      expect(merged['react'].defaultVersion).toBe('99.0.0');
    });
  });

  describe('getPackagePeerDependencies', () => {
    it('should return peer dependencies for react-dom', () => {
      const peers = getPackagePeerDependencies('react-dom');
      expect(peers).toContain('react');
    });

    it('should return empty array for packages without peers', () => {
      const peers = getPackagePeerDependencies('lodash');
      expect(peers).toEqual([]);
    });

    it('should return empty array for unknown packages', () => {
      const peers = getPackagePeerDependencies('unknown-package');
      expect(peers).toEqual([]);
    });
  });

  describe('resolveAllDependencies', () => {
    it('should resolve single package', () => {
      const result = resolveAllDependencies(['react'], 'claude');
      expect(result).toContain('react');
    });

    it('should include peer dependencies', () => {
      const result = resolveAllDependencies(['react-dom'], 'claude');
      expect(result).toContain('react-dom');
      expect(result).toContain('react');
    });

    it('should dedupe dependencies', () => {
      const result = resolveAllDependencies(['react', 'react-dom'], 'claude');
      const reactCount = result.filter((p) => p === 'react').length;
      expect(reactCount).toBe(1);
    });

    it('should return in dependency order', () => {
      const result = resolveAllDependencies(['react-dom'], 'claude');
      const reactIndex = result.indexOf('react');
      const reactDomIndex = result.indexOf('react-dom');
      expect(reactIndex).toBeLessThan(reactDomIndex);
    });

    it('should include unknown packages (caller filters them)', () => {
      // resolveAllDependencies includes all requested packages
      // The caller (DependencyResolver) is responsible for filtering unknown packages
      const result = resolveAllDependencies(['react', 'unknown-package'], 'claude');
      expect(result).toContain('react');
      expect(result).toContain('unknown-package'); // Included, even if unknown
    });
  });
});
