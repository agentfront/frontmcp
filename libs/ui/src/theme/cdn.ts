/**
 * CDN Configuration
 *
 * Centralized configuration for all CDN resources used by FrontMCP UI.
 * All resources are loaded at runtime - no build step required.
 *
 * For platforms with blocked network (e.g., Claude Artifacts),
 * scripts can be fetched once and cached for inline injection.
 */

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
  if (scriptCache.has(url)) {
    return scriptCache.get(url)!;
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
 */
export function buildCdnScripts(options: CdnScriptOptions = {}): string {
  const { tailwind = true, htmx = true, alpine = false, icons = false, inline = false } = options;

  const scripts: string[] = [];

  if (inline) {
    // Use cached inline scripts
    if (tailwind && isScriptCached(CDN.tailwind)) {
      scripts.push(buildInlineScriptTag(getCachedScript(CDN.tailwind)!));
    }
    if (htmx && isScriptCached(CDN.htmx.url)) {
      scripts.push(buildInlineScriptTag(getCachedScript(CDN.htmx.url)!));
    }
    if (alpine && isScriptCached(CDN.alpine.url)) {
      scripts.push(buildInlineScriptTag(getCachedScript(CDN.alpine.url)!));
    }
    if (icons && isScriptCached(CDN.icons.url)) {
      scripts.push(buildInlineScriptTag(getCachedScript(CDN.icons.url)!));
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
      scripts.push(buildScriptTag(CDN.icons.url));
    }
  }

  return scripts.join('\n  ');
}
