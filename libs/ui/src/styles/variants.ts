/**
 * @file variants.ts
 * @description Centralized CSS class definitions for all UI components.
 *
 * This is the single source of truth for Tailwind CSS classes used across
 * all components (Card, Badge, Button, Alert, etc.).
 *
 * @module @frontmcp/ui/styles
 */

// ============================================
// Card Styles
// ============================================

export type CardVariant = 'default' | 'outlined' | 'elevated' | 'filled' | 'ghost';
export type CardSize = 'sm' | 'md' | 'lg';

export const CARD_VARIANTS: Record<CardVariant, string> = {
  default: 'bg-white border border-border rounded-xl shadow-sm',
  outlined: 'bg-transparent border-2 border-border rounded-xl',
  elevated: 'bg-white rounded-xl shadow-lg',
  filled: 'bg-gray-50 rounded-xl',
  ghost: 'bg-transparent',
};

export const CARD_SIZES: Record<CardSize, string> = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function getCardVariantClasses(variant: CardVariant): string {
  return CARD_VARIANTS[variant];
}

export function getCardSizeClasses(size: CardSize): string {
  return CARD_SIZES[size];
}

// ============================================
// Badge Styles
// ============================================

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

export const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-800',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-blue-100 text-blue-800',
  outline: 'border border-border text-text-primary bg-transparent',
};

export const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
};

export const BADGE_DOT_SIZES: Record<BadgeSize, string> = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export const BADGE_DOT_VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-gray-400',
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-blue-500',
  outline: 'border border-current',
};

export function getBadgeVariantClasses(variant: BadgeVariant): string {
  return BADGE_VARIANTS[variant];
}

export function getBadgeSizeClasses(size: BadgeSize): string {
  return BADGE_SIZES[size];
}

export function getBadgeDotSizeClasses(size: BadgeSize): string {
  return BADGE_DOT_SIZES[size];
}

export function getBadgeDotVariantClasses(variant: BadgeVariant): string {
  return BADGE_DOT_VARIANTS[variant];
}

// ============================================
// Button Styles
// ============================================

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary hover:bg-primary/90 text-white shadow-sm',
  secondary: 'bg-secondary hover:bg-secondary/90 text-white shadow-sm',
  outline: 'border-2 border-primary text-primary hover:bg-primary/10',
  ghost: 'text-text-primary hover:bg-gray-100',
  danger: 'bg-danger hover:bg-danger/90 text-white shadow-sm',
  success: 'bg-success hover:bg-success/90 text-white shadow-sm',
  link: 'text-primary hover:text-primary/80 hover:underline',
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1.5 text-xs',
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
  xl: 'px-6 py-3.5 text-lg',
};

export const BUTTON_ICON_SIZES: Record<ButtonSize, string> = {
  xs: 'p-1.5',
  sm: 'p-2',
  md: 'p-2.5',
  lg: 'p-3',
  xl: 'p-4',
};

export const BUTTON_BASE_CLASSES =
  'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2';

export function getButtonVariantClasses(variant: ButtonVariant): string {
  return BUTTON_VARIANTS[variant];
}

export function getButtonSizeClasses(size: ButtonSize, iconOnly: boolean): string {
  return iconOnly ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];
}

// ============================================
// Alert Styles
// ============================================

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export const ALERT_VARIANTS: Record<AlertVariant, { container: string; icon: string }> = {
  info: {
    container: 'bg-blue-50 border-blue-200 text-blue-800',
    icon: 'text-blue-500',
  },
  success: {
    container: 'bg-success/10 border-success/30 text-success',
    icon: 'text-success',
  },
  warning: {
    container: 'bg-warning/10 border-warning/30 text-warning',
    icon: 'text-warning',
  },
  danger: {
    container: 'bg-danger/10 border-danger/30 text-danger',
    icon: 'text-danger',
  },
  neutral: {
    container: 'bg-gray-50 border-gray-200 text-gray-800',
    icon: 'text-gray-500',
  },
};

export const ALERT_BASE_CLASSES = 'rounded-lg border p-4';

export function getAlertVariantClasses(variant: AlertVariant): { container: string; icon: string } {
  return ALERT_VARIANTS[variant];
}

// ============================================
// Common Icons (SVG strings)
// ============================================

export const ALERT_ICONS: Record<AlertVariant, string> = {
  info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
  </svg>`,
  danger: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  neutral: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
};

export const CLOSE_ICON = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
</svg>`;

export const LOADING_SPINNER = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
</svg>`;

// ============================================
// Utility Functions
// ============================================

/**
 * Join CSS classes, filtering out falsy values
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
