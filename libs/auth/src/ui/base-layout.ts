/**
 * Base Layout for Server-Rendered Pages
 *
 * Provides a consistent HTML shell with all CDN resources pre-configured:
 * - Tailwind CSS v4 (Browser CDN) - Utility-first CSS framework with @theme support
 * - Google Fonts (Inter) - Modern UI typography
 *
 * No build step required - all resources loaded from CDN at runtime.
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

// ============================================
// CDN Configuration
// ============================================

/**
 * CDN URLs and versions - centralized for easy updates
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
 * consent, provider selection, incremental authorization, errors).
 *
 * Scripts may come only from this server and the Tailwind CDN; the pages' own
 * small inline handlers need `'unsafe-inline'` (every interpolated value is
 * HTML-escaped). Styles and fonts are limited to Google Fonts, images to this
 * server, `data:` and https (a client's `logo_uri`), and the pages can't be
 * framed (clickjacking) or rebased.
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
 * Security headers for a built-in authorization page.
 *
 * `Referrer-Policy: same-origin` keeps the page's URL (client, redirect_uri,
 * state) away from the CDNs it loads, while the page's own form POST still
 * carries its `Origin`, which the callback checks; `no-referrer` would turn
 * that into `Origin: null` and every sign-in would be refused as cross-origin.
 *
 * @param options.csp - `false` leaves out the Content-Security-Policy, for
 *   markup the server didn't write (a `login.render` override may load its own
 *   scripts); the anti-framing, sniffing, referrer and caching headers still apply.
 */
export function builtInAuthPageHeaders(options: { csp?: boolean } = {}): Record<string, string> {
  return {
    ...(options.csp === false ? {} : { 'Content-Security-Policy': BUILT_IN_AUTH_PAGE_CSP }),
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

  /** Include Tailwind CSS (default: true) */
  includeTailwind?: boolean;

  /** Include Google Fonts (default: true) */
  includeFonts?: boolean;

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
 * Build the complete HTML document with CDN resources
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
    headExtra = '',
    bodyClass = 'bg-gray-50 min-h-screen font-sans antialiased',
    theme,
  } = options;

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

  // Build meta description
  const metaDescription = description ? `<meta name="description" content="${escapeHtml(description)}">` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - FrontMCP</title>
  ${metaDescription}

  <!-- Google Fonts CDN - Inter (modern UI font) -->
  ${fontPreconnect}
  ${fontStylesheet}

  <!-- Tailwind CSS v4 Browser CDN with @theme support -->
  ${tailwindBlock}
  ${headExtra}
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
</body>
</html>`;
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
