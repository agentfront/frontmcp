/**
 * CDN Info Builder
 *
 * Returns CDN dependency info for a given UI type.
 *
 * @packageDocumentation
 */

import type { UIType } from '../types/ui-runtime';

/**
 * CDN info for a UI type, describing base CDN and required dependencies.
 */
export interface CDNInfo {
  /** Base CDN URL */
  base: string;
  /** Dependencies required for this UI type */
  dependencies: CDNDependencyInfo[];
}

/**
 * Individual CDN dependency.
 */
export interface CDNDependencyInfo {
  /** Package name */
  name: string;
  /** CDN URL */
  url: string;
}

const ESM_SH_BASE = 'https://esm.sh';

const REACT_DEPS: CDNDependencyInfo[] = [
  { name: 'react', url: `${ESM_SH_BASE}/react@18` },
  { name: 'react-dom', url: `${ESM_SH_BASE}/react-dom@18` },
];

/**
 * Build CDN info for a given UI type.
 *
 * @param uiType - The UI type to get CDN info for
 * @returns CDN info object with base URL and dependencies
 */
export function buildCDNInfoForUIType(uiType: UIType | string): CDNInfo {
  const deps: CDNDependencyInfo[] = [];

  switch (uiType) {
    case 'react':
      deps.push(...REACT_DEPS);
      break;
    case 'mdx':
      deps.push(...REACT_DEPS);
      deps.push({ name: 'marked', url: `${ESM_SH_BASE}/marked@latest` });
      break;
    case 'markdown':
      deps.push({ name: 'marked', url: `${ESM_SH_BASE}/marked@latest` });
      break;
    case 'auto':
      deps.push(...REACT_DEPS);
      deps.push({ name: 'marked', url: `${ESM_SH_BASE}/marked@latest` });
      break;
    case 'html':
    default:
      // HTML type needs no CDN dependencies
      break;
  }

  return {
    base: ESM_SH_BASE,
    dependencies: deps,
  };
}
