/**
 * Base Layout System
 *
 * Provides the foundation for all FrontMCP UI pages with:
 * - Platform-aware rendering (OpenAI, Claude, etc.)
 * - Theme integration
 * - CDN resource management
 * - Responsive layouts
 */

import {
  type PlatformCapabilities,
  type ThemeConfig,
  type DeepPartial,
  OPENAI_PLATFORM,
  canUseCdn,
  needsInlineScripts,
  DEFAULT_THEME,
  buildThemeCss,
  mergeThemes,
  CDN,
  buildFontPreconnect,
  buildFontStylesheets,
  buildCdnScripts,
} from '../theme';
import { escapeHtml } from '../utils';

// ============================================
// Layout Types
// ============================================

/**
 * Page type determines the layout structure
 */
export type PageType =
  | 'auth' // Login, register, forgot password
  | 'consent' // OAuth consent, permissions
  | 'error' // Error pages
  | 'loading' // Loading/processing states
  | 'success' // Success confirmation
  | 'dashboard' // Admin/dashboard layouts
  | 'widget' // Embedded widget mode
  | 'resource' // OpenAI resource display
  | 'custom'; // Custom layout

/**
 * Layout size/width options
 */
export type LayoutSize =
  | 'xs' // max-w-sm (24rem)
  | 'sm' // max-w-md (28rem)
  | 'md' // max-w-lg (32rem)
  | 'lg' // max-w-xl (36rem)
  | 'xl' // max-w-2xl (42rem)
  | '2xl' // max-w-3xl (48rem)
  | '3xl' // max-w-4xl (56rem)
  | 'full'; // Full width

/**
 * Background style options
 */
export type BackgroundStyle =
  | 'solid' // Solid color
  | 'gradient' // Gradient
  | 'pattern' // Pattern/texture
  | 'none'; // Transparent

/**
 * Layout alignment options
 */
export type LayoutAlignment =
  | 'center' // Centered both axes
  | 'top' // Top aligned
  | 'start'; // Start aligned (left)

// ============================================
// Layout Options
// ============================================

/**
 * Base layout configuration options
 */
export interface BaseLayoutOptions {
  /** Page title (will be suffixed with branding) */
  title: string;

  /** Page type for layout structure */
  pageType?: PageType;

  /** Content width */
  size?: LayoutSize;

  /** Content alignment */
  alignment?: LayoutAlignment;

  /** Background style */
  background?: BackgroundStyle;

  /** Optional page description for meta tag */
  description?: string;

  /** Target platform capabilities */
  platform?: PlatformCapabilities;

  /** Theme configuration (deep partial - nested properties are also optional) */
  theme?: DeepPartial<ThemeConfig>;

  /** Include HTMX (default: based on platform) */
  includeHtmx?: boolean;

  /** Include Alpine.js (default: false) */
  includeAlpine?: boolean;

  /** Include Lucide icons (default: false) */
  includeIcons?: boolean;

  /** Additional head content */
  headExtra?: string;

  /** Additional body attributes */
  bodyAttrs?: Record<string, string>;

  /** Custom body classes */
  bodyClass?: string;

  /** Title suffix/branding */
  titleSuffix?: string;

  /** Favicon URL */
  favicon?: string;

  /** Open Graph meta tags */
  og?: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
}

// ============================================
// Utility Functions
// ============================================

// Re-export escapeHtml from utils for backwards compatibility
export { escapeHtml } from '../utils';

/**
 * Get CSS class for layout size
 */
function getSizeClass(size: LayoutSize): string {
  const sizeMap: Record<LayoutSize, string> = {
    xs: 'max-w-sm',
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-xl',
    xl: 'max-w-2xl',
    '2xl': 'max-w-3xl',
    '3xl': 'max-w-4xl',
    full: 'max-w-full',
  };
  return sizeMap[size];
}

/**
 * Get CSS classes for alignment
 */
function getAlignmentClasses(alignment: LayoutAlignment): string {
  const alignMap: Record<LayoutAlignment, string> = {
    center: 'min-h-screen flex items-center justify-center',
    top: 'min-h-screen flex flex-col items-center pt-12',
    start: 'min-h-screen',
  };
  return alignMap[alignment];
}

/**
 * Get CSS classes for background
 */
function getBackgroundClasses(background: BackgroundStyle, theme: ThemeConfig): string {
  switch (background) {
    case 'gradient':
      return 'bg-gradient-to-br from-primary to-secondary';
    case 'pattern':
      return 'bg-surface bg-[url("data:image/svg+xml,...")]'; // Pattern would be defined
    case 'solid':
      return 'bg-background';
    case 'none':
    default:
      return '';
  }
}

/**
 * Build meta tags
 */
function buildMetaTags(options: BaseLayoutOptions): string {
  const tags: string[] = [];

  if (options.description) {
    tags.push(`<meta name="description" content="${escapeHtml(options.description)}">`);
  }

  if (options.og) {
    if (options.og.title) {
      tags.push(`<meta property="og:title" content="${escapeHtml(options.og.title)}">`);
    }
    if (options.og.description) {
      tags.push(`<meta property="og:description" content="${escapeHtml(options.og.description)}">`);
    }
    if (options.og.image) {
      tags.push(`<meta property="og:image" content="${escapeHtml(options.og.image)}">`);
    }
    if (options.og.type) {
      tags.push(`<meta property="og:type" content="${escapeHtml(options.og.type)}">`);
    }
  }

  if (options.favicon) {
    tags.push(`<link rel="icon" href="${escapeHtml(options.favicon)}">`);
  }

  return tags.join('\n  ');
}

/**
 * Build body attributes string
 */
function buildBodyAttrs(attrs?: Record<string, string>): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ');
}

// ============================================
// Base Layout Builder
// ============================================

/**
 * Build the complete HTML document
 *
 * @param content - The page content (HTML string)
 * @param options - Layout configuration options
 * @returns Complete HTML document string
 */
export function baseLayout(content: string, options: BaseLayoutOptions): string {
  const {
    title,
    pageType = 'custom',
    size = 'md',
    alignment = 'center',
    background = 'solid',
    platform = OPENAI_PLATFORM,
    theme: themeOverrides,
    includeHtmx,
    includeAlpine = false,
    includeIcons = false,
    headExtra = '',
    bodyAttrs,
    bodyClass = '',
    titleSuffix = 'FrontMCP',
  } = options;

  // Merge theme using the centralized mergeThemes function for proper deep merging
  const theme: ThemeConfig = themeOverrides ? mergeThemes(DEFAULT_THEME, themeOverrides) : DEFAULT_THEME;

  // Determine if we should include HTMX
  const shouldIncludeHtmx = includeHtmx ?? platform.supportsHtmx;

  // Check if we can use CDN or need inline
  const useCdn = canUseCdn(platform);
  const useInline = needsInlineScripts(platform);

  // Build font links (skip for blocked network)
  const fontPreconnect = useCdn ? buildFontPreconnect() : '';
  const fontStylesheets = useCdn ? buildFontStylesheets({ inter: true }) : '';

  // Build scripts
  const scripts = buildCdnScripts({
    tailwind: platform.supportsTailwind,
    htmx: shouldIncludeHtmx,
    alpine: includeAlpine,
    icons: includeIcons,
    inline: useInline,
  });

  // Build theme CSS
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  // Build Tailwind style block
  const styleBlock = platform.supportsTailwind
    ? `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`
    : '';

  // Build layout classes
  const sizeClass = getSizeClass(size);
  const alignmentClasses = getAlignmentClasses(alignment);
  const backgroundClasses = getBackgroundClasses(background, theme);

  // Combine body classes
  const allBodyClasses = [backgroundClasses, 'font-sans antialiased', bodyClass].filter(Boolean).join(' ');

  // Build meta tags
  const metaTags = buildMetaTags(options);
  const bodyAttrStr = buildBodyAttrs(bodyAttrs);

  // Wrap content in layout container
  const wrappedContent =
    alignment === 'center'
      ? `<div class="${alignmentClasses} p-4">
    <div class="w-full ${sizeClass}">
      ${content}
    </div>
  </div>`
      : `<div class="${alignmentClasses}">
    <div class="w-full ${sizeClass} mx-auto px-4 py-8">
      ${content}
    </div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${titleSuffix ? ` - ${escapeHtml(titleSuffix)}` : ''}</title>
  ${metaTags}

  <!-- Fonts -->
  ${fontPreconnect}
  ${fontStylesheets}

  <!-- Tailwind CSS -->
  ${scripts}
  ${styleBlock}

  ${headExtra}
</head>
<body class="${escapeHtml(allBodyClasses)}"${bodyAttrStr ? ` ${bodyAttrStr}` : ''}>
  ${wrappedContent}
</body>
</html>`;
}

// ============================================
// Layout Factory
// ============================================

/**
 * Create a layout builder with preset options.
 * The returned function accepts optional options that extend/override the defaults.
 * If defaults include `title`, the returned function's options are fully optional.
 */
export function createLayoutBuilder(
  defaults: Partial<BaseLayoutOptions>,
): (content: string, options?: Partial<BaseLayoutOptions>) => string {
  return (content: string, options: Partial<BaseLayoutOptions> = {}) => {
    // Deep merge themes using mergeThemes
    // Start with DEFAULT_THEME as base, then merge defaults.theme, then options.theme
    let mergedTheme = DEFAULT_THEME;
    if (defaults.theme) {
      mergedTheme = mergeThemes(mergedTheme, defaults.theme);
    }
    if (options.theme) {
      mergedTheme = mergeThemes(mergedTheme, options.theme);
    }

    const merged = {
      ...defaults,
      ...options,
      theme: mergedTheme,
    } as BaseLayoutOptions;

    // Ensure title exists (from defaults or options)
    if (!merged.title) {
      throw new Error('createLayoutBuilder: title is required either in defaults or options');
    }

    return baseLayout(content, merged);
  };
}
