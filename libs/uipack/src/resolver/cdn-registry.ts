/**
 * CDN Registry
 *
 * Pre-configured CDN URLs for popular npm packages.
 * Maps package names to their CDN URLs for different providers.
 *
 * @packageDocumentation
 */

import type { CDNRegistry, CDNRegistryEntry, CDNProvider } from './types';

/**
 * Built-in CDN registry for popular packages.
 * Cloudflare CDN (cdnjs.cloudflare.com) is prioritized for maximum compatibility.
 */
export const DEFAULT_CDN_REGISTRY: CDNRegistry = {
  react: {
    packageName: 'react',
    defaultVersion: '19.2.4',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/react/19.2.4/umd/react.production.min.js',
        global: 'React',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/react@19.2.4/umd/react.production.min.js',
        global: 'React',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/react@19.2.4/umd/react.production.min.js',
        global: 'React',
        crossorigin: 'anonymous',
      },
      'esm.sh': {
        url: 'https://esm.sh/react@19.2.4',
        esm: true,
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
    metadata: {
      description: 'A JavaScript library for building user interfaces',
      homepage: 'https://react.dev',
      license: 'MIT',
    },
  },

  'react-dom': {
    packageName: 'react-dom',
    defaultVersion: '19.2.4',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/19.2.4/umd/react-dom.production.min.js',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/react-dom@19.2.4/umd/react-dom.production.min.js',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      unpkg: {
        url: 'https://unpkg.com/react-dom@19.2.4/umd/react-dom.production.min.js',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      'esm.sh': {
        url: 'https://esm.sh/react-dom@19.2.4',
        esm: true,
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
    metadata: {
      description: 'React package for working with the DOM',
      homepage: 'https://react.dev',
      license: 'MIT',
    },
  },

  'chart.js': {
    packageName: 'chart.js',
    defaultVersion: '4.5.1',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js',
        global: 'Chart',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
        global: 'Chart',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/chart.js@4.5.1/dist/chart.umd.min.js',
        global: 'Chart',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'Simple yet flexible JavaScript charting library',
      homepage: 'https://www.chartjs.org',
      license: 'MIT',
    },
  },

  d3: {
    packageName: 'd3',
    defaultVersion: '7.9.0',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js',
        integrity: 'sha512-vc58qvvBdrDR4etbxMdlTt4GBQk1qjvyORR2nrsPsFPyrs+/u5c3+1Ct6upOgdZoIl7eq6k3a1UPDSNAQi/32A==',
        global: 'd3',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
        global: 'd3',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/d3@7.9.0/dist/d3.min.js',
        global: 'd3',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'Data-Driven Documents',
      homepage: 'https://d3js.org',
      license: 'ISC',
    },
  },

  lodash: {
    packageName: 'lodash',
    defaultVersion: '4.17.21',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
        integrity: 'sha512-WFN04846sdKMIP5LKNphMaWzU7YpMyCU245etK3g/2ARYbPK9Ub18eG+ljU96qKRCWh+quCY7yefSmlkQw1ANQ==',
        global: '_',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
        global: '_',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/lodash@4.17.21/lodash.min.js',
        global: '_',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'A modern JavaScript utility library',
      homepage: 'https://lodash.com',
      license: 'MIT',
    },
  },
};

/**
 * Look up a package in the CDN registry.
 */
export function lookupPackage(
  packageName: string,
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): CDNRegistryEntry | undefined {
  return registry[packageName];
}

/**
 * Get the CDN URL for a package, trying providers in order.
 */
export function getPackageCDNUrl(
  packageName: string,
  providerOrder: CDNProvider[] = ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): string | undefined {
  const entry = lookupPackage(packageName, registry);
  if (!entry) return undefined;

  for (const provider of providerOrder) {
    const config = entry.providers[provider];
    if (config?.url) {
      return config.url;
    }
  }

  // Fallback: try any available provider
  for (const provider of Object.keys(entry.providers) as CDNProvider[]) {
    const config = entry.providers[provider];
    if (config?.url) {
      return config.url;
    }
  }

  return undefined;
}

/**
 * Get all registered package names.
 */
export function getRegisteredPackages(registry: CDNRegistry = DEFAULT_CDN_REGISTRY): string[] {
  return Object.keys(registry);
}

/**
 * Check if a package is in the registry.
 */
export function isPackageRegistered(packageName: string, registry: CDNRegistry = DEFAULT_CDN_REGISTRY): boolean {
  return packageName in registry;
}

/**
 * Merge custom registry with the default registry.
 */
export function mergeRegistries(customRegistry: CDNRegistry): CDNRegistry {
  return {
    ...DEFAULT_CDN_REGISTRY,
    ...customRegistry,
  };
}

/**
 * Get peer dependencies for a package.
 */
export function getPackagePeerDependencies(
  packageName: string,
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): string[] {
  const entry = lookupPackage(packageName, registry);
  if (!entry) return [];

  for (const provider of Object.keys(entry.providers) as CDNProvider[]) {
    const config = entry.providers[provider];
    if (config?.peerDependencies) {
      return config.peerDependencies;
    }
  }

  return [];
}
