/**
 * CDN Resource URLs
 *
 * Default CDN URLs for runtime dependencies (React, MDX, Handlebars, etc).
 * These URLs are used when resourceMode is 'cdn' (default).
 *
 * @packageDocumentation
 */

import type { CDNResource, UIType, RendererAssets, ResourceMode } from '../types';

// ============================================
// CDN URL Constants
// ============================================

/**
 * React 19 from esm.sh (ES module).
 *
 * React 19 removed UMD builds, so we use esm.sh which provides
 * ES module builds that work in modern browsers.
 */
export const REACT_CDN: CDNResource = {
  url: 'https://esm.sh/react@19',
  crossorigin: 'anonymous',
};

/**
 * ReactDOM 19 client from esm.sh (ES module).
 *
 * React 19 removed UMD builds, so we use esm.sh which provides
 * ES module builds that work in modern browsers.
 */
export const REACT_DOM_CDN: CDNResource = {
  url: 'https://esm.sh/react-dom@19/client',
  crossorigin: 'anonymous',
};

/**
 * Marked markdown parser from unpkg.
 */
export const MARKED_CDN: CDNResource = {
  url: 'https://unpkg.com/marked@latest/marked.min.js',
  crossorigin: 'anonymous',
};

/**
 * Handlebars runtime from unpkg.
 */
export const HANDLEBARS_CDN: CDNResource = {
  url: 'https://unpkg.com/handlebars@latest/dist/handlebars.min.js',
  crossorigin: 'anonymous',
};

/**
 * MDX runtime from esm.sh (for browser use).
 * Note: MDX compilation typically happens server-side.
 */
export const MDX_RUNTIME_CDN: CDNResource = {
  url: 'https://esm.sh/@mdx-js/mdx@3?bundle',
  crossorigin: 'anonymous',
};

/**
 * Tailwind CSS Browser CDN (play.tailwindcss.com CDN).
 * This is a JIT compiler that generates CSS on-the-fly.
 * Supports all Tailwind classes including arbitrary values.
 *
 * Note: This CDN is NOT trusted by Claude Artifacts sandbox.
 * Use CLOUDFLARE_CDN.tailwindCss for Claude.
 */
export const TAILWIND_CDN: CDNResource = {
  url: 'https://cdn.tailwindcss.com',
  crossorigin: 'anonymous',
};

// ============================================
// Cloudflare CDN (Claude-Compatible)
// ============================================

/**
 * Platform type for CDN selection.
 */
export type CDNPlatform = 'openai' | 'claude' | 'unknown';

/**
 * Cloudflare CDN resources (trusted by Claude Artifacts).
 *
 * Claude's sandbox only allows resources from cdnjs.cloudflare.com.
 * These are pre-built files (not JIT compilers) and work in restricted environments.
 *
 * Note: Tailwind from cloudflare is pre-built CSS, not the JIT compiler.
 * This means arbitrary values like `w-[123px]` won't work - only standard classes.
 */
export const CLOUDFLARE_CDN = {
  /**
   * Pre-built Tailwind CSS (standard classes only, no JIT).
   * Use this instead of TAILWIND_CDN for Claude Artifacts.
   */
  tailwindCss: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/tailwindcss-browser/4.1.13/index.global.min.js',
    integrity: 'sha512-TscjjxDy2iXx5s55Ar78c01JDHUug0K5aw4YKId9Yuocjx3ueX/X9PFyH5XNRVWqagx3TtcQWQVBaHAIPFjiFA==',
    crossorigin: 'anonymous' as const,
  },

  /**
   * HTMX for dynamic interactions.
   */
  htmx: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.4/htmx.min.js',
    integrity: 'sha512-2kIcAizYXhIn5IyXrMC72f2nh0JAtESHRpOieVw5dYPYeHwLCC2eKCqvdZDYRSEgasKrPpEPpRFjL8gqwBZWAA==',
    crossorigin: 'anonymous' as const,
  },

  /**
   * Alpine.js for reactive components.
   */
  alpinejs: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.14.3/cdn.min.js',
    integrity: 'sha512-lrQ8FHgsWKFSuQFq8NKPJicjlvJFEIrCqEj8zeX7ZOUlHWltN/Iow4jND+x84jqTdDf9n+hvQpJjGDvOl/eDRA==',
    crossorigin: 'anonymous' as const,
    defer: true,
  },

  /**
   * Marked markdown parser.
   */
  marked: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.4/marked.min.js',
    integrity: 'sha512-Rn/d0sGeizGbk3VJEiYNDt/mMcfuzYoFkia3iBffv+HX8VUrHMo/0cKjZuxWGoZLPh/VxUcC9ais+RBFZW9EBg==',
    crossorigin: 'anonymous' as const,
  },

  /**
   * Handlebars templating.
   */
  handlebars: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.8/handlebars.min.js',
    integrity: 'sha512-E1dSFxg+wsfJ4HKjutk/WaCzK7S2wv1POn1RRPGh8ZK+ag9l244Vqxji3r6wgz9YBf6+vhQEYJZpSjqWFPg9gg==',
    crossorigin: 'anonymous' as const,
  },
} as const;

/**
 * Get the appropriate Tailwind tag for a platform.
 *
 * - OpenAI: Uses Play CDN (JIT compiler, all classes + arbitrary values)
 * - Claude: Uses pre-built CSS from Cloudflare (standard classes only)
 * - Unknown: Defaults to pre-built CSS for maximum compatibility
 *
 * @param platform - Target platform
 * @returns HTML tag string (script or link)
 *
 * @example
 * ```typescript
 * // For OpenAI (JIT compiler)
 * getTailwindForPlatform('openai');
 * // '<script src="https://cdn.tailwindcss.com" crossorigin="anonymous"></script>'
 *
 * // For Claude (pre-built CSS)
 * getTailwindForPlatform('claude');
 * // '<link href="https://cdnjs.cloudflare.com/.../tailwind.min.css" rel="stylesheet">'
 * ```
 */
export function getTailwindForPlatform(platform: CDNPlatform): string {
  if (platform === 'openai') {
    // OpenAI can use the JIT compiler
    return buildCDNScriptTag(TAILWIND_CDN);
  }

  // Claude and unknown platforms use pre-built CSS from Cloudflare
  return buildCDNScriptTag(CLOUDFLARE_CDN.tailwindCss);
}

/**
 * Build a stylesheet link tag for Cloudflare CSS resources.
 *
 * @param url - CSS file URL
 * @returns HTML link tag string
 */
export function buildCloudflareStylesheetTag(url: string): string {
  return `<link href="${url}" rel="stylesheet">`;
}

/**
 * Build a script tag for Cloudflare JS resources.
 *
 * @param resource - Cloudflare CDN resource
 * @returns HTML script tag string
 */
export function buildCloudflareScriptTag(resource: {
  url: string;
  integrity?: string;
  crossorigin?: string;
  defer?: boolean;
}): string {
  const attrs: string[] = [`src="${resource.url}"`];

  if (resource.integrity) {
    attrs.push(`integrity="${resource.integrity}"`);
  }

  if (resource.crossorigin) {
    attrs.push(`crossorigin="${resource.crossorigin}"`);
  }

  if (resource.defer) {
    attrs.push('defer');
  }

  return `<script ${attrs.join(' ')}></script>`;
}

// ============================================
// Default Assets by UI Type
// ============================================

/**
 * Get default CDN resources for a UI type.
 *
 * @param uiType - The UI renderer type
 * @param mode - Resource loading mode (cdn or inline)
 * @returns RendererAssets with appropriate CDN URLs
 *
 * @example
 * ```typescript
 * // Get CDN assets for React
 * const assets = getDefaultAssets('react', 'cdn');
 * console.log(assets.react.url);
 * // "https://unpkg.com/react@18/umd/react.production.min.js"
 * ```
 */
export function getDefaultAssets(
  uiType: UIType,
  mode: ResourceMode = 'cdn'
): RendererAssets {
  const baseAssets: RendererAssets = {
    mode,
    tailwind: TAILWIND_CDN,
  };

  switch (uiType) {
    case 'react':
      return {
        ...baseAssets,
        react: REACT_CDN,
        reactDom: REACT_DOM_CDN,
      };

    case 'mdx':
      return {
        ...baseAssets,
        react: REACT_CDN,
        reactDom: REACT_DOM_CDN,
        mdxRuntime: MDX_RUNTIME_CDN,
        markdown: MARKED_CDN,
      };

    case 'markdown':
      return {
        ...baseAssets,
        markdown: MARKED_CDN,
      };

    case 'html':
      // HTML can optionally use Handlebars for {{}} syntax
      return {
        ...baseAssets,
        handlebars: HANDLEBARS_CDN,
      };

    case 'auto':
      // Auto mode includes all renderers (lazy-loaded at runtime)
      return {
        ...baseAssets,
        react: REACT_CDN,
        reactDom: REACT_DOM_CDN,
        markdown: MARKED_CDN,
        handlebars: HANDLEBARS_CDN,
      };

    default:
      return baseAssets;
  }
}

// ============================================
// Script Tag Builders
// ============================================

/**
 * Build a script tag for a CDN resource.
 *
 * @param resource - CDN resource configuration
 * @param options - Additional script tag options
 * @returns HTML script tag string
 */
export function buildCDNScriptTag(
  resource: CDNResource,
  options?: {
    async?: boolean;
    defer?: boolean;
    type?: string;
  }
): string {
  const attrs: string[] = [`src="${resource.url}"`];

  if (resource.integrity) {
    attrs.push(`integrity="${resource.integrity}"`);
  }

  if (resource.crossorigin) {
    attrs.push(`crossorigin="${resource.crossorigin}"`);
  }

  if (options?.async) {
    attrs.push('async');
  }

  if (options?.defer) {
    attrs.push('defer');
  }

  if (options?.type) {
    attrs.push(`type="${options.type}"`);
  }

  return `<script ${attrs.join(' ')}></script>`;
}

/**
 * Build all required script tags for a UI type.
 *
 * @param uiType - The UI renderer type
 * @param mode - Resource mode (cdn or inline)
 * @returns Array of script tag strings
 *
 * @example
 * ```typescript
 * const scripts = buildScriptsForUIType('react', 'cdn');
 * // Returns:
 * // [
 * //   '<script src="https://unpkg.com/react@18/..." crossorigin="anonymous"></script>',
 * //   '<script src="https://unpkg.com/react-dom@18/..." crossorigin="anonymous"></script>',
 * // ]
 * ```
 */
export function buildScriptsForUIType(
  uiType: UIType,
  mode: ResourceMode = 'cdn'
): string[] {
  if (mode !== 'cdn') {
    // Inline mode doesn't use CDN script tags
    return [];
  }

  const assets = getDefaultAssets(uiType, mode);
  const scripts: string[] = [];

  // React (must load before ReactDOM)
  if (assets.react) {
    scripts.push(buildCDNScriptTag(assets.react));
  }

  if (assets.reactDom) {
    scripts.push(buildCDNScriptTag(assets.reactDom));
  }

  // Markdown
  if (assets.markdown) {
    scripts.push(buildCDNScriptTag(assets.markdown));
  }

  // MDX Runtime
  if (assets.mdxRuntime) {
    scripts.push(buildCDNScriptTag(assets.mdxRuntime, { type: 'module' }));
  }

  // Handlebars
  if (assets.handlebars) {
    scripts.push(buildCDNScriptTag(assets.handlebars));
  }

  return scripts;
}

/**
 * Build a Tailwind script tag.
 *
 * @param config - Optional Tailwind config to inline
 * @returns Tailwind script tag(s)
 */
export function buildTailwindScriptTag(config?: string): string {
  const baseTag = buildCDNScriptTag(TAILWIND_CDN);

  if (config) {
    return `${baseTag}
<script>
  tailwind.config = ${config};
</script>`;
  }

  return baseTag;
}

// ============================================
// Inline Mode Helpers
// ============================================

/**
 * Check if inline scripts are available in cache.
 *
 * Inline scripts need to be pre-fetched and cached before use.
 * This is typically done at build time or server startup.
 */
export function hasInlineScripts(): boolean {
  // This would check a cache - implementation depends on runtime
  return false;
}

/**
 * Get all CDN URLs that need to be pre-fetched for inline mode.
 *
 * @param uiType - The UI renderer type
 * @returns Array of URLs to fetch
 */
export function getURLsToPreFetch(uiType: UIType): string[] {
  const assets = getDefaultAssets(uiType, 'cdn');
  const urls: string[] = [];

  if (assets.react) urls.push(assets.react.url);
  if (assets.reactDom) urls.push(assets.reactDom.url);
  if (assets.markdown) urls.push(assets.markdown.url);
  if (assets.handlebars) urls.push(assets.handlebars.url);
  if (assets.tailwind) urls.push(assets.tailwind.url);

  return urls;
}

// ============================================
// CDN Info for tools/list _meta
// ============================================

/**
 * CDN info structure for tools/list _meta['ui/cdn'].
 *
 * Contains CDN URLs for runtime dependencies needed to render the widget.
 */
export interface CDNInfo {
  react?: string;
  reactDom?: string;
  handlebars?: string;
  marked?: string;
  mdxRuntime?: string;
  tailwind?: string;
}

/**
 * Build CDN info object for a UI type.
 *
 * This is used in tools/list response _meta to inform clients
 * which CDN resources are needed to render the widget.
 *
 * @param uiType - The UI renderer type
 * @returns CDN info object with URLs
 *
 * @example
 * ```typescript
 * // In tools/list response
 * item._meta = {
 *   'openai/outputTemplate': 'ui://widget/get_weather.html',
 *   'ui/cdn': buildCDNInfoForUIType('react'),
 *   // { react: 'https://...', reactDom: 'https://...' }
 * };
 * ```
 */
export function buildCDNInfoForUIType(uiType: UIType): CDNInfo {
  switch (uiType) {
    case 'react':
      return {
        react: REACT_CDN.url,
        reactDom: REACT_DOM_CDN.url,
        tailwind: TAILWIND_CDN.url,
      };

    case 'mdx':
      return {
        react: REACT_CDN.url,
        reactDom: REACT_DOM_CDN.url,
        mdxRuntime: MDX_RUNTIME_CDN.url,
        marked: MARKED_CDN.url,
        tailwind: TAILWIND_CDN.url,
      };

    case 'markdown':
      return {
        marked: MARKED_CDN.url,
        tailwind: TAILWIND_CDN.url,
      };

    case 'html':
      return {
        handlebars: HANDLEBARS_CDN.url,
        tailwind: TAILWIND_CDN.url,
      };

    case 'auto':
    default:
      // Auto mode includes all renderers
      return {
        react: REACT_CDN.url,
        reactDom: REACT_DOM_CDN.url,
        handlebars: HANDLEBARS_CDN.url,
        marked: MARKED_CDN.url,
        tailwind: TAILWIND_CDN.url,
      };
  }
}
