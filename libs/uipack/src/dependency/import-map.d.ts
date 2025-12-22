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
export declare function createImportMap(dependencies: ResolvedDependency[]): ImportMap;
/**
 * Create an import map from explicit dependency overrides.
 *
 * @param dependencies - Map of package names to CDN configurations
 * @returns Browser import map
 */
export declare function createImportMapFromOverrides(dependencies: Record<string, CDNDependency>): ImportMap;
/**
 * Merge multiple import maps into one.
 *
 * Later maps override earlier ones for conflicting keys.
 *
 * @param maps - Import maps to merge
 * @returns Merged import map
 */
export declare function mergeImportMaps(...maps: ImportMap[]): ImportMap;
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
export declare function addScope(map: ImportMap, scopeUrl: string, mappings: Record<string, string>): ImportMap;
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
export declare function generateImportMapScriptTag(map: ImportMap): string;
/**
 * Generate a minified import map script tag.
 *
 * @param map - Import map to serialize
 * @returns Minified HTML script tag string
 */
export declare function generateImportMapScriptTagMinified(map: ImportMap): string;
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
export declare function generateUMDShim(dependencies: ResolvedDependency[], options?: UMDShimOptions): string;
/**
 * Generate CDN script tags for non-ESM dependencies.
 *
 * @param dependencies - Resolved dependencies
 * @returns Array of HTML script tag strings
 */
export declare function generateCDNScriptTags(dependencies: ResolvedDependency[]): string[];
/**
 * Generate ES module script tags for ESM dependencies.
 *
 * @param dependencies - Resolved dependencies
 * @returns Array of HTML script tag strings
 */
export declare function generateESMScriptTags(dependencies: ResolvedDependency[]): string[];
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
export declare function generateDependencyHTML(
  dependencies: ResolvedDependency[],
  options?: DependencyHTMLOptions,
): string;
/**
 * Validate an import map structure.
 *
 * @param map - Import map to validate
 * @returns Validation result with any errors
 */
export declare function validateImportMap(map: unknown): {
  valid: boolean;
  errors: string[];
};
//# sourceMappingURL=import-map.d.ts.map
