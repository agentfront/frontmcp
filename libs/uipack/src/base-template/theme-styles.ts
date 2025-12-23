/**
 * Theme Styles for Base Template
 *
 * Composes theme configuration into complete HTML head content
 * including fonts, scripts, and CSS custom properties.
 *
 * Uses existing theme utilities from @frontmcp/ui/theme module.
 */

import {
  DEFAULT_THEME,
  buildStyleBlock,
  buildCdnScriptsFromTheme,
  buildFontPreconnectFromTheme,
  buildFontStylesheetsFromTheme,
  type ThemeConfig,
  type ThemeCdnScriptOptions,
} from '../theme';

/**
 * Options for rendering theme styles.
 */
export interface ThemeStylesOptions {
  /** Theme configuration (default: DEFAULT_THEME) */
  theme?: ThemeConfig;
  /** Include Tailwind CSS (default: true) */
  tailwind?: boolean;
  /** Include HTMX (default: false) */
  htmx?: boolean;
  /** Include Alpine.js (default: false) */
  alpine?: boolean;
  /** Include fonts (default: true) */
  fonts?: boolean;
  /** Use inline scripts from cache (for blocked network platforms) */
  inline?: boolean;
}

/**
 * Render complete theme styles for HTML head section.
 *
 * This function composes all theme-related HTML including:
 * 1. Font preconnect links (optional)
 * 2. Font stylesheets (optional)
 * 3. Tailwind CSS script (with @theme variables)
 * 4. Additional framework scripts (HTMX, Alpine.js)
 *
 * @param options - Theme styles configuration
 * @returns HTML string with all style/script tags
 *
 * @example
 * ```typescript
 * // Default theme with Tailwind only
 * const styles = renderThemeStyles();
 *
 * // Custom theme with HTMX
 * const styles = renderThemeStyles({
 *   theme: customTheme,
 *   htmx: true,
 * });
 *
 * // For blocked-network platforms (Claude Artifacts)
 * await fetchAndCacheScriptsFromTheme(theme);
 * const styles = renderThemeStyles({ inline: true });
 * ```
 */
export function renderThemeStyles(options: ThemeStylesOptions = {}): string {
  const {
    theme = DEFAULT_THEME,
    tailwind = true,
    htmx = false,
    alpine = false,
    fonts = true,
    inline = false,
  } = options;

  const parts: string[] = [];

  // 1. Font preconnect links (if not inline mode)
  if (fonts && !inline) {
    parts.push(buildFontPreconnectFromTheme(theme));
  }

  // 2. Font stylesheets (if not inline mode)
  if (fonts && !inline) {
    parts.push(buildFontStylesheetsFromTheme(theme));
  }

  // 3. Tailwind CSS script (required for @theme to work)
  const scriptOptions: ThemeCdnScriptOptions = {
    tailwind,
    htmx,
    alpine,
    inline,
  };
  parts.push(buildCdnScriptsFromTheme(theme, scriptOptions));

  // 4. @theme style block with CSS custom properties
  parts.push(buildStyleBlock(theme));

  return parts.filter(Boolean).join('\n  ');
}

/**
 * Render minimal theme styles (Tailwind + @theme only).
 *
 * Use this for lightweight widgets that don't need fonts or additional scripts.
 *
 * @param theme - Theme configuration (default: DEFAULT_THEME)
 * @returns HTML string with Tailwind script and @theme style block
 */
export function renderMinimalThemeStyles(theme: ThemeConfig = DEFAULT_THEME): string {
  return renderThemeStyles({
    theme,
    tailwind: true,
    htmx: false,
    alpine: false,
    fonts: false,
    inline: false,
  });
}

/**
 * Render theme CSS variables only (no scripts).
 *
 * Use this when Tailwind is already loaded elsewhere.
 *
 * @param theme - Theme configuration (default: DEFAULT_THEME)
 * @returns HTML style block with @theme CSS
 */
export function renderThemeCssOnly(theme: ThemeConfig = DEFAULT_THEME): string {
  return buildStyleBlock(theme);
}
