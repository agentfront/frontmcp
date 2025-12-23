// file: libs/browser/src/theme/tokens.ts
/**
 * Design Tokens
 *
 * Semantic design tokens for consistent theming across the application.
 * Based on a GitHub/OpenAI-inspired gray-black aesthetic.
 */

/**
 * Color palette type
 */
export interface ColorPalette {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
}

/**
 * Semantic color tokens
 */
export interface SemanticColors {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  secondary: string;
  secondaryHover: string;
  secondaryActive: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
  error: string;
  errorLight: string;
  info: string;
  infoLight: string;
}

/**
 * Background color tokens
 */
export interface BackgroundColors {
  default: string;
  subtle: string;
  muted: string;
  emphasis: string;
  inset: string;
  overlay: string;
  backdrop: string;
}

/**
 * Foreground (text) color tokens
 */
export interface ForegroundColors {
  default: string;
  muted: string;
  subtle: string;
  onEmphasis: string;
  link: string;
  linkHover: string;
}

/**
 * Border color tokens
 */
export interface BorderColors {
  default: string;
  muted: string;
  subtle: string;
  emphasis: string;
}

/**
 * Complete color scheme
 */
export interface ColorScheme {
  semantic: SemanticColors;
  background: BackgroundColors;
  foreground: ForegroundColors;
  border: BorderColors;
  palette: {
    gray: ColorPalette;
    blue: ColorPalette;
    green: ColorPalette;
    red: ColorPalette;
    yellow: ColorPalette;
  };
}

/**
 * Spacing scale (4px base unit)
 */
export interface SpacingScale {
  0: string;
  px: string;
  0.5: string;
  1: string;
  1.5: string;
  2: string;
  2.5: string;
  3: string;
  3.5: string;
  4: string;
  5: string;
  6: string;
  7: string;
  8: string;
  9: string;
  10: string;
  11: string;
  12: string;
  14: string;
  16: string;
  20: string;
  24: string;
  28: string;
  32: string;
  36: string;
  40: string;
  44: string;
  48: string;
  52: string;
  56: string;
  60: string;
  64: string;
  72: string;
  80: string;
  96: string;
}

/**
 * Typography tokens
 */
export interface TypographyTokens {
  fontFamily: {
    sans: string;
    mono: string;
  };
  fontSize: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl': string;
    '3xl': string;
    '4xl': string;
    '5xl': string;
  };
  fontWeight: {
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  lineHeight: {
    none: number;
    tight: number;
    snug: number;
    normal: number;
    relaxed: number;
    loose: number;
  };
  letterSpacing: {
    tighter: string;
    tight: string;
    normal: string;
    wide: string;
    wider: string;
  };
}

/**
 * Border radius tokens
 */
export interface RadiusTokens {
  none: string;
  sm: string;
  default: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  full: string;
}

/**
 * Shadow tokens
 */
export interface ShadowTokens {
  none: string;
  sm: string;
  default: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  inner: string;
}

/**
 * Transition tokens
 */
export interface TransitionTokens {
  duration: {
    fast: string;
    normal: string;
    slow: string;
  };
  timing: {
    ease: string;
    easeIn: string;
    easeOut: string;
    easeInOut: string;
  };
}

/**
 * Z-index tokens
 */
export interface ZIndexTokens {
  hide: number;
  auto: string;
  base: number;
  docked: number;
  dropdown: number;
  sticky: number;
  banner: number;
  overlay: number;
  modal: number;
  popover: number;
  toast: number;
  tooltip: number;
}

/**
 * Complete design tokens
 */
export interface DesignTokens {
  colors: ColorScheme;
  spacing: SpacingScale;
  typography: TypographyTokens;
  radius: RadiusTokens;
  shadows: ShadowTokens;
  transitions: TransitionTokens;
  zIndex: ZIndexTokens;
}

// =============================================================================
// Default Token Values
// =============================================================================

/**
 * Gray palette (GitHub-inspired)
 */
export const GRAY_PALETTE: ColorPalette = {
  50: '#f6f8fa',
  100: '#eaeef2',
  200: '#d0d7de',
  300: '#afb8c1',
  400: '#8c959f',
  500: '#6e7781',
  600: '#57606a',
  700: '#424a53',
  800: '#32383f',
  900: '#24292f',
  950: '#1b1f24',
};

/**
 * Blue palette
 */
export const BLUE_PALETTE: ColorPalette = {
  50: '#ddf4ff',
  100: '#b6e3ff',
  200: '#80ccff',
  300: '#54aeff',
  400: '#218bff',
  500: '#0969da',
  600: '#0550ae',
  700: '#033d8b',
  800: '#0a3069',
  900: '#002155',
  950: '#001429',
};

/**
 * Green palette
 */
export const GREEN_PALETTE: ColorPalette = {
  50: '#dafbe1',
  100: '#aceebb',
  200: '#6fdd8b',
  300: '#4ac26b',
  400: '#2da44e',
  500: '#1a7f37',
  600: '#116329',
  700: '#044f1e',
  800: '#003d16',
  900: '#002d11',
  950: '#001a0a',
};

/**
 * Red palette
 */
export const RED_PALETTE: ColorPalette = {
  50: '#ffebe9',
  100: '#ffcecb',
  200: '#ffaba8',
  300: '#ff8182',
  400: '#fa4549',
  500: '#cf222e',
  600: '#a40e26',
  700: '#82071e',
  800: '#660018',
  900: '#4c0014',
  950: '#33000d',
};

/**
 * Yellow palette
 */
export const YELLOW_PALETTE: ColorPalette = {
  50: '#fff8c5',
  100: '#fae17d',
  200: '#eac54f',
  300: '#d4a72c',
  400: '#bf8700',
  500: '#9a6700',
  600: '#7d4e00',
  700: '#633c01',
  800: '#4d2d00',
  900: '#3b2300',
  950: '#261700',
};

/**
 * Light theme colors
 */
export const LIGHT_COLORS: ColorScheme = {
  semantic: {
    primary: GRAY_PALETTE[900],
    primaryHover: GRAY_PALETTE[800],
    primaryActive: GRAY_PALETTE[950],
    secondary: GRAY_PALETTE[600],
    secondaryHover: GRAY_PALETTE[500],
    secondaryActive: GRAY_PALETTE[700],
    accent: BLUE_PALETTE[500],
    accentHover: BLUE_PALETTE[600],
    accentActive: BLUE_PALETTE[700],
    success: GREEN_PALETTE[500],
    successLight: GREEN_PALETTE[100],
    warning: YELLOW_PALETTE[500],
    warningLight: YELLOW_PALETTE[100],
    error: RED_PALETTE[500],
    errorLight: RED_PALETTE[100],
    info: BLUE_PALETTE[500],
    infoLight: BLUE_PALETTE[100],
  },
  background: {
    default: '#ffffff',
    subtle: GRAY_PALETTE[50],
    muted: GRAY_PALETTE[100],
    emphasis: GRAY_PALETTE[900],
    inset: GRAY_PALETTE[100],
    overlay: 'rgba(27, 31, 36, 0.5)',
    backdrop: 'rgba(255, 255, 255, 0.8)',
  },
  foreground: {
    default: GRAY_PALETTE[900],
    muted: GRAY_PALETTE[600],
    subtle: GRAY_PALETTE[500],
    onEmphasis: '#ffffff',
    link: BLUE_PALETTE[500],
    linkHover: BLUE_PALETTE[600],
  },
  border: {
    default: GRAY_PALETTE[200],
    muted: GRAY_PALETTE[200],
    subtle: GRAY_PALETTE[100],
    emphasis: GRAY_PALETTE[900],
  },
  palette: {
    gray: GRAY_PALETTE,
    blue: BLUE_PALETTE,
    green: GREEN_PALETTE,
    red: RED_PALETTE,
    yellow: YELLOW_PALETTE,
  },
};

/**
 * Dark theme colors
 */
export const DARK_COLORS: ColorScheme = {
  semantic: {
    primary: GRAY_PALETTE[50],
    primaryHover: GRAY_PALETTE[100],
    primaryActive: '#ffffff',
    secondary: GRAY_PALETTE[400],
    secondaryHover: GRAY_PALETTE[300],
    secondaryActive: GRAY_PALETTE[500],
    accent: BLUE_PALETTE[400],
    accentHover: BLUE_PALETTE[300],
    accentActive: BLUE_PALETTE[500],
    success: GREEN_PALETTE[400],
    successLight: GREEN_PALETTE[900],
    warning: YELLOW_PALETTE[400],
    warningLight: YELLOW_PALETTE[900],
    error: RED_PALETTE[400],
    errorLight: RED_PALETTE[900],
    info: BLUE_PALETTE[400],
    infoLight: BLUE_PALETTE[900],
  },
  background: {
    default: GRAY_PALETTE[950],
    subtle: GRAY_PALETTE[900],
    muted: GRAY_PALETTE[800],
    emphasis: GRAY_PALETTE[50],
    inset: '#000000',
    overlay: 'rgba(0, 0, 0, 0.6)',
    backdrop: 'rgba(27, 31, 36, 0.8)',
  },
  foreground: {
    default: GRAY_PALETTE[100],
    muted: GRAY_PALETTE[400],
    subtle: GRAY_PALETTE[500],
    onEmphasis: GRAY_PALETTE[950],
    link: BLUE_PALETTE[400],
    linkHover: BLUE_PALETTE[300],
  },
  border: {
    default: GRAY_PALETTE[700],
    muted: GRAY_PALETTE[800],
    subtle: GRAY_PALETTE[900],
    emphasis: GRAY_PALETTE[50],
  },
  palette: {
    gray: GRAY_PALETTE,
    blue: BLUE_PALETTE,
    green: GREEN_PALETTE,
    red: RED_PALETTE,
    yellow: YELLOW_PALETTE,
  },
};

/**
 * Default spacing scale
 */
export const DEFAULT_SPACING: SpacingScale = {
  0: '0px',
  px: '1px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  3.5: '14px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  9: '36px',
  10: '40px',
  11: '44px',
  12: '48px',
  14: '56px',
  16: '64px',
  20: '80px',
  24: '96px',
  28: '112px',
  32: '128px',
  36: '144px',
  40: '160px',
  44: '176px',
  48: '192px',
  52: '208px',
  56: '224px',
  60: '240px',
  64: '256px',
  72: '288px',
  80: '320px',
  96: '384px',
};

/**
 * Default typography tokens
 */
export const DEFAULT_TYPOGRAPHY: TypographyTokens = {
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    mono: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.025em',
    wider: '0.05em',
  },
};

/**
 * Default radius tokens
 */
export const DEFAULT_RADIUS: RadiusTokens = {
  none: '0px',
  sm: '2px',
  default: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  full: '9999px',
};

/**
 * Default shadow tokens
 */
export const DEFAULT_SHADOWS: ShadowTokens = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  default: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
};

/**
 * Default transition tokens
 */
export const DEFAULT_TRANSITIONS: TransitionTokens = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  timing: {
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
};

/**
 * Default z-index tokens
 */
export const DEFAULT_ZINDEX: ZIndexTokens = {
  hide: -1,
  auto: 'auto',
  base: 0,
  docked: 10,
  dropdown: 1000,
  sticky: 1100,
  banner: 1200,
  overlay: 1300,
  modal: 1400,
  popover: 1500,
  toast: 1600,
  tooltip: 1700,
};

/**
 * Complete light theme tokens
 */
export const LIGHT_TOKENS: DesignTokens = {
  colors: LIGHT_COLORS,
  spacing: DEFAULT_SPACING,
  typography: DEFAULT_TYPOGRAPHY,
  radius: DEFAULT_RADIUS,
  shadows: DEFAULT_SHADOWS,
  transitions: DEFAULT_TRANSITIONS,
  zIndex: DEFAULT_ZINDEX,
};

/**
 * Complete dark theme tokens
 */
export const DARK_TOKENS: DesignTokens = {
  colors: DARK_COLORS,
  spacing: DEFAULT_SPACING,
  typography: DEFAULT_TYPOGRAPHY,
  radius: DEFAULT_RADIUS,
  shadows: DEFAULT_SHADOWS,
  transitions: DEFAULT_TRANSITIONS,
  zIndex: DEFAULT_ZINDEX,
};
