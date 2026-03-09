/**
 * esm.sh Import Resolver
 *
 * Default resolver that uses esm.sh CDN for bare import specifiers.
 * Falls back to the CDN registry for known packages.
 *
 * @packageDocumentation
 */

import type { ImportResolver, ResolvedImport, ResolveContext, CDNRegistry, CDNProvider } from './types';
import { lookupPackage, DEFAULT_CDN_REGISTRY } from './cdn-registry';
import { getPackageName } from './import-parser';

/**
 * Options for configuring the esm.sh resolver.
 */
export interface EsmShResolverOptions {
  /** Base CDN URL for esm.sh fallback */
  fallbackCdnBase?: string;
  /** Custom CDN registry for known packages */
  registry?: CDNRegistry;
  /** Provider priority order */
  providerOrder?: CDNProvider[];
}

const DEFAULT_FALLBACK_CDN = 'https://esm.sh';

/**
 * Create the default esm.sh import resolver.
 *
 * Known packages (in CDN registry) use their registered CDN URL.
 * Unknown packages fall back to `https://esm.sh/{specifier}`.
 *
 * @example
 * ```typescript
 * const resolver = createEsmShResolver();
 * const result = resolver.resolve('react');
 * // { value: 'https://esm.sh/react@18.3.1', type: 'url' }
 * ```
 */
/**
 * Create an import resolver that applies URL overrides before falling back to the base resolver.
 *
 * Supports exact matches and prefix matches:
 * - Exact: `{ '@frontmcp/ui': 'http://localhost:5173/@frontmcp/ui' }`
 * - Prefix: `@frontmcp/ui/components` matches `@frontmcp/ui` prefix → appends `/components`
 *
 * @example
 * ```typescript
 * const resolver = createResolverWithOverrides({
 *   '@frontmcp/ui': 'http://localhost:5173/@frontmcp/ui',
 * });
 * resolver.resolve('@frontmcp/ui/components');
 * // { value: 'http://localhost:5173/@frontmcp/ui/components', type: 'url' }
 * ```
 */
export function createResolverWithOverrides(
  overrides: Record<string, string>,
  baseOptions?: EsmShResolverOptions,
): ImportResolver & { overrides: Record<string, string> } {
  const base = createEsmShResolver(baseOptions);
  return {
    overrides,
    resolve(specifier: string, context?: ResolveContext): ResolvedImport | null {
      // Exact match
      if (overrides[specifier]) {
        return { value: overrides[specifier], type: 'url' };
      }
      // Prefix match: '@frontmcp/ui' → '@frontmcp/ui/components'
      for (const [prefix, url] of Object.entries(overrides)) {
        if (specifier.startsWith(prefix + '/')) {
          const subpath = specifier.slice(prefix.length);
          return { value: url + subpath, type: 'url' };
        }
      }
      return base.resolve(specifier, context);
    },
  };
}

export function createEsmShResolver(options: EsmShResolverOptions = {}): ImportResolver {
  const {
    fallbackCdnBase = DEFAULT_FALLBACK_CDN,
    registry = DEFAULT_CDN_REGISTRY,
    providerOrder = ['esm.sh', 'cloudflare', 'jsdelivr', 'unpkg'],
  } = options;

  return {
    resolve(specifier: string, _context?: ResolveContext): ResolvedImport | null {
      // Skip relative imports, node built-ins, and hash imports
      if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
        return null;
      }
      if (specifier.startsWith('node:') || specifier.startsWith('#')) {
        return null;
      }

      const pkgName = getPackageName(specifier);
      const entry = lookupPackage(pkgName, registry);

      if (entry) {
        // Try providers in order
        for (const provider of providerOrder) {
          const config = entry.providers[provider];
          if (config?.url) {
            // For subpath imports with esm.sh URLs, append subpath
            const subpath = specifier.slice(pkgName.length);
            if (subpath && config.url.includes('esm.sh/')) {
              return {
                value: config.url + subpath,
                type: 'url',
                integrity: config.integrity,
              };
            }

            // For non-esm.sh CDN URLs with subpaths, fall back to esm.sh
            if (subpath) {
              return {
                value: `${fallbackCdnBase}/${specifier}`,
                type: 'url',
              };
            }

            // If the config has a global name and is not ESM, resolve as global
            if (config.global && !config.esm) {
              return {
                value: config.url,
                type: 'url',
                integrity: config.integrity,
              };
            }

            return {
              value: config.url,
              type: 'url',
              integrity: config.integrity,
            };
          }
        }
      }

      // Fallback to esm.sh
      return {
        value: `${fallbackCdnBase}/${specifier}`,
        type: 'url',
      };
    },
  };
}
