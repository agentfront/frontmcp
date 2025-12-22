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
 * import { buildCdnScriptsFromTheme, DEFAULT_THEME } from '@frontmcp/ui';
 *
 * // Use default CDN URLs
 * const scripts = buildCdnScripts();
 *
 * // Use theme-configured CDN URLs
 * const themedScripts = buildCdnScriptsFromTheme(DEFAULT_THEME);
 * ```
 *
 * @module @frontmcp/ui/theme/cdn
 */
import type { ThemeConfig } from './theme';
/**
 * CDN resource configuration
 */
export declare const CDN: {
  /**
   * Tailwind CSS v4 Browser CDN
   * Generates styles on-the-fly with @theme support
   * @see https://tailwindcss.com/docs/installation/play-cdn
   */
  readonly tailwind: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';
  /**
   * HTMX 2.x - High power tools for HTML
   * Enables AJAX, WebSockets, Server Sent Events directly in HTML
   * @see https://htmx.org
   */
  readonly htmx: {
    readonly url: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.7/htmx.min.js';
    readonly integrity: 'sha512-T6VLg/MJYMbLTmQ8VLvonbWg8VOvmDhXcOvHzCwo6ShdGuUU5SEcp1IAPXL4k9lVoMi8gRXl5K/S/zh43Y9rJA==';
  };
  /**
   * Alpine.js - Lightweight reactive framework
   * Used for more complex client-side interactions
   * @see https://alpinejs.dev
   */
  readonly alpine: {
    readonly url: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js';
    readonly integrity: 'sha384-6zY8MFQJ/EqS1r4RJl+7j8rvZPuBWpT0RzWf+IFcKhxqUzQNmJzA1X1VEVZhYaEz';
  };
  /**
   * Google Fonts - Inter for modern UI typography
   */
  readonly fonts: {
    readonly preconnect: readonly ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
    readonly inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    readonly mono: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap';
  };
  /**
   * Lucide Icons - Beautiful & consistent icons
   * @see https://lucide.dev
   */
  readonly icons: {
    readonly url: 'https://cdn.jsdelivr.net/npm/lucide@0.294.0/dist/umd/lucide.min.js';
    readonly integrity: 'sha384-wpLmHb7v7V1LsEuTmPQ9tXqWZvTtRWWVqJuE+Yz6X0I6O2T6bHJVeXH1lVWqF4qE';
  };
};
/**
 * Fetch a script and cache its content
 */
export declare function fetchScript(url: string): Promise<string>;
/**
 * Fetch and cache all required scripts for offline use
 * Call this at startup to prepare for blocked-network platforms
 */
export declare function fetchAndCacheScripts(options?: {
  tailwind?: boolean;
  htmx?: boolean;
  alpine?: boolean;
  icons?: boolean;
}): Promise<Map<string, string>>;
/**
 * Get cached script content
 */
export declare function getCachedScript(url: string): string | undefined;
/**
 * Check if a script is cached
 */
export declare function isScriptCached(url: string): boolean;
/**
 * Clear the script cache
 */
export declare function clearScriptCache(): void;
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
export declare function buildFontPreconnect(): string;
/**
 * Build font stylesheet links
 */
export declare function buildFontStylesheets(options?: { inter?: boolean; mono?: boolean }): string;
/**
 * Build all CDN script tags based on options
 *
 * @remarks
 * When `inline: true` is specified, scripts must be pre-cached via `fetchAndCacheScripts()`.
 * Uncached scripts will be silently skipped with a console warning.
 */
export declare function buildCdnScripts(options?: CdnScriptOptions): string;
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
export declare function buildFontPreconnectFromTheme(theme: ThemeConfig): string;
/**
 * Build font stylesheet links from theme CDN configuration
 *
 * @param theme - Theme configuration with CDN settings
 * @returns HTML stylesheet link tags
 */
export declare function buildFontStylesheetsFromTheme(theme: ThemeConfig): string;
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
export declare function buildCdnScriptsFromTheme(theme: ThemeConfig, options?: ThemeCdnScriptOptions): string;
/**
 * Fetch and cache scripts based on theme CDN configuration
 *
 * @param theme - Theme configuration with CDN settings
 * @param options - Which scripts to cache
 * @returns Map of cached script URLs to content
 */
export declare function fetchAndCacheScriptsFromTheme(
  theme: ThemeConfig,
  options?: {
    tailwind?: boolean;
    htmx?: boolean;
    alpine?: boolean;
    icons?: boolean;
  },
): Promise<Map<string, string>>;
//# sourceMappingURL=cdn.d.ts.map
