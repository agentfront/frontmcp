/**
 * Import Map Generator
 *
 * Generates browser-compatible import maps from resolved imports.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap
 * @packageDocumentation
 */

import type { ImportMap, ResolvedImport, ResolvedDependency } from './types';
import { escapeHtmlAttr } from '../utils';

/**
 * Create an import map from a record of specifier → ResolvedImport.
 */
export function createImportMapFromResolved(resolved: Record<string, ResolvedImport>): ImportMap {
  const imports: Record<string, string> = {};
  const integrity: Record<string, string> = {};

  for (const [specifier, res] of Object.entries(resolved)) {
    if (res.type === 'url') {
      imports[specifier] = res.value;
      if (res.integrity) {
        integrity[res.value] = res.integrity;
      }
    }
  }

  return {
    imports,
    integrity: Object.keys(integrity).length > 0 ? integrity : undefined,
  };
}

/**
 * Create an import map from resolved dependencies.
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
 * Merge multiple import maps into one.
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
 * Generate an HTML script tag for an import map.
 */
export function generateImportMapScriptTag(map: ImportMap): string {
  const json = JSON.stringify(map, null, 2).replace(/<\//g, '<\\/');
  return `<script type="importmap">\n${json}\n</script>`;
}

/**
 * Generate a minified import map script tag.
 */
export function generateImportMapScriptTagMinified(map: ImportMap): string {
  const json = JSON.stringify(map).replace(/<\//g, '<\\/');
  return `<script type="importmap">${json}</script>`;
}

/**
 * Generate CDN script tags for non-ESM dependencies.
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
 * Generate complete HTML for loading dependencies.
 */
export function generateDependencyHTML(dependencies: ResolvedDependency[], options: { minify?: boolean } = {}): string {
  const { minify = false } = options;
  const parts: string[] = [];

  const importMap = createImportMap(dependencies);
  const importMapTag = minify ? generateImportMapScriptTagMinified(importMap) : generateImportMapScriptTag(importMap);
  parts.push(importMapTag);

  const umdTags = generateCDNScriptTags(dependencies);
  parts.push(...umdTags);

  return parts.join(minify ? '' : '\n');
}

/**
 * Validate an import map structure.
 */
export function validateImportMap(map: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof map !== 'object' || map === null) {
    return { valid: false, errors: ['Import map must be an object'] };
  }

  const obj = map as Record<string, unknown>;

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

  return { valid: errors.length === 0, errors };
}
