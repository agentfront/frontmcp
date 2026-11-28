/**
 * Base Layout for Server-Rendered Pages
 *
 * Provides a consistent HTML shell, styled one of two ways:
 * - by default (`inlineStyles: true`, since 1.14): a pre-built stylesheet of
 *   the Tailwind classes the built-in auth pages use, inline, with a system
 *   font stack. The page loads nothing from a third party.
 * - `inlineStyles: false`: the Tailwind CSS v4 Browser CDN (any class,
 *   `@theme` support) and Inter from Google Fonts, loaded at runtime, as up
 *   to 1.13.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const html = baseLayout('<div>content</div>', { title: 'Page' });
 *
 * // With custom theme
 * const html = baseLayout('<div>content</div>', {
 *   title: 'Page',
 *   theme: {
 *     colors: {
 *       primary: '#3b82f6',
 *       'primary-dark': '#2563eb',
 *     },
 *   },
 * });
 * ```
 */

import { escapeHtml } from '@frontmcp/utils';

import { AUTH_PAGE_CSS } from './auth-page-styles';

// ============================================
// CDN Configuration
// ============================================

/**
 * CDN URLs a {@link baseLayout} page with `inlineStyles: false` loads. The
 * built-in auth pages, and a page on the default layout, load none of them.
 */
export const CDN = {
  /** Tailwind CSS v4 Browser CDN - generates styles on-the-fly with @theme support */
  tailwind: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',

  /** Google Fonts - Inter for modern UI */
  fonts: {
    preconnect: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    stylesheet: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
} as const;

/**
 * Content-Security-Policy for the built-in authorization pages (sign-in,
 * consent, provider selection, incremental authorization, errors), and the one
 * `builtInAuthPageHeaders()` sends by default since 1.14.
 *
 * The pages inline their stylesheet and load no third-party script, style or
 * font. Their small inline handlers and stylesheet need `'unsafe-inline'`
 * (every interpolated value is HTML-escaped). Images may come from this
 * server, `data:` and https (a client's `logo_uri`), and the pages can't be
 * framed (clickjacking) or rebased. A page on the default {@link baseLayout}
 * (`inlineStyles: true`) fits it.
 */
export const INLINE_AUTH_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The Content-Security-Policy `builtInAuthPageHeaders({ csp: 'cdn' })` sends: the {@link INLINE_AUTH_PAGE_CSP}
 * policy, plus the Tailwind CDN and Google Fonts a {@link baseLayout} page with `inlineStyles: false` loads. It was
 * the default of {@link builtInAuthPageHeaders} up to 1.13; the built-in pages send {@link INLINE_AUTH_PAGE_CSP} since
 * 1.13.2, and so does {@link builtInAuthPageHeaders} by default since 1.14.
 */
export const BUILT_IN_AUTH_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Security headers for an authorization page.
 *
 * `Referrer-Policy: same-origin` keeps the page's URL (client, redirect_uri,
 * state) away from any other origin it links to, while the page's own form POST still
 * carries its `Origin`, which the callback checks; `no-referrer` would turn
 * that into `Origin: null` and every sign-in would be refused as cross-origin.
 *
 * @param options.csp - the Content-Security-Policy: by default (or `true`, or `'inline'`) {@link INLINE_AUTH_PAGE_CSP},
 *   what the built-in pages send, for a page that loads nothing from a third party, as the default
 *   {@link baseLayout} does; `'cdn'` for {@link BUILT_IN_AUTH_PAGE_CSP}, which also allows the Tailwind CDN and
 *   Google Fonts a {@link baseLayout} page with `inlineStyles: false` loads (the default up to 1.13); `false` leaves
 *   it out, for markup the server didn't write (a `login.render` override may load its own scripts). The
 *   anti-framing, sniffing, referrer and caching headers apply either way.
 */
export function builtInAuthPageHeaders(options: { csp?: boolean | 'inline' | 'cdn' } = {}): Record<string, string> {
  const csp = options.csp === 'cdn' ? BUILT_IN_AUTH_PAGE_CSP : INLINE_AUTH_PAGE_CSP;
  return {
    ...(options.csp === false ? {} : { 'Content-Security-Policy': csp }),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}

// ============================================
// Theme Configuration
// ============================================

/**
 * Theme color configuration
 * Keys become CSS custom properties: --color-{key}
 */
export interface ThemeColors {
  /** Primary brand color */
  primary?: string;
  /** Darker primary for hover states */
  'primary-dark'?: string;
  /** Secondary brand color */
  secondary?: string;
  /** Accent color for highlights */
  accent?: string;
  /** Success state color */
  success?: string;
  /** Warning state color */
  warning?: string;
  /** Error/danger state color */
  danger?: string;
  /** Custom colors (any additional colors) */
  [key: string]: string | undefined;
}

/**
 * Theme font configuration
 * Keys become CSS custom properties: --font-{key}
 */
export interface ThemeFonts {
  /** Sans-serif font family */
  sans?: string;
  /** Serif font family */
  serif?: string;
  /** Monospace font family */
  mono?: string;
  /** Custom fonts */
  [key: string]: string | undefined;
}

/**
 * Complete theme configuration for FrontMCP UI
 */
export interface ThemeConfig {
  /** Custom colors */
  colors?: ThemeColors;
  /** Custom fonts */
  fonts?: ThemeFonts;
  /** Additional custom CSS variables (raw @theme content) */
  customVars?: string;
  /** Additional custom CSS (outside @theme) */
  customCss?: string;
}

/**
 * Default theme with FrontMCP branding
 */
export const DEFAULT_THEME: ThemeConfig = {
  colors: {
    primary: '#3b82f6', // blue-500
    'primary-dark': '#2563eb', // blue-600
    secondary: '#8b5cf6', // violet-500
    accent: '#06b6d4', // cyan-500
    success: '#22c55e', // green-500
    warning: '#f59e0b', // amber-500
    danger: '#ef4444', // red-500
  },
  fonts: {
    sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};

// ============================================
// Layout Options
// ============================================

/**
 * Options for the base layout
 */
export interface BaseLayoutOptions {
  /** Page title (will be suffixed with " - FrontMCP") */
  title: string;

  /** Optional description for meta tag */
  description?: string;

  /** With `inlineStyles: false`, include the Tailwind CDN script (default: true) */
  includeTailwind?: boolean;

  /** With `inlineStyles: false`, include Inter from Google Fonts (default: true) */
  includeFonts?: boolean;

  /**
   * Inline FrontMCP's pre-built stylesheet and a system font stack instead of
   * loading the Tailwind CDN script and Google Fonts, so the page loads
   * nothing from a third party and fits the default policy of
   * `builtInAuthPageHeaders()`. Only the classes the built-in auth pages use
   * are styled, and `theme.customCss` is plain CSS; `includeTailwind` and
   * `includeFonts` are ignored. Set `false` for the Tailwind CDN (any class)
   * and Inter, and send `builtInAuthPageHeaders({ csp: 'cdn' })`, which allows
   * them. (default: true since 1.14; false up to 1.13)
   */
  inlineStyles?: boolean;

  /** Additional head content (scripts, styles, meta tags) */
  headExtra?: string;

  /** Body classes (default: 'bg-gray-50 min-h-screen font-sans antialiased') */
  bodyClass?: string;

  /** Theme configuration - colors, fonts, and custom CSS */
  theme?: ThemeConfig;
}

// ============================================
// Utility Functions
// ============================================

// Re-export escapeHtml from @frontmcp/utils for backwards compatibility
export { escapeHtml } from '@frontmcp/utils';

/**
 * Build the @theme CSS block from theme configuration
 */
function buildThemeCss(theme: ThemeConfig): string {
  const lines: string[] = [];

  // Add color variables
  if (theme.colors) {
    for (const [key, value] of Object.entries(theme.colors)) {
      if (value) {
        lines.push(`--color-${key}: ${value};`);
      }
    }
  }

  // Add font variables
  if (theme.fonts) {
    for (const [key, value] of Object.entries(theme.fonts)) {
      if (value) {
        lines.push(`--font-${key}: ${value};`);
      }
    }
  }

  // Add custom variables
  if (theme.customVars) {
    lines.push(theme.customVars);
  }

  return lines.join('\n        ');
}

// ============================================
// Layout Builder
// ============================================

/**
 * Build the complete HTML document, styled inline or from the CDN (see {@link BaseLayoutOptions.inlineStyles})
 *
 * @param content - The page content (HTML string)
 * @param options - Layout configuration options
 * @returns Complete HTML document string
 *
 * @example
 * ```typescript
 * const html = baseLayout('<div>My content</div>', {
 *   title: 'Sign In',
 *   description: 'Sign in to your account',
 *   theme: {
 *     colors: {
 *       primary: '#ff6b6b',
 *     },
 *   },
 * });
 * ```
 */
export function baseLayout(content: string, options: BaseLayoutOptions): string {
  const {
    title,
    description,
    includeTailwind = true,
    includeFonts = true,
    inlineStyles = true,
    headExtra = '',
    bodyClass = 'bg-gray-50 min-h-screen font-sans antialiased',
    theme,
  } = options;

  // Build meta description
  const metaDescription = description ? `<meta name="description" content="${escapeHtml(description)}">` : '';

  const styles = inlineStyles ? inlineStyleBlock(theme) : cdnStyleBlock(theme, includeTailwind, includeFonts);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - FrontMCP</title>
  ${metaDescription}
${styles}
  ${headExtra}
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
</body>
</html>`;
}

/** The pre-built stylesheet, then only the caller's theme: the stylesheet carries the defaults and a system font stack. */
function inlineStyleBlock(theme: ThemeConfig | undefined): string {
  const themeVars = theme ? buildThemeCss(theme) : '';
  return `
  <style>${AUTH_PAGE_CSS}${themeVars ? `:root{${themeVars}}` : ''}${theme?.customCss ?? ''}</style>`;
}

/** Inter from Google Fonts and the Tailwind Browser CDN, with the theme merged over the defaults. */
function cdnStyleBlock(theme: ThemeConfig | undefined, includeTailwind: boolean, includeFonts: boolean): string {
  // Merge theme with defaults
  const mergedTheme: ThemeConfig = {
    colors: { ...DEFAULT_THEME.colors, ...theme?.colors },
    fonts: { ...DEFAULT_THEME.fonts, ...theme?.fonts },
    customVars: theme?.customVars,
    customCss: theme?.customCss,
  };

  // Build font preconnect links
  const fontPreconnect = includeFonts
    ? CDN.fonts.preconnect
        .map((url, i) => `<link rel="preconnect" href="${url}"${i > 0 ? ' crossorigin' : ''}>`)
        .join('\n  ')
    : '';

  // Build font stylesheet
  const fontStylesheet = includeFonts ? `<link href="${CDN.fonts.stylesheet}" rel="stylesheet">` : '';

  // Build Tailwind v4 script and theme styles
  const themeCss = buildThemeCss(mergedTheme);
  const customCss = mergedTheme.customCss || '';

  const tailwindBlock = includeTailwind
    ? `<script src="${CDN.tailwind}"></script>
  <style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`
    : '';

  return `
  <!-- Google Fonts CDN - Inter (modern UI font) -->
  ${fontPreconnect}
  ${fontStylesheet}

  <!-- Tailwind CSS v4 Browser CDN with @theme support -->
  ${tailwindBlock}`;
}

/**
 * Create a layout wrapper function with preset options
 *
 * @param defaultOptions - Default options to apply to all pages
 * @returns A function that wraps content with the layout
 *
 * @example
 * ```typescript
 * const brandedLayout = createLayout({
 *   theme: {
 *     colors: {
 *       primary: '#ff6b6b',
 *       'primary-dark': '#ee5a5a',
 *     },
 *   },
 * });
 *
 * const html = brandedLayout('<div>Content</div>', { title: 'Page' });
 * ```
 */
export function createLayout(
  defaultOptions: Partial<BaseLayoutOptions>,
): (content: string, options: BaseLayoutOptions) => string {
  return (content: string, options: BaseLayoutOptions) => {
    // Deep merge themes
    const mergedTheme: ThemeConfig | undefined =
      defaultOptions.theme || options.theme
        ? {
            colors: { ...defaultOptions.theme?.colors, ...options.theme?.colors },
            fonts: { ...defaultOptions.theme?.fonts, ...options.theme?.fonts },
            customVars: options.theme?.customVars ?? defaultOptions.theme?.customVars,
            customCss: options.theme?.customCss ?? defaultOptions.theme?.customCss,
          }
        : undefined;

    return baseLayout(content, {
      ...defaultOptions,
      ...options,
      theme: mergedTheme,
    });
  };
}

// ============================================
// Pre-configured Layouts
// ============================================

/**
 * Default auth layout with standard styling
 */
export const authLayout = createLayout({
  bodyClass: 'bg-gray-50 min-h-screen font-sans antialiased',
});

/**
 * Centered card layout for login/auth pages
 */
export function centeredCardLayout(content: string, options: BaseLayoutOptions): string {
  const wrappedContent = `
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      ${content}
    </div>
  </div>`;

  return baseLayout(wrappedContent, {
    ...options,
    bodyClass: 'bg-gradient-to-br from-primary to-secondary min-h-screen font-sans antialiased',
  });
}

/**
 * Wide layout for consent/selection pages
 */
export function wideLayout(content: string, options: BaseLayoutOptions): string {
  const wrappedContent = `
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      ${content}
    </div>
  </div>`;

  return baseLayout(wrappedContent, options);
}

/**
 * Extra wide layout for tool selection pages
 */
export function extraWideLayout(content: string, options: BaseLayoutOptions): string {
  const wrappedContent = `
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-3xl mx-auto">
      ${content}
    </div>
  </div>`;

  return baseLayout(wrappedContent, options);
}
