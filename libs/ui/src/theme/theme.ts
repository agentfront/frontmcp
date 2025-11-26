/**
 * @file theme.ts
 * @description Theme Configuration System for FrontMCP UI.
 *
 * Provides a comprehensive theming system with:
 * - Color palettes with semantic naming
 * - Typography configuration
 * - Spacing and sizing
 * - Component-specific tokens
 * - Customizable CDN URLs for fonts, icons, and scripts
 * - Dark mode support
 * - Tailwind CSS v4 @theme integration
 *
 * @example
 * ```typescript
 * import { createTheme, DEFAULT_THEME } from '@frontmcp/ui';
 *
 * // Use the default GitHub/OpenAI theme
 * const theme = DEFAULT_THEME;
 *
 * // Or create a custom theme
 * const customTheme = createTheme({
 *   colors: {
 *     semantic: { primary: '#0969da' },
 *   },
 *   cdn: {
 *     fonts: {
 *       preconnect: ['https://fonts.googleapis.com'],
 *       stylesheets: ['https://fonts.googleapis.com/css2?family=Roboto&display=swap'],
 *     },
 *   },
 * });
 * ```
 *
 * @module @frontmcp/ui/theme
 */

// Import default theme from presets (must be at top, used in createTheme)
import { DEFAULT_THEME as _DEFAULT_THEME, GITHUB_OPENAI_THEME as _GITHUB_OPENAI_THEME } from './presets';

// ============================================
// Color Types
// ============================================

/**
 * Semantic color scale (50-950)
 */
export interface ColorScale {
  50?: string;
  100?: string;
  200?: string;
  300?: string;
  400?: string;
  500?: string;
  600?: string;
  700?: string;
  800?: string;
  900?: string;
  950?: string;
}

/**
 * Semantic color tokens
 */
export interface SemanticColors {
  /** Primary brand color */
  primary: string | ColorScale;
  /** Secondary brand color */
  secondary?: string | ColorScale;
  /** Accent/highlight color */
  accent?: string | ColorScale;
  /** Neutral/gray tones */
  neutral?: string | ColorScale;
  /** Success state */
  success?: string;
  /** Warning state */
  warning?: string;
  /** Error/danger state */
  danger?: string;
  /** Info state */
  info?: string;
}

/**
 * Surface colors for backgrounds
 */
export interface SurfaceColors {
  /** Page background */
  background?: string;
  /** Card/panel background */
  surface?: string;
  /** Elevated surface (modal, dropdown) */
  elevated?: string;
  /** Overlay/backdrop */
  overlay?: string;
}

/**
 * Text colors
 */
export interface TextColors {
  /** Primary text */
  primary?: string;
  /** Secondary/muted text */
  secondary?: string;
  /** Disabled text */
  disabled?: string;
  /** Inverse text (on dark backgrounds) */
  inverse?: string;
  /** Link text */
  link?: string;
}

/**
 * Border colors
 */
export interface BorderColors {
  /** Default border */
  default?: string;
  /** Hover border */
  hover?: string;
  /** Focus border */
  focus?: string;
  /** Divider lines */
  divider?: string;
}

/**
 * Complete color configuration
 */
export interface ThemeColors {
  /** Semantic colors */
  semantic: SemanticColors;
  /** Surface/background colors */
  surface?: SurfaceColors;
  /** Text colors */
  text?: TextColors;
  /** Border colors */
  border?: BorderColors;
  /** Additional custom colors */
  custom?: Record<string, string>;
}

// ============================================
// Typography Types
// ============================================

/**
 * Font family configuration
 */
export interface FontFamilies {
  /** Sans-serif (default) */
  sans?: string;
  /** Serif */
  serif?: string;
  /** Monospace */
  mono?: string;
  /** Display/heading */
  display?: string;
}

/**
 * Font size configuration
 */
export interface FontSizes {
  xs?: string;
  sm?: string;
  base?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  '3xl'?: string;
  '4xl'?: string;
  '5xl'?: string;
}

/**
 * Font weight configuration
 */
export interface FontWeights {
  normal?: string;
  medium?: string;
  semibold?: string;
  bold?: string;
}

/**
 * Complete typography configuration
 */
export interface ThemeTypography {
  families?: FontFamilies;
  sizes?: FontSizes;
  weights?: FontWeights;
  lineHeight?: {
    tight?: string;
    normal?: string;
    relaxed?: string;
  };
}

// ============================================
// Spacing & Sizing Types
// ============================================

/**
 * Spacing scale
 */
export interface ThemeSpacing {
  px?: string;
  0?: string;
  1?: string;
  2?: string;
  3?: string;
  4?: string;
  5?: string;
  6?: string;
  8?: string;
  10?: string;
  12?: string;
  16?: string;
  20?: string;
  24?: string;
}

/**
 * Border radius
 */
export interface ThemeRadius {
  none?: string;
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  full?: string;
}

/**
 * Shadow configuration
 */
export interface ThemeShadows {
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
}

// ============================================
// Component Tokens
// ============================================

/**
 * Button component tokens
 */
export interface ButtonTokens {
  radius?: string;
  paddingX?: string;
  paddingY?: string;
  fontSize?: string;
  fontWeight?: string;
}

/**
 * Card component tokens
 */
export interface CardTokens {
  radius?: string;
  padding?: string;
  shadow?: string;
  borderWidth?: string;
}

/**
 * Input component tokens
 */
export interface InputTokens {
  radius?: string;
  paddingX?: string;
  paddingY?: string;
  borderWidth?: string;
  focusRingWidth?: string;
}

/**
 * Component-specific tokens
 */
export interface ComponentTokens {
  button?: ButtonTokens;
  card?: CardTokens;
  input?: InputTokens;
}

// ============================================
// CDN Configuration Types
// ============================================

/**
 * Script resource with optional integrity hash
 */
export interface CdnScriptResource {
  /** URL to the script */
  url: string;
  /** Subresource integrity hash */
  integrity?: string;
}

/**
 * Font CDN configuration
 */
export interface ThemeCdnFonts {
  /** Preconnect URLs for font providers */
  preconnect?: string[];
  /** Font stylesheet URLs */
  stylesheets?: string[];
}

/**
 * Icon CDN configuration
 */
export interface ThemeCdnIcons {
  /** Icon library script */
  script?: CdnScriptResource;
}

/**
 * Scripts CDN configuration
 */
export interface ThemeCdnScripts {
  /** Tailwind CSS Browser CDN URL */
  tailwind?: string;
  /** HTMX script resource */
  htmx?: CdnScriptResource;
  /** Alpine.js script resource */
  alpine?: CdnScriptResource;
}

/**
 * Complete CDN configuration for theme
 *
 * Allows customizing all external resource URLs used by the theme.
 * Useful for:
 * - Using private CDN mirrors
 * - Self-hosting resources
 * - Compliance with CSP policies
 * - Using different font families
 */
export interface ThemeCdnConfig {
  /** Font configuration */
  fonts?: ThemeCdnFonts;
  /** Icon library configuration */
  icons?: ThemeCdnIcons;
  /** Script CDN configuration */
  scripts?: ThemeCdnScripts;
}

// ============================================
// Complete Theme Configuration
// ============================================

/**
 * Complete theme configuration
 */
export interface ThemeConfig {
  /** Theme name/identifier */
  name?: string;

  /** Color configuration */
  colors: ThemeColors;

  /** Typography configuration */
  typography?: ThemeTypography;

  /** Spacing scale */
  spacing?: ThemeSpacing;

  /** Border radius */
  radius?: ThemeRadius;

  /** Shadows */
  shadows?: ThemeShadows;

  /** Component-specific tokens */
  components?: ComponentTokens;

  /** CDN resource configuration */
  cdn?: ThemeCdnConfig;

  /** Dark mode variant */
  dark?: Partial<ThemeConfig>;

  /** Additional CSS custom properties */
  customVars?: Record<string, string>;

  /** Additional CSS (outside @theme) */
  customCss?: string;
}

// ============================================
// Default Theme (GitHub/OpenAI Style)
// ============================================

/**
 * Default FrontMCP theme - GitHub/OpenAI inspired gray-black aesthetic
 *
 * Re-exported from presets for convenience. The default theme features:
 * - Monochromatic gray-black color palette
 * - System UI font stack
 * - Smaller border radii (GitHub style)
 * - Subtle shadows with gray tones
 *
 * @see ./presets/github-openai.ts for full theme definition
 */
export const GITHUB_OPENAI_THEME = _GITHUB_OPENAI_THEME;
export const DEFAULT_THEME = _DEFAULT_THEME;

// ============================================
// Theme Builder Utilities
// ============================================

/**
 * Deep merge two theme configurations (internal helper without dark handling)
 */
function mergeThemesCore(base: ThemeConfig, override: Partial<ThemeConfig>): Omit<ThemeConfig, 'dark'> {
  return {
    ...base,
    ...override,
    colors: {
      ...base.colors,
      ...override.colors,
      semantic: { ...base.colors.semantic, ...override.colors?.semantic },
      surface: { ...base.colors.surface, ...override.colors?.surface },
      text: { ...base.colors.text, ...override.colors?.text },
      border: { ...base.colors.border, ...override.colors?.border },
      custom: { ...base.colors.custom, ...override.colors?.custom },
    },
    typography: {
      ...base.typography,
      ...override.typography,
      families: { ...base.typography?.families, ...override.typography?.families },
      sizes: { ...base.typography?.sizes, ...override.typography?.sizes },
      weights: { ...base.typography?.weights, ...override.typography?.weights },
      lineHeight: { ...base.typography?.lineHeight, ...override.typography?.lineHeight },
    },
    spacing: { ...base.spacing, ...override.spacing },
    radius: { ...base.radius, ...override.radius },
    shadows: { ...base.shadows, ...override.shadows },
    components: {
      ...base.components,
      ...override.components,
      button: { ...base.components?.button, ...override.components?.button },
      card: { ...base.components?.card, ...override.components?.card },
      input: { ...base.components?.input, ...override.components?.input },
    },
    cdn: {
      ...base.cdn,
      ...override.cdn,
      fonts: {
        // Concatenate arrays rather than replace (allows adding to preconnect/stylesheets)
        preconnect: [...(base.cdn?.fonts?.preconnect ?? []), ...(override.cdn?.fonts?.preconnect ?? [])],
        stylesheets: [...(base.cdn?.fonts?.stylesheets ?? []), ...(override.cdn?.fonts?.stylesheets ?? [])],
      },
      icons: {
        ...base.cdn?.icons,
        ...override.cdn?.icons,
        // Deep merge script to preserve integrity when only url is overridden
        script: override.cdn?.icons?.script
          ? { ...base.cdn?.icons?.script, ...override.cdn?.icons?.script }
          : base.cdn?.icons?.script,
      },
      scripts: {
        // tailwind is a simple string, just use override or base
        tailwind: override.cdn?.scripts?.tailwind ?? base.cdn?.scripts?.tailwind,
        // Deep merge htmx/alpine to preserve integrity when only url is overridden
        htmx: override.cdn?.scripts?.htmx
          ? { ...base.cdn?.scripts?.htmx, ...override.cdn?.scripts?.htmx }
          : base.cdn?.scripts?.htmx,
        alpine: override.cdn?.scripts?.alpine
          ? { ...base.cdn?.scripts?.alpine, ...override.cdn?.scripts?.alpine }
          : base.cdn?.scripts?.alpine,
      },
    },
    customVars: { ...base.customVars, ...override.customVars },
    customCss: [base.customCss, override.customCss].filter(Boolean).join('\n'),
  };
}

/**
 * Deep merge two theme configurations
 *
 * @remarks
 * Dark variant handling:
 * - When override.dark is provided, it's merged on top of base.dark (if present) or base
 * - The resulting dark variant never contains a nested .dark property
 * - This prevents infinite recursion and ensures clean dark theme composition
 */
export function mergeThemes(base: ThemeConfig, override: Partial<ThemeConfig>): ThemeConfig {
  // Merge the main (light) theme properties
  const merged = mergeThemesCore(base, override);

  // Handle dark variant separately to avoid nested .dark properties
  let darkVariant: Partial<ThemeConfig> | undefined;

  if (override.dark !== undefined) {
    // Merge override.dark on top of base.dark (or base if no base.dark)
    const darkBase = base.dark ?? base;
    // Strip any .dark from override.dark to prevent nesting
    const { dark: _nestedDark, ...overrideDarkWithoutNested } = override.dark;
    darkVariant = mergeThemesCore(darkBase as ThemeConfig, overrideDarkWithoutNested);
  } else if (base.dark !== undefined) {
    // Preserve base.dark, but strip any nested .dark property
    const { dark: _nestedDark, ...baseDarkWithoutNested } = base.dark;
    darkVariant = baseDarkWithoutNested;
  }

  return {
    ...merged,
    dark: darkVariant,
  };
}

/**
 * Create a theme by extending the default theme
 */
export function createTheme(overrides: Partial<ThemeConfig>): ThemeConfig {
  return mergeThemes(DEFAULT_THEME, overrides);
}

/**
 * Emit color scale CSS variables
 */
function emitColorScale(lines: string[], name: string, scale: ColorScale): void {
  for (const [shade, value] of Object.entries(scale)) {
    if (value) lines.push(`--color-${name}-${shade}: ${value};`);
  }
}

/**
 * Build Tailwind @theme CSS from theme configuration
 */
export function buildThemeCss(theme: ThemeConfig): string {
  const lines: string[] = [];

  // Colors - semantic
  const semantic = theme.colors.semantic;
  if (typeof semantic.primary === 'string') {
    lines.push(`--color-primary: ${semantic.primary};`);
  } else if (semantic.primary) {
    emitColorScale(lines, 'primary', semantic.primary);
  }
  if (semantic.secondary) {
    if (typeof semantic.secondary === 'string') {
      lines.push(`--color-secondary: ${semantic.secondary};`);
    } else {
      emitColorScale(lines, 'secondary', semantic.secondary);
    }
  }
  if (semantic.accent) {
    if (typeof semantic.accent === 'string') {
      lines.push(`--color-accent: ${semantic.accent};`);
    } else {
      emitColorScale(lines, 'accent', semantic.accent);
    }
  }
  if (semantic.neutral) {
    if (typeof semantic.neutral === 'string') {
      lines.push(`--color-neutral: ${semantic.neutral};`);
    } else {
      emitColorScale(lines, 'neutral', semantic.neutral);
    }
  }
  if (semantic.success) lines.push(`--color-success: ${semantic.success};`);
  if (semantic.warning) lines.push(`--color-warning: ${semantic.warning};`);
  if (semantic.danger) lines.push(`--color-danger: ${semantic.danger};`);
  if (semantic.info) lines.push(`--color-info: ${semantic.info};`);

  // Colors - surface
  const surface = theme.colors.surface;
  if (surface?.background) lines.push(`--color-background: ${surface.background};`);
  if (surface?.surface) lines.push(`--color-surface: ${surface.surface};`);
  if (surface?.elevated) lines.push(`--color-elevated: ${surface.elevated};`);
  if (surface?.overlay) lines.push(`--color-overlay: ${surface.overlay};`);

  // Colors - text
  const text = theme.colors.text;
  if (text?.primary) lines.push(`--color-text-primary: ${text.primary};`);
  if (text?.secondary) lines.push(`--color-text-secondary: ${text.secondary};`);
  if (text?.disabled) lines.push(`--color-text-disabled: ${text.disabled};`);
  if (text?.inverse) lines.push(`--color-text-inverse: ${text.inverse};`);
  if (text?.link) lines.push(`--color-text-link: ${text.link};`);

  // Colors - border
  const border = theme.colors.border;
  if (border?.default) lines.push(`--color-border: ${border.default};`);
  if (border?.hover) lines.push(`--color-border-hover: ${border.hover};`);
  if (border?.focus) lines.push(`--color-border-focus: ${border.focus};`);
  if (border?.divider) lines.push(`--color-divider: ${border.divider};`);

  // Colors - custom
  if (theme.colors.custom) {
    for (const [key, value] of Object.entries(theme.colors.custom)) {
      lines.push(`--color-${key}: ${value};`);
    }
  }

  // Typography
  const typography = theme.typography;
  if (typography?.families?.sans) lines.push(`--font-sans: ${typography.families.sans};`);
  if (typography?.families?.serif) lines.push(`--font-serif: ${typography.families.serif};`);
  if (typography?.families?.mono) lines.push(`--font-mono: ${typography.families.mono};`);
  if (typography?.families?.display) lines.push(`--font-display: ${typography.families.display};`);

  // Radius
  const radius = theme.radius;
  if (radius?.none) lines.push(`--radius-none: ${radius.none};`);
  if (radius?.sm) lines.push(`--radius-sm: ${radius.sm};`);
  if (radius?.md) lines.push(`--radius-md: ${radius.md};`);
  if (radius?.lg) lines.push(`--radius-lg: ${radius.lg};`);
  if (radius?.xl) lines.push(`--radius-xl: ${radius.xl};`);
  if (radius?.['2xl']) lines.push(`--radius-2xl: ${radius['2xl']};`);
  if (radius?.full) lines.push(`--radius-full: ${radius.full};`);

  // Custom vars
  if (theme.customVars) {
    for (const [key, value] of Object.entries(theme.customVars)) {
      lines.push(`${key}: ${value};`);
    }
  }

  return lines.join('\n      ');
}

/**
 * Build complete style block with @theme and custom CSS
 *
 * @remarks
 * **Security/Trust Model:**
 * The `theme.customCss` property is injected directly into a `<style>` tag without
 * sanitization. This is intentional - CSS customization requires full CSS syntax support.
 *
 * **Trust assumptions:**
 * - Theme configurations should only come from trusted sources (developer-defined themes)
 * - Never pass user-provided input directly to `customCss`
 * - If you need user-customizable styles, validate/sanitize them before including in a theme
 *
 * **Why no sanitization:**
 * - CSS sanitization is complex and often breaks legitimate styles
 * - The theme system is designed for developer use, not end-user customization
 * - Developers creating themes are trusted to provide safe CSS
 *
 * @param theme - Theme configuration with optional customCss
 * @returns HTML style block with Tailwind @theme directive
 */
export function buildStyleBlock(theme: ThemeConfig): string {
  const themeCss = buildThemeCss(theme);
  const customCss = theme.customCss || '';

  return `<style type="text/tailwindcss">
    @theme {
      ${themeCss}
    }
    ${customCss}
  </style>`;
}
