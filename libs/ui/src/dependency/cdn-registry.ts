/**
 * CDN Registry
 *
 * Pre-configured CDN URLs for popular npm packages.
 * Maps package names to their CDN URLs for different providers.
 *
 * Priority: cdnjs.cloudflare.com (Claude compatible) > jsdelivr > unpkg > esm.sh
 *
 * @packageDocumentation
 */

import type { CDNRegistry, CDNRegistryEntry, CDNProvider, CDNPlatformType } from './types';

// ============================================
// Default CDN Registry
// ============================================

/**
 * Built-in CDN registry for popular packages.
 *
 * This registry provides CDN URLs for common libraries used in UI widgets.
 * Cloudflare CDN (cdnjs.cloudflare.com) is prioritized for Claude compatibility.
 */
export const DEFAULT_CDN_REGISTRY: CDNRegistry = {
  // ============================================
  // React Ecosystem
  // ============================================

  react: {
    packageName: 'react',
    defaultVersion: '18.3.1',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
        integrity: 'sha512-Qp8J4Xr8LBZ5CXNJQc/HmLqFrpXz6lNkbzMYkYHKzQx5p1q1yOqPQHntXKoYgPPE/n9m0QF1OkJdXa2ePpO4fw==',
        global: 'React',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
        global: 'React',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
        global: 'React',
        crossorigin: 'anonymous',
      },
      'esm.sh': {
        url: 'https://esm.sh/react@18.3.1',
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
    defaultVersion: '18.3.1',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
        integrity: 'sha512-6s2gVRdS3aT+FDdZTRJSzKlzIPqDXWyYl/5hPQb6hSgzKPGFcQyZhbqjbWVxGrs2dYNrINFXb0k0UD3d+CKPJA==',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      unpkg: {
        url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
        global: 'ReactDOM',
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      'esm.sh': {
        url: 'https://esm.sh/react-dom@18.3.1',
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

  // ============================================
  // Charting Libraries
  // ============================================

  'chart.js': {
    packageName: 'chart.js',
    defaultVersion: '4.4.7',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
        integrity: 'sha512-dMDjIoZjJD6gs0KPBhFYjLQrH3kIohSEn6HzWs6Y6GiO0+L9kk/bM3cR5KNEDK1KvMNpTIZG6pHK9SZfCJHRpQ==',
        global: 'Chart',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
        global: 'Chart',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/chart.js@4.4.7/dist/chart.umd.min.js',
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

  'react-chartjs-2': {
    packageName: 'react-chartjs-2',
    defaultVersion: '5.3.0',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/react-chartjs-2/5.3.0/react-chartjs-2.min.js',
        global: 'ReactChartjs2',
        crossorigin: 'anonymous',
        peerDependencies: ['react', 'chart.js'],
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/react-chartjs-2@5.3.0/dist/index.umd.js',
        global: 'ReactChartjs2',
        crossorigin: 'anonymous',
        peerDependencies: ['react', 'chart.js'],
      },
      'esm.sh': {
        url: 'https://esm.sh/react-chartjs-2@5.3.0',
        esm: true,
        crossorigin: 'anonymous',
        peerDependencies: ['react', 'chart.js'],
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'esm.sh'],
    metadata: {
      description: 'React components for Chart.js',
      homepage: 'https://react-chartjs-2.js.org',
      license: 'MIT',
    },
  },

  // ============================================
  // D3.js
  // ============================================

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

  // ============================================
  // Utility Libraries
  // ============================================

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

  'lodash-es': {
    packageName: 'lodash-es',
    defaultVersion: '4.17.21',
    providers: {
      'esm.sh': {
        url: 'https://esm.sh/lodash-es@4.17.21',
        esm: true,
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/+esm',
        esm: true,
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['esm.sh', 'jsdelivr'],
    metadata: {
      description: 'Lodash exported as ES modules',
      homepage: 'https://lodash.com',
      license: 'MIT',
    },
  },

  dayjs: {
    packageName: 'dayjs',
    defaultVersion: '1.11.13',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js',
        integrity: 'sha512-Ot7ArUEhJDU0cwoBNNnWe487kjL5wAOsIYig8llY/l0P2TUFwgsAHVmrZMHsT8NGo+HwkjTJsNErS6QqIkBxDw==',
        global: 'dayjs',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js',
        global: 'dayjs',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/dayjs@1.11.13/dayjs.min.js',
        global: 'dayjs',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'Fast 2kB alternative to Moment.js with the same modern API',
      homepage: 'https://day.js.org',
      license: 'MIT',
    },
  },

  'date-fns': {
    packageName: 'date-fns',
    defaultVersion: '4.1.0',
    providers: {
      'esm.sh': {
        url: 'https://esm.sh/date-fns@4.1.0',
        esm: true,
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/date-fns@4.1.0/+esm',
        esm: true,
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['esm.sh', 'jsdelivr'],
    metadata: {
      description: 'Modern JavaScript date utility library',
      homepage: 'https://date-fns.org',
      license: 'MIT',
    },
  },

  // ============================================
  // Animation Libraries
  // ============================================

  'framer-motion': {
    packageName: 'framer-motion',
    defaultVersion: '11.15.0',
    providers: {
      'esm.sh': {
        url: 'https://esm.sh/framer-motion@11.15.0',
        esm: true,
        crossorigin: 'anonymous',
        peerDependencies: ['react', 'react-dom'],
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/framer-motion@11.15.0/dist/framer-motion.js',
        global: 'Motion',
        crossorigin: 'anonymous',
        peerDependencies: ['react', 'react-dom'],
      },
    },
    preferredProviders: ['esm.sh', 'jsdelivr'],
    metadata: {
      description: 'Production-ready motion library for React',
      homepage: 'https://www.framer.com/motion/',
      license: 'MIT',
    },
  },

  // ============================================
  // UI Component Libraries
  // ============================================

  'lucide-react': {
    packageName: 'lucide-react',
    defaultVersion: '0.468.0',
    providers: {
      'esm.sh': {
        url: 'https://esm.sh/lucide-react@0.468.0',
        esm: true,
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/lucide-react@0.468.0/dist/esm/lucide-react.js',
        esm: true,
        crossorigin: 'anonymous',
        peerDependencies: ['react'],
      },
    },
    preferredProviders: ['esm.sh', 'jsdelivr'],
    metadata: {
      description: 'Beautiful & consistent icon toolkit for React',
      homepage: 'https://lucide.dev',
      license: 'ISC',
    },
  },

  // ============================================
  // Markdown/Syntax Highlighting
  // ============================================

  marked: {
    packageName: 'marked',
    defaultVersion: '15.0.4',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.4/marked.min.js',
        integrity: 'sha512-Rn/d0sGeizGbk3VJEiYNDt/mMcfuzYoFkia3iBffv+HX8VUrHMo/0cKjZuxWGoZLPh/VxUcC9ais+RBFZW9EBg==',
        global: 'marked',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/marked@15.0.4/marked.min.js',
        global: 'marked',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/marked@15.0.4/marked.min.js',
        global: 'marked',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'A markdown parser and compiler',
      homepage: 'https://marked.js.org',
      license: 'MIT',
    },
  },

  'highlight.js': {
    packageName: 'highlight.js',
    defaultVersion: '11.10.0',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js',
        integrity: 'sha512-6yoqbrcLAHDWAdQmiRlHG4+m0g/CT/V9AGyxabG8j7Jk8j3v3k6mIP1iN/PvSofcWet2tf8SRn/j3L/+pb7LRQ==',
        global: 'hljs',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/core.min.js',
        global: 'hljs',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/highlight.js@11.10.0/lib/core.min.js',
        global: 'hljs',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'Syntax highlighting for the web',
      homepage: 'https://highlightjs.org',
      license: 'BSD-3-Clause',
    },
  },

  // ============================================
  // Interactive Libraries
  // ============================================

  'htmx.org': {
    packageName: 'htmx.org',
    defaultVersion: '2.0.4',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.4/htmx.min.js',
        integrity: 'sha512-2kIcAizYXhIn5IyXrMC72f2nh0JAtESHRpOieVw5dYPYeHwLCC2eKCqvdZDYRSEgasKrPpEPpRFjL8gqwBZWAA==',
        global: 'htmx',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js',
        global: 'htmx',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js',
        global: 'htmx',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'High power tools for HTML',
      homepage: 'https://htmx.org',
      license: 'BSD-2-Clause',
    },
  },

  alpinejs: {
    packageName: 'alpinejs',
    defaultVersion: '3.14.3',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.14.3/cdn.min.js',
        integrity: 'sha512-lrQ8FHgsWKFSuQFq8NKPJicjlvJFEIrCqEj8zeX7ZOUlHWltN/Iow4jND+x84jqTdDf9n+hvQpJjGDvOl/eDRA==',
        global: 'Alpine',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js',
        global: 'Alpine',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/alpinejs@3.14.3/dist/cdn.min.js',
        global: 'Alpine',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'A rugged, minimal framework for composing behavior directly in your markup',
      homepage: 'https://alpinejs.dev',
      license: 'MIT',
    },
  },

  // ============================================
  // Templating Libraries
  // ============================================

  handlebars: {
    packageName: 'handlebars',
    defaultVersion: '4.7.8',
    providers: {
      cloudflare: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.8/handlebars.min.js',
        integrity: 'sha512-E1dSFxg+wsfJ4HKjutk/WaCzK7S2wv1POn1RRPGh8ZK+ag9l244Vqxji3r6wgz9YBf6+vhQEYJZpSjqWFPg9gg==',
        global: 'Handlebars',
        crossorigin: 'anonymous',
      },
      jsdelivr: {
        url: 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/dist/handlebars.min.js',
        global: 'Handlebars',
        crossorigin: 'anonymous',
      },
      unpkg: {
        url: 'https://unpkg.com/handlebars@4.7.8/dist/handlebars.min.js',
        global: 'Handlebars',
        crossorigin: 'anonymous',
      },
    },
    preferredProviders: ['cloudflare', 'jsdelivr', 'unpkg'],
    metadata: {
      description: 'Minimal templating on steroids',
      homepage: 'https://handlebarsjs.com',
      license: 'MIT',
    },
  },
};

// ============================================
// Provider Priority by Platform
// ============================================

/**
 * CDN provider priority order by platform.
 * Claude only trusts cdnjs.cloudflare.com.
 */
export const CDN_PROVIDER_PRIORITY: Record<CDNPlatformType, CDNProvider[]> = {
  claude: ['cloudflare'], // ONLY cloudflare for Claude
  openai: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  cursor: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  gemini: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  continue: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  cody: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'],
  unknown: ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh'], // Default to cloudflare first
};

// ============================================
// Registry Lookup Functions
// ============================================

/**
 * Look up a package in the CDN registry.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to search (defaults to DEFAULT_CDN_REGISTRY)
 * @returns Registry entry or undefined
 */
export function lookupPackage(
  packageName: string,
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): CDNRegistryEntry | undefined {
  return registry[packageName];
}

/**
 * Get the CDN URL for a package.
 *
 * Resolves the CDN URL using platform-specific provider priority.
 *
 * @param packageName - NPM package name
 * @param platform - Target platform (affects CDN selection)
 * @param registry - Registry to search (defaults to DEFAULT_CDN_REGISTRY)
 * @returns CDN URL or undefined if not found
 */
export function getPackageCDNUrl(
  packageName: string,
  platform: CDNPlatformType = 'unknown',
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): string | undefined {
  const entry = lookupPackage(packageName, registry);
  if (!entry) return undefined;

  // Get provider priority for the platform
  const providerPriority = CDN_PROVIDER_PRIORITY[platform];

  // Try providers in priority order
  for (const provider of providerPriority) {
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
 * Get full CDN dependency configuration for a package.
 *
 * @param packageName - NPM package name
 * @param platform - Target platform
 * @param registry - Registry to search
 * @returns CDN dependency or undefined
 */
export function getPackageCDNDependency(
  packageName: string,
  platform: CDNPlatformType = 'unknown',
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): { provider: CDNProvider; dependency: import('./types').CDNDependency } | undefined {
  const entry = lookupPackage(packageName, registry);
  if (!entry) return undefined;

  const providerPriority = CDN_PROVIDER_PRIORITY[platform];

  for (const provider of providerPriority) {
    const config = entry.providers[provider];
    if (config?.url) {
      return { provider, dependency: config };
    }
  }

  // Fallback
  for (const provider of Object.keys(entry.providers) as CDNProvider[]) {
    const config = entry.providers[provider];
    if (config?.url) {
      return { provider, dependency: config };
    }
  }

  return undefined;
}

/**
 * Get all registered package names.
 *
 * @param registry - Registry to list (defaults to DEFAULT_CDN_REGISTRY)
 * @returns Array of package names
 */
export function getRegisteredPackages(registry: CDNRegistry = DEFAULT_CDN_REGISTRY): string[] {
  return Object.keys(registry);
}

/**
 * Check if a package is in the registry.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to check
 * @returns true if the package is registered
 */
export function isPackageRegistered(packageName: string, registry: CDNRegistry = DEFAULT_CDN_REGISTRY): boolean {
  return packageName in registry;
}

/**
 * Merge custom registry with the default registry.
 *
 * Custom entries override default entries for the same package.
 *
 * @param customRegistry - Custom registry to merge
 * @returns Merged registry
 */
export function mergeRegistries(customRegistry: CDNRegistry): CDNRegistry {
  return {
    ...DEFAULT_CDN_REGISTRY,
    ...customRegistry,
  };
}

/**
 * Get peer dependencies for a package.
 *
 * Returns peer dependencies from the first available provider.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to search
 * @returns Array of peer dependency package names
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

/**
 * Resolve all dependencies including peer dependencies.
 *
 * @param packageNames - Initial package names
 * @param platform - Target platform
 * @param registry - Registry to use
 * @returns Array of all resolved package names (including peers)
 */
export function resolveAllDependencies(
  packageNames: string[],
  platform: CDNPlatformType = 'unknown',
  registry: CDNRegistry = DEFAULT_CDN_REGISTRY,
): string[] {
  const resolved = new Set<string>();
  const queue = [...packageNames];

  while (queue.length > 0) {
    const packageName = queue.shift()!;
    if (resolved.has(packageName)) continue;

    resolved.add(packageName);

    // Add peer dependencies to the queue
    const peers = getPackagePeerDependencies(packageName, registry);
    for (const peer of peers) {
      if (!resolved.has(peer)) {
        queue.push(peer);
      }
    }
  }

  // Return in dependency order (peers first)
  const result: string[] = [];
  const remaining = new Set(resolved);

  // Topological sort - add packages whose peers are all resolved
  while (remaining.size > 0) {
    let added = false;
    for (const pkg of remaining) {
      const peers = getPackagePeerDependencies(pkg, registry);
      const allPeersResolved = peers.every((peer) => !remaining.has(peer) || result.includes(peer));

      if (allPeersResolved) {
        if (!result.includes(pkg)) {
          result.push(pkg);
        }
        remaining.delete(pkg);
        added = true;
      }
    }

    // Break circular dependencies
    if (!added && remaining.size > 0) {
      const next = remaining.values().next().value as string | undefined;
      if (next !== undefined) {
        if (!result.includes(next)) {
          result.push(next);
        }
        remaining.delete(next);
      }
    }
  }

  return result;
}
