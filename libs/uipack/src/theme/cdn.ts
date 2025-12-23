/**
 * @file cdn.ts
 * @description CDN Configuration for FrontMCP UI.
 *
 * Centralized configuration for all CDN resources used by FrontMCP UI.
 * All resources are loaded at runtime - no build step required.
 *
 * For platforms with blocked network (e.g., Claude Artifacts),
 * scripts can be fetched once and cached for inline injection.
 *
 * CDN URLs can be customized via theme configuration for:
 * - Using private CDN mirrors
 * - Self-hosting resources
 * - Compliance with CSP policies
 *
 * @example
 * ```typescript
 * import { buildCdnScriptsFromTheme, DEFAULT_THEME } from '@frontmcp/uipack/theme';
 *
 * // Use default CDN URLs
 * const scripts = buildCdnScripts();
 *
 * // Use theme-configured CDN URLs
 * const themedScripts = buildCdnScriptsFromTheme(DEFAULT_THEME);
 * ```
 *
 * @module @frontmcp/uipack/theme/cdn
 */

import type { ThemeConfig } from './theme';

// ============================================
// CDN URLs
// ============================================

/**
 * CDN resource configuration
 */
export const CDN = {
  /**
   * Tailwind CSS v4 Browser CDN
   * Generates styles on-the-fly with @theme support
   * @see https://tailwindcss.com/docs/installation/play-cdn
   */
  tailwind: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',

  /**
   * HTMX 2.x - High power tools for HTML
   * Enables AJAX, WebSockets, Server Sent Events directly in HTML
   * @see https://htmx.org
   */
  htmx: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.7/htmx.min.js',
    integrity: 'sha512-T6VLg/MJYMbLTmQ8VLvonbWg8VOvmDhXcOvHzCwo6ShdGuUU5SEcp1IAPXL4k9lVoMi8gRXl5K/S/zh43Y9rJA==',
  },

  /**
   * Alpine.js - Lightweight reactive framework
   * Used for more complex client-side interactions
   * @see https://alpinejs.dev
   */
  alpine: {
    url: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js',
    integrity: 'sha384-6zY8MFQJ/EqS1r4RJl+7j8rvZPuBWpT0RzWf+IFcKhxqUzQNmJzA1X1VEVZhYaEz',
  },

  /**
   * Google Fonts - Inter for modern UI typography
   */
  fonts: {
    preconnect: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    mono: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap',
  },

  /**
   * Lucide Icons - Beautiful & consistent icons
   * @see https://lucide.dev
   */
  icons: {
    url: 'https://cdn.jsdelivr.net/npm/lucide@0.294.0/dist/umd/lucide.min.js',
    integrity: 'sha384-wpLmHb7v7V1LsEuTmPQ9tXqWZvTtRWWVqJuE+Yz6X0I6O2T6bHJVeXH1lVWqF4qE',
  },
} as const;

// ============================================
// Script Cache for Offline/Blocked Platforms
// ============================================

/**
 * Cached script content for platforms with blocked network
 * These are populated by fetchAndCacheScripts()
 */
const scriptCache: Map<string, string> = new Map();

/**
 * Fetch a script and cache its content
 */
export async function fetchScript(url: string): Promise<string> {
  const cached = scriptCache.get(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch script: ${url} (${response.status})`);
  }

  const content = await response.text();
  scriptCache.set(url, content);
  return content;
}

/**
 * Fetch and cache all required scripts for offline use
 * Call this at startup to prepare for blocked-network platforms
 */
export async function fetchAndCacheScripts(
  options: {
    tailwind?: boolean;
    htmx?: boolean;
    alpine?: boolean;
    icons?: boolean;
  } = {},
): Promise<Map<string, string>> {
  const { tailwind = true, htmx = true, alpine = false, icons = false } = options;
  const urls: string[] = [];

  if (tailwind) urls.push(CDN.tailwind);
  if (htmx) urls.push(CDN.htmx.url);
  if (alpine) urls.push(CDN.alpine.url);
  if (icons) urls.push(CDN.icons.url);

  await Promise.all(urls.map(fetchScript));
  return scriptCache;
}

/**
 * Get cached script content
 */
export function getCachedScript(url: string): string | undefined {
  return scriptCache.get(url);
}

/**
 * Check if a script is cached
 */
export function isScriptCached(url: string): boolean {
  return scriptCache.has(url);
}

/**
 * Clear the script cache
 */
export function clearScriptCache(): void {
  scriptCache.clear();
}

// ============================================
// CDN Builder Utilities
// ============================================

/**
 * Options for building CDN script tags
 */
export interface CdnScriptOptions {
  /** Include Tailwind CSS (default: true) */
  tailwind?: boolean;
  /** Include HTMX (default: true) */
  htmx?: boolean;
  /** Include Alpine.js (default: false) */
  alpine?: boolean;
  /** Include Lucide icons (default: false) */
  icons?: boolean;
  /** Include Inter font (default: true) */
  interFont?: boolean;
  /** Include JetBrains Mono font (default: false) */
  monoFont?: boolean;
  /** Use inline scripts from cache (for blocked network) */
  inline?: boolean;
}

/**
 * Build font preconnect links
 */
export function buildFontPreconnect(): string {
  return CDN.fonts.preconnect
    .map((url, i) => `<link rel="preconnect" href="${url}"${i > 0 ? ' crossorigin' : ''}>`)
    .join('\n  ');
}

/**
 * Build font stylesheet links
 */
export function buildFontStylesheets(options: { inter?: boolean; mono?: boolean } = {}): string {
  const { inter = true, mono = false } = options;
  const links: string[] = [];

  if (inter) {
    links.push(`<link href="${CDN.fonts.inter}" rel="stylesheet">`);
  }
  if (mono) {
    links.push(`<link href="${CDN.fonts.mono}" rel="stylesheet">`);
  }

  return links.join('\n  ');
}

/**
 * Build script tag with optional integrity
 */
function buildScriptTag(url: string, integrity?: string, options: { defer?: boolean; async?: boolean } = {}): string {
  const attrs: string[] = [`src="${url}"`];

  if (integrity) {
    attrs.push(`integrity="${integrity}"`);
    attrs.push('crossorigin="anonymous"');
  }
  if (options.defer) attrs.push('defer');
  if (options.async) attrs.push('async');

  return `<script ${attrs.join(' ')}></script>`;
}

/**
 * Build inline script tag from cached content
 */
function buildInlineScriptTag(content: string): string {
  return `<script>${content}</script>`;
}

/**
 * Build all CDN script tags based on options
 *
 * @remarks
 * When `inline: true` is specified, scripts must be pre-cached via `fetchAndCacheScripts()`.
 * Uncached scripts will be silently skipped with a console warning.
 */
export function buildCdnScripts(options: CdnScriptOptions = {}): string {
  const { tailwind = true, htmx = true, alpine = false, icons = false, inline = false } = options;

  const scripts: string[] = [];

  if (inline) {
    // Use cached inline scripts - warn if not cached
    if (tailwind) {
      const cached = getCachedScript(CDN.tailwind);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but Tailwind script not cached. Call fetchAndCacheScripts() first.',
        );
      }
    }
    if (htmx) {
      const cached = getCachedScript(CDN.htmx.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but HTMX script not cached. Call fetchAndCacheScripts() first.',
        );
      }
    }
    if (alpine) {
      const cached = getCachedScript(CDN.alpine.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but Alpine.js script not cached. Call fetchAndCacheScripts() first.',
        );
      }
    }
    if (icons) {
      const cached = getCachedScript(CDN.icons.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but Lucide icons script not cached. Call fetchAndCacheScripts() first.',
        );
      }
    }
  } else {
    // Use CDN URLs
    if (tailwind) {
      scripts.push(buildScriptTag(CDN.tailwind));
    }
    if (htmx) {
      scripts.push(buildScriptTag(CDN.htmx.url, CDN.htmx.integrity));
    }
    if (alpine) {
      scripts.push(buildScriptTag(CDN.alpine.url, CDN.alpine.integrity, { defer: true }));
    }
    if (icons) {
      scripts.push(buildScriptTag(CDN.icons.url, CDN.icons.integrity));
    }
  }

  return scripts.join('\n  ');
}

// ============================================
// Theme-Aware CDN Builders
// ============================================

/**
 * Options for theme-aware CDN script building
 */
export interface ThemeCdnScriptOptions {
  /** Include Tailwind CSS (default: true) */
  tailwind?: boolean;
  /** Include HTMX (default: true) */
  htmx?: boolean;
  /** Include Alpine.js (default: false) */
  alpine?: boolean;
  /** Include icon library (default: false) */
  icons?: boolean;
  /** Use inline scripts from cache (for blocked network) */
  inline?: boolean;
}

/**
 * Build font preconnect links from theme CDN configuration
 *
 * @param theme - Theme configuration with CDN settings
 * @returns HTML preconnect link tags
 */
export function buildFontPreconnectFromTheme(theme: ThemeConfig): string {
  const preconnect = theme.cdn?.fonts?.preconnect ?? CDN.fonts.preconnect;
  return preconnect.map((url, i) => `<link rel="preconnect" href="${url}"${i > 0 ? ' crossorigin' : ''}>`).join('\n  ');
}

/**
 * Build font stylesheet links from theme CDN configuration
 *
 * @param theme - Theme configuration with CDN settings
 * @returns HTML stylesheet link tags
 */
export function buildFontStylesheetsFromTheme(theme: ThemeConfig): string {
  const stylesheets = theme.cdn?.fonts?.stylesheets ?? [CDN.fonts.inter];
  return stylesheets.map((url) => `<link href="${url}" rel="stylesheet">`).join('\n  ');
}

/**
 * Build all CDN script tags from theme configuration
 *
 * Uses theme.cdn configuration if available, falls back to global CDN defaults.
 *
 * @remarks
 * When `inline: true` is specified, scripts must be pre-cached via `fetchAndCacheScriptsFromTheme()`.
 * Uncached scripts will be silently skipped with a console warning.
 *
 * @param theme - Theme configuration with CDN settings
 * @param options - Script inclusion options
 * @returns HTML script tags
 */
export function buildCdnScriptsFromTheme(theme: ThemeConfig, options: ThemeCdnScriptOptions = {}): string {
  const { tailwind = true, htmx = true, alpine = false, icons = false, inline = false } = options;

  const scripts: string[] = [];

  // Get URLs from theme or fallback to defaults
  const tailwindUrl = theme.cdn?.scripts?.tailwind ?? CDN.tailwind;
  const htmxConfig = theme.cdn?.scripts?.htmx ?? CDN.htmx;
  const alpineConfig = theme.cdn?.scripts?.alpine ?? CDN.alpine;
  const iconsConfig = theme.cdn?.icons?.script ?? CDN.icons;

  if (inline) {
    // Use cached inline scripts - warn if not cached
    if (tailwind) {
      const cached = getCachedScript(tailwindUrl);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but Tailwind script not cached. Call fetchAndCacheScriptsFromTheme() first.',
        );
      }
    }
    if (htmx) {
      const cached = getCachedScript(htmxConfig.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but HTMX script not cached. Call fetchAndCacheScriptsFromTheme() first.',
        );
      }
    }
    if (alpine) {
      const cached = getCachedScript(alpineConfig.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but Alpine.js script not cached. Call fetchAndCacheScriptsFromTheme() first.',
        );
      }
    }
    if (icons) {
      const cached = getCachedScript(iconsConfig.url);
      if (cached) {
        scripts.push(buildInlineScriptTag(cached));
      } else {
        console.warn(
          '[frontmcp/ui] Inline mode requested but icons script not cached. Call fetchAndCacheScriptsFromTheme() first.',
        );
      }
    }
  } else {
    // Use CDN URLs from theme
    if (tailwind) {
      scripts.push(buildScriptTag(tailwindUrl));
    }
    if (htmx) {
      scripts.push(buildScriptTag(htmxConfig.url, htmxConfig.integrity));
    }
    if (alpine) {
      scripts.push(buildScriptTag(alpineConfig.url, alpineConfig.integrity, { defer: true }));
    }
    if (icons) {
      scripts.push(buildScriptTag(iconsConfig.url, iconsConfig.integrity));
    }
  }

  return scripts.join('\n  ');
}

/**
 * Fetch and cache scripts based on theme CDN configuration
 *
 * @param theme - Theme configuration with CDN settings
 * @param options - Which scripts to cache
 * @returns Map of cached script URLs to content
 */
export async function fetchAndCacheScriptsFromTheme(
  theme: ThemeConfig,
  options: {
    tailwind?: boolean;
    htmx?: boolean;
    alpine?: boolean;
    icons?: boolean;
  } = {},
): Promise<Map<string, string>> {
  const { tailwind = true, htmx = true, alpine = false, icons = false } = options;
  const urls: string[] = [];

  // Get URLs from theme or fallback to defaults
  const tailwindUrl = theme.cdn?.scripts?.tailwind ?? CDN.tailwind;
  const htmxConfig = theme.cdn?.scripts?.htmx ?? CDN.htmx;
  const alpineConfig = theme.cdn?.scripts?.alpine ?? CDN.alpine;
  const iconsConfig = theme.cdn?.icons?.script ?? CDN.icons;

  if (tailwind) urls.push(tailwindUrl);
  if (htmx) urls.push(htmxConfig.url);
  if (alpine) urls.push(alpineConfig.url);
  if (icons) urls.push(iconsConfig.url);

  await Promise.all(urls.map(fetchScript));
  return scriptCache;
}
