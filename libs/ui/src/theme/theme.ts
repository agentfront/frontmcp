/**
 * Theme Configuration System
 *
 * Provides a comprehensive theming system for FrontMCP UI with:
 * - Color palettes with semantic naming
 * - Typography configuration
 * - Spacing and sizing
 * - Component-specific tokens
 * - Dark mode support
 * - Tailwind CSS v4 @theme integration
 */

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

  /** Dark mode variant */
  dark?: Partial<ThemeConfig>;

  /** Additional CSS custom properties */
  customVars?: Record<string, string>;

  /** Additional CSS (outside @theme) */
  customCss?: string;
}

// ============================================
// Default Theme
// ============================================

/**
 * Default FrontMCP theme
 */
export const DEFAULT_THEME: ThemeConfig = {
  name: 'frontmcp-default',

  colors: {
    semantic: {
      primary: '#3b82f6', // blue-500
      secondary: '#8b5cf6', // violet-500
      accent: '#06b6d4', // cyan-500
      success: '#22c55e', // green-500
      warning: '#f59e0b', // amber-500
      danger: '#ef4444', // red-500
      info: '#0ea5e9', // sky-500
    },
    surface: {
      background: '#f9fafb', // gray-50
      surface: '#ffffff',
      elevated: '#ffffff',
      overlay: 'rgba(0, 0, 0, 0.5)',
    },
    text: {
      primary: '#111827', // gray-900
      secondary: '#6b7280', // gray-500
      disabled: '#9ca3af', // gray-400
      inverse: '#ffffff',
      link: '#3b82f6', // blue-500
    },
    border: {
      default: '#e5e7eb', // gray-200
      hover: '#d1d5db', // gray-300
      focus: '#3b82f6', // blue-500
      divider: '#f3f4f6', // gray-100
    },
  },

  typography: {
    families: {
      sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    },
    sizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
    },
    weights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },

  radius: {
    none: '0',
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },

  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },

  components: {
    button: {
      radius: '0.5rem',
      paddingX: '1rem',
      paddingY: '0.625rem',
      fontSize: '0.875rem',
      fontWeight: '500',
    },
    card: {
      radius: '0.75rem',
      padding: '1.5rem',
      shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
      borderWidth: '1px',
    },
    input: {
      radius: '0.5rem',
      paddingX: '0.75rem',
      paddingY: '0.625rem',
      borderWidth: '1px',
      focusRingWidth: '2px',
    },
  },
};

// ============================================
// Theme Builder Utilities
// ============================================

/**
 * Deep merge two theme configurations
 */
export function mergeThemes(base: ThemeConfig, override: Partial<ThemeConfig>): ThemeConfig {
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
    },
    radius: { ...base.radius, ...override.radius },
    shadows: { ...base.shadows, ...override.shadows },
    components: {
      ...base.components,
      ...override.components,
      button: { ...base.components?.button, ...override.components?.button },
      card: { ...base.components?.card, ...override.components?.card },
      input: { ...base.components?.input, ...override.components?.input },
    },
    customVars: { ...base.customVars, ...override.customVars },
    customCss: [base.customCss, override.customCss].filter(Boolean).join('\n'),
  };
}

/**
 * Create a theme by extending the default theme
 */
export function createTheme(overrides: Partial<ThemeConfig>): ThemeConfig {
  return mergeThemes(DEFAULT_THEME, overrides);
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
  }
  if (semantic.secondary && typeof semantic.secondary === 'string') {
    lines.push(`--color-secondary: ${semantic.secondary};`);
  }
  if (semantic.accent && typeof semantic.accent === 'string') {
    lines.push(`--color-accent: ${semantic.accent};`);
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
  if (radius?.sm) lines.push(`--radius-sm: ${radius.sm};`);
  if (radius?.md) lines.push(`--radius-md: ${radius.md};`);
  if (radius?.lg) lines.push(`--radius-lg: ${radius.lg};`);
  if (radius?.xl) lines.push(`--radius-xl: ${radius.xl};`);
  if (radius?.['2xl']) lines.push(`--radius-2xl: ${radius['2xl']};`);

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
