/**
 * Import Rewriter
 *
 * Rewrites bare import specifiers in JavaScript/TypeScript source code
 * to use esm.sh CDN URLs. Uses the existing import parser and CDN registry
 * to resolve known packages.
 *
 * @packageDocumentation
 */

import { parseImports, getPackageName } from './import-parser';
import { getPackageCDNUrl, isPackageRegistered } from './cdn-registry';
import type { CDNPlatformType, CDNRegistry } from './types';

// ============================================
// Types
// ============================================

/**
 * Options for the import rewriter.
 */
export interface RewriteImportsOptions {
  /**
   * Target platform for CDN URL selection.
   * Affects which CDN provider is used (e.g., Claude uses Cloudflare only).
   * @default 'unknown'
   */
  platform?: CDNPlatformType;

  /**
   * Custom CDN registry to use for resolving packages.
   * Uses DEFAULT_CDN_REGISTRY if not provided.
   */
  registry?: CDNRegistry;

  /**
   * Base URL for packages not found in the CDN registry.
   * @default 'https://esm.sh'
   */
  fallbackCdnBase?: string;

  /**
   * Packages to skip rewriting (leave imports as-is).
   * Useful for packages that are bundled or have special handling.
   */
  skipPackages?: string[];

  /**
   * Custom URL overrides for specific packages.
   * Takes precedence over CDN registry and fallback.
   */
  overrides?: Record<string, string>;
}

/**
 * Result of rewriting imports.
 */
export interface RewriteImportsResult {
  /** Rewritten source code */
  code: string;

  /** Number of imports rewritten */
  rewrittenCount: number;

  /** Map of original specifiers to CDN URLs */
  rewrites: Map<string, string>;

  /** Packages that were not found in registry and used fallback */
  fallbackPackages: string[];
}

// ============================================
// Default Configuration
// ============================================

const DEFAULT_FALLBACK_CDN = 'https://esm.sh';

// ============================================
// Main Function
// ============================================

/**
 * Rewrite bare import specifiers in source code to esm.sh CDN URLs.
 *
 * - Known packages (in CDN registry) use their registered CDN URL
 * - Unknown packages fall back to `https://esm.sh/${packageName}`
 * - Relative imports (`./`, `../`, `/`) are left untouched
 * - Node built-in imports (`node:*`) are left untouched
 *
 * @param source - Source code with imports to rewrite
 * @param options - Rewrite options
 * @returns Rewrite result with modified code and metadata
 *
 * @example
 * ```typescript
 * const result = rewriteImportsToEsmSh(`
 *   import React from 'react';
 *   import { useState } from 'react';
 *   import { Card } from '@frontmcp/ui/react';
 *   import { helper } from './utils';
 * `);
 *
 * // result.code:
 * // import React from 'https://esm.sh/react@19';
 * // import { useState } from 'https://esm.sh/react@19';
 * // import { Card } from 'https://esm.sh/@frontmcp/ui/react';
 * // import { helper } from './utils';
 * ```
 */
export function rewriteImportsToEsmSh(source: string, options: RewriteImportsOptions = {}): RewriteImportsResult {
  const {
    platform = 'unknown',
    registry,
    fallbackCdnBase = DEFAULT_FALLBACK_CDN,
    skipPackages = [],
    overrides = {},
  } = options;

  const skipSet = new Set(skipPackages);
  const rewrites = new Map<string, string>();
  const fallbackPackages: string[] = [];

  // Parse all imports from the source
  const parsed = parseImports(source);

  // Build a map of specifier → CDN URL for all external imports
  const specifierMap = new Map<string, string>();

  for (const imp of parsed.externalImports) {
    const specifier = imp.specifier;

    // Skip if already resolved
    if (specifierMap.has(specifier)) continue;

    // Skip node built-ins
    if (specifier.startsWith('node:')) continue;

    // Skip excluded packages
    const pkgName = getPackageName(specifier);
    if (skipSet.has(pkgName)) continue;

    // Check overrides first
    if (overrides[specifier]) {
      specifierMap.set(specifier, overrides[specifier]);
      continue;
    }
    if (overrides[pkgName]) {
      // If override is for the package root, append subpath if any
      const subpath = specifier.slice(pkgName.length);
      specifierMap.set(specifier, overrides[pkgName] + subpath);
      continue;
    }

    // Try CDN registry
    const registryUrl = getPackageCDNUrl(pkgName, platform, registry);
    if (registryUrl) {
      // For subpath imports, we need to handle the URL construction
      const subpath = specifier.slice(pkgName.length);
      if (subpath) {
        // Check if the registry URL is an esm.sh URL (allows subpath appending)
        if (registryUrl.includes('esm.sh/')) {
          specifierMap.set(specifier, registryUrl + subpath);
        } else {
          // For non-esm.sh CDN URLs, fall back to esm.sh for subpaths
          specifierMap.set(specifier, `${fallbackCdnBase}/${specifier}`);
          fallbackPackages.push(specifier);
        }
      } else {
        specifierMap.set(specifier, registryUrl);
      }
      continue;
    }

    // Fallback to esm.sh
    specifierMap.set(specifier, `${fallbackCdnBase}/${specifier}`);
    if (!fallbackPackages.includes(pkgName)) {
      fallbackPackages.push(pkgName);
    }
  }

  // Rewrite the source code by replacing specifiers
  let code = source;
  let rewrittenCount = 0;

  for (const [specifier, cdnUrl] of specifierMap) {
    // Match import statements with this specifier
    // Handle both single and double quotes
    const singleQuotePattern = new RegExp(
      `((?:import|export)\\s+(?:[^'"]*\\s+)?from\\s+)'${escapeRegExp(specifier)}'`,
      'g',
    );
    const doubleQuotePattern = new RegExp(
      `((?:import|export)\\s+(?:[^'"]*\\s+)?from\\s+)"${escapeRegExp(specifier)}"`,
      'g',
    );

    // Also handle dynamic imports
    const dynamicSinglePattern = new RegExp(`(import\\s*\\(\\s*)'${escapeRegExp(specifier)}'`, 'g');
    const dynamicDoublePattern = new RegExp(`(import\\s*\\(\\s*)"${escapeRegExp(specifier)}"`, 'g');

    const beforeLength = code.length;

    code = code
      .replace(singleQuotePattern, `$1'${cdnUrl}'`)
      .replace(doubleQuotePattern, `$1"${cdnUrl}"`)
      .replace(dynamicSinglePattern, `$1'${cdnUrl}'`)
      .replace(dynamicDoublePattern, `$1"${cdnUrl}"`);

    if (code.length !== beforeLength || code !== source) {
      rewrites.set(specifier, cdnUrl);
      rewrittenCount++;
    }
  }

  // Recount based on actual rewrites map
  rewrittenCount = rewrites.size;

  return {
    code,
    rewrittenCount,
    rewrites,
    fallbackPackages,
  };
}

// ============================================
// Helpers
// ============================================

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
