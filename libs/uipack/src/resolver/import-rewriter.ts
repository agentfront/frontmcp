/**
 * Import Rewriter
 *
 * Rewrites bare import specifiers in source code using a pluggable ImportResolver.
 *
 * @packageDocumentation
 */

import type { ResolverOptions, RewriteImportsResult } from './types';
import { parseImports, getPackageName } from './import-parser';
import { createEsmShResolver } from './esm-sh.resolver';

/**
 * Rewrite bare import specifiers in source code using the provided resolver.
 *
 * - Known packages are resolved via the resolver
 * - Relative imports are left untouched
 * - Node built-in imports are left untouched
 *
 * @example
 * ```typescript
 * const result = rewriteImports(`
 *   import React from 'react';
 *   import { helper } from './utils';
 * `, { resolver: createEsmShResolver() });
 *
 * // result.code:
 * // import React from 'https://esm.sh/react@18.3.1';
 * // import { helper } from './utils';
 * ```
 */
export function rewriteImports(source: string, options: ResolverOptions = {}): RewriteImportsResult {
  const { resolver = createEsmShResolver(), skipPackages = [], overrides = {} } = options;

  const skipSet = new Set(skipPackages);
  const rewrites = new Map<string, string>();
  const fallbackPackages: string[] = [];

  const parsed = parseImports(source);

  // Build specifier → URL map
  const specifierMap = new Map<string, string>();

  for (const imp of parsed.externalImports) {
    const specifier = imp.specifier;
    if (specifierMap.has(specifier)) continue;
    if (specifier.startsWith('node:')) continue;

    const pkgName = getPackageName(specifier);
    if (skipSet.has(pkgName)) continue;

    // Check overrides first
    if (overrides[specifier]) {
      specifierMap.set(specifier, overrides[specifier]);
      continue;
    }
    if (overrides[pkgName]) {
      const subpath = specifier.slice(pkgName.length);
      specifierMap.set(specifier, overrides[pkgName] + subpath);
      continue;
    }

    // Use resolver
    const resolved = resolver.resolve(specifier);
    if (resolved && resolved.type === 'url') {
      specifierMap.set(specifier, resolved.value);
    }
  }

  // Rewrite source
  let code = source;

  for (const [specifier, cdnUrl] of specifierMap) {
    const escaped = escapeRegExp(specifier);
    const singleQuotePattern = new RegExp(`((?:import|export)\\s+(?:[^'"]*\\s+)?from\\s+)'${escaped}'`, 'g');
    const doubleQuotePattern = new RegExp(`((?:import|export)\\s+(?:[^'"]*\\s+)?from\\s+)"${escaped}"`, 'g');
    const dynamicSinglePattern = new RegExp(`(import\\s*\\(\\s*)'${escaped}'`, 'g');
    const dynamicDoublePattern = new RegExp(`(import\\s*\\(\\s*)"${escaped}"`, 'g');
    const sideEffectSinglePattern = new RegExp(`(import\\s+)'${escaped}'`, 'g');
    const sideEffectDoublePattern = new RegExp(`(import\\s+)"${escaped}"`, 'g');

    const beforeLength = code.length;

    code = code
      .replace(singleQuotePattern, `$1'${cdnUrl}'`)
      .replace(doubleQuotePattern, `$1"${cdnUrl}"`)
      .replace(dynamicSinglePattern, `$1'${cdnUrl}'`)
      .replace(dynamicDoublePattern, `$1"${cdnUrl}"`)
      .replace(sideEffectSinglePattern, `$1'${cdnUrl}'`)
      .replace(sideEffectDoublePattern, `$1"${cdnUrl}"`);

    if (code.length !== beforeLength || code !== source) {
      rewrites.set(specifier, cdnUrl);
    }
  }

  return {
    code,
    rewrittenCount: rewrites.size,
    rewrites,
    fallbackPackages,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
