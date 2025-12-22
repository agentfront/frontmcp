/**
 * Import Map Generator
 *
 * Generates browser-compatible import maps for CDN dependencies.
 * Handles integrity hashes, scopes, and HTML script tag generation.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap
 *
 * @packageDocumentation
 */

import type { ImportMap, ResolvedDependency, CDNDependency } from './types';
import { escapeHtmlAttr } from '../utils';

// ============================================
// Import Map Generation
// ============================================

/**
 * Create an import map from resolved dependencies.
 *
 * @param dependencies - Resolved CDN dependencies
 * @returns Browser import map
 *
 * @example
 * ```typescript
 * const deps: ResolvedDependency[] = [
 *   { packageName: 'react', cdnUrl: 'https://...', ... },
 *   { packageName: 'chart.js', cdnUrl: 'https://...', integrity: 'sha384-...', ... },
 * ];
 *
 * const map = createImportMap(deps);
 * // {
 * //   imports: { 'react': 'https://...', 'chart.js': 'https://...' },
 * //   integrity: { 'https://...': 'sha384-...' }
 * // }
 * ```
 */
export function createImportMap(dependencies: ResolvedDependency[]): ImportMap {
  const imports: Record<string, string> = {};
  const integrity: Record<string, string> = {};

  for (const dep of dependencies) {
    imports[dep.packageName] = dep.cdnUrl;

    if (dep.integrity) {
      integrity[dep.cdnUrl] = dep.integrity;
    }
  }

  return {
    imports,
    integrity: Object.keys(integrity).length > 0 ? integrity : undefined,
  };
}

/**
 * Create an import map from explicit dependency overrides.
 *
 * @param dependencies - Map of package names to CDN configurations
 * @returns Browser import map
 */
export function createImportMapFromOverrides(dependencies: Record<string, CDNDependency>): ImportMap {
  const imports: Record<string, string> = {};
  const integrity: Record<string, string> = {};

  for (const [pkgName, config] of Object.entries(dependencies)) {
    imports[pkgName] = config.url;

    if (config.integrity) {
      integrity[config.url] = config.integrity;
    }
  }

  return {
    imports,
    integrity: Object.keys(integrity).length > 0 ? integrity : undefined,
  };
}

/**
 * Merge multiple import maps into one.
 *
 * Later maps override earlier ones for conflicting keys.
 *
 * @param maps - Import maps to merge
 * @returns Merged import map
 */
export function mergeImportMaps(...maps: ImportMap[]): ImportMap {
  const imports: Record<string, string> = {};
  const integrity: Record<string, string> = {};
  const scopes: Record<string, Record<string, string>> = {};

  for (const map of maps) {
    Object.assign(imports, map.imports);

    if (map.integrity) {
      Object.assign(integrity, map.integrity);
    }

    if (map.scopes) {
      for (const [scope, mappings] of Object.entries(map.scopes)) {
        scopes[scope] = { ...scopes[scope], ...mappings };
      }
    }
  }

  return {
    imports,
    integrity: Object.keys(integrity).length > 0 ? integrity : undefined,
    scopes: Object.keys(scopes).length > 0 ? scopes : undefined,
  };
}

/**
 * Add a scope to an import map.
 *
 * Scopes allow different resolutions for specific URL prefixes.
 *
 * @param map - Base import map
 * @param scopeUrl - URL prefix for the scope
 * @param mappings - Module mappings for this scope
 * @returns Updated import map
 */
export function addScope(map: ImportMap, scopeUrl: string, mappings: Record<string, string>): ImportMap {
  return {
    ...map,
    scopes: {
      ...map.scopes,
      [scopeUrl]: { ...(map.scopes?.[scopeUrl] ?? {}), ...mappings },
    },
  };
}

// ============================================
// HTML Generation
// ============================================

/**
 * Generate an HTML script tag for an import map.
 *
 * @param map - Import map to serialize
 * @returns HTML script tag string
 *
 * @example
 * ```typescript
 * const map = createImportMap(dependencies);
 * const html = generateImportMapScriptTag(map);
 * // <script type="importmap">
 * // { "imports": { ... } }
 * // </script>
 * ```
 */
export function generateImportMapScriptTag(map: ImportMap): string {
  // Escape </ sequences to prevent script tag injection (XSS)
  const json = JSON.stringify(map, null, 2).replace(/<\//g, '<\\/');
  return `<script type="importmap">\n${json}\n</script>`;
}

/**
 * Generate a minified import map script tag.
 *
 * @param map - Import map to serialize
 * @returns Minified HTML script tag string
 */
export function generateImportMapScriptTagMinified(map: ImportMap): string {
  // Escape </ sequences to prevent script tag injection (XSS)
  const json = JSON.stringify(map).replace(/<\//g, '<\\/');
  return `<script type="importmap">${json}</script>`;
}

/**
 * Options for generating UMD shim script.
 */
export interface UMDShimOptions {
  /**
   * Whether to include a try/catch wrapper.
   * @default true
   */
  safe?: boolean;

  /**
   * Whether to minify the output.
   * @default false
   */
  minify?: boolean;
}

/**
 * Generate a UMD shim script for global->ESM bridging.
 *
 * This creates a script that exposes UMD globals to ES module imports.
 *
 * @param dependencies - Resolved dependencies with global names
 * @param options - Generation options
 * @returns JavaScript shim code
 *
 * @example
 * ```typescript
 * const deps = [
 *   { packageName: 'react', global: 'React', ... },
 *   { packageName: 'chart.js', global: 'Chart', ... },
 * ];
 *
 * const shim = generateUMDShim(deps);
 * // window.__esm_shim = {
 * //   'react': { default: window.React, ...window.React },
 * //   'chart.js': { default: window.Chart, ...window.Chart },
 * // };
 * ```
 */
export function generateUMDShim(dependencies: ResolvedDependency[], options: UMDShimOptions = {}): string {
  const { safe = true, minify = false } = options;

  const depsWithGlobals = dependencies.filter((d) => d.global && !d.esm);

  if (depsWithGlobals.length === 0) {
    return '';
  }

  const entries = depsWithGlobals.map((dep) => {
    const global = dep.global!;
    return `'${dep.packageName}': { default: window.${global}, ...window.${global} }`;
  });

  const shimObject = `{\n  ${entries.join(',\n  ')}\n}`;

  const code = safe
    ? `(function() {
  try {
    window.__esm_shim = ${shimObject};
  } catch (e) {
    console.warn('UMD shim failed:', e);
  }
})();`
    : `window.__esm_shim = ${shimObject};`;

  return minify ? code.replace(/\s+/g, ' ').replace(/\s*([{},:])\s*/g, '$1') : code;
}

/**
 * Generate CDN script tags for non-ESM dependencies.
 *
 * @param dependencies - Resolved dependencies
 * @returns Array of HTML script tag strings
 */
export function generateCDNScriptTags(dependencies: ResolvedDependency[]): string[] {
  return dependencies
    .filter((dep) => !dep.esm)
    .map((dep) => {
      const attrs: string[] = [`src="${escapeHtmlAttr(dep.cdnUrl)}"`];

      if (dep.integrity) {
        attrs.push(`integrity="${escapeHtmlAttr(dep.integrity)}"`);
      }

      attrs.push('crossorigin="anonymous"');

      return `<script ${attrs.join(' ')}></script>`;
    });
}

/**
 * Generate ES module script tags for ESM dependencies.
 *
 * @param dependencies - Resolved dependencies
 * @returns Array of HTML script tag strings
 */
export function generateESMScriptTags(dependencies: ResolvedDependency[]): string[] {
  return dependencies
    .filter((dep) => dep.esm)
    .map((dep) => {
      const attrs: string[] = ['type="module"', `src="${escapeHtmlAttr(dep.cdnUrl)}"`];

      if (dep.integrity) {
        attrs.push(`integrity="${escapeHtmlAttr(dep.integrity)}"`);
      }

      attrs.push('crossorigin="anonymous"');

      return `<script ${attrs.join(' ')}></script>`;
    });
}

/**
 * Options for generating the complete dependency loading HTML.
 */
export interface DependencyHTMLOptions {
  /**
   * Whether to use minified output.
   * @default false
   */
  minify?: boolean;

  /**
   * Whether to include UMD shim for global->ESM bridging.
   * @default true
   */
  includeShim?: boolean;

  /**
   * Whether to defer script loading.
   * @default false
   */
  defer?: boolean;
}

/**
 * Generate complete HTML for loading dependencies.
 *
 * Includes import map, CDN scripts, and UMD shim.
 *
 * @param dependencies - Resolved dependencies
 * @param options - Generation options
 * @returns Complete HTML string
 *
 * @example
 * ```typescript
 * const html = generateDependencyHTML(dependencies, { minify: true });
 * // Includes:
 * // 1. Import map script
 * // 2. UMD script tags (for non-ESM deps)
 * // 3. UMD shim script
 * // 4. ESM script tags
 * ```
 */
export function generateDependencyHTML(
  dependencies: ResolvedDependency[],
  options: DependencyHTMLOptions = {},
): string {
  const { minify = false, includeShim = true } = options;

  const parts: string[] = [];

  // 1. Import map (for ESM resolution)
  const importMap = createImportMap(dependencies);
  const importMapTag = minify ? generateImportMapScriptTagMinified(importMap) : generateImportMapScriptTag(importMap);
  parts.push(importMapTag);

  // 2. UMD script tags (load first)
  const umdTags = generateCDNScriptTags(dependencies);
  parts.push(...umdTags);

  // 3. UMD shim (after UMD scripts load)
  if (includeShim) {
    const shim = generateUMDShim(dependencies, { minify });
    if (shim) {
      parts.push(`<script>${shim}</script>`);
    }
  }

  // 4. ESM script tags
  const esmTags = generateESMScriptTags(dependencies);
  parts.push(...esmTags);

  return parts.join(minify ? '' : '\n');
}

// ============================================
// Validation
// ============================================

/**
 * Validate an import map structure.
 *
 * @param map - Import map to validate
 * @returns Validation result with any errors
 */
export function validateImportMap(map: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof map !== 'object' || map === null) {
    return { valid: false, errors: ['Import map must be an object'] };
  }

  const obj = map as Record<string, unknown>;

  // Check imports
  if (!obj['imports']) {
    errors.push('Import map must have an "imports" field');
  } else if (typeof obj['imports'] !== 'object' || obj['imports'] === null) {
    errors.push('"imports" must be an object');
  } else {
    const imports = obj['imports'] as Record<string, unknown>;
    for (const [key, value] of Object.entries(imports)) {
      if (typeof value !== 'string') {
        errors.push(`Import "${key}" must map to a string URL`);
      } else if (!value.startsWith('https://')) {
        errors.push(`Import "${key}" URL must use HTTPS: ${value}`);
      }
    }
  }

  // Check integrity (optional)
  if (obj['integrity'] !== undefined) {
    if (typeof obj['integrity'] !== 'object' || obj['integrity'] === null) {
      errors.push('"integrity" must be an object');
    } else {
      const integrity = obj['integrity'] as Record<string, unknown>;
      for (const [url, hash] of Object.entries(integrity)) {
        if (typeof hash !== 'string') {
          errors.push(`Integrity for "${url}" must be a string`);
        } else if (!hash.match(/^sha(256|384|512)-/)) {
          errors.push(`Invalid integrity hash format for "${url}": ${hash}`);
        }
      }
    }
  }

  // Check scopes (optional)
  if (obj['scopes'] !== undefined) {
    if (typeof obj['scopes'] !== 'object' || obj['scopes'] === null) {
      errors.push('"scopes" must be an object');
    }
  }

  return { valid: errors.length === 0, errors };
}
