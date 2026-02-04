/**
 * Badge Component
 *
 * Small status indicators and labels.
 */

import { escapeHtml } from '../layouts/base';
import { sanitizeHtmlContent } from '@frontmcp/uipack/runtime';

// ============================================
// Badge Types
// ============================================

/**
 * Badge variant styles
 */
export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

/**
 * Badge size options
 */
export type BadgeSize = 'sm' | 'md' | 'lg';

/**
 * Badge component options.
 *
 * **Security Note**: The `icon` parameter accepts raw HTML.
 * Do NOT pass untrusted user input to this parameter without sanitization.
 * Use `escapeHtml()` from `@frontmcp/ui/layouts` for text content, or use the
 * `sanitize` option to automatically sanitize HTML content.
 */
export interface BadgeOptions {
  /** Badge variant */
  variant?: BadgeVariant;
  /** Badge size */
  size?: BadgeSize;
  /** Rounded pill style */
  pill?: boolean;
  /**
   * Icon before text (raw HTML).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  icon?: string;
  /** Dot indicator (no text) */
  dot?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Removable badge */
  removable?: boolean;
  /**
   * If true, sanitizes HTML content to prevent XSS.
   * Removes script tags, event handlers, and dangerous attributes.
   * @default false
   */
  sanitize?: boolean;
}

// ============================================
// Badge Builder
// ============================================

/**
 * Get variant CSS classes
 */
function getVariantClasses(variant: BadgeVariant): string {
  const variants: Record<BadgeVariant, string> = {
    default: 'bg-gray-100 text-gray-800',
    primary: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary/10 text-secondary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-blue-100 text-blue-800',
    outline: 'border border-border text-text-primary bg-transparent',
  };
  return variants[variant];
}

/**
 * Get size CSS classes
 */
function getSizeClasses(size: BadgeSize, dot: boolean): string {
  if (dot) {
    const dotSizes: Record<BadgeSize, string> = {
      sm: 'w-2 h-2',
      md: 'w-2.5 h-2.5',
      lg: 'w-3 h-3',
    };
    return dotSizes[size];
  }

  const sizes: Record<BadgeSize, string> = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  };
  return sizes[size];
}

/**
 * Build a badge component
 */
export function badge(text: string, options: BadgeOptions = {}): string {
  const {
    variant = 'default',
    size = 'md',
    pill = false,
    icon,
    dot = false,
    className = '',
    removable = false,
    sanitize = false,
  } = options;

  // Sanitize raw HTML content if requested
  // codeql[js/html-constructed-from-input]: icon is intentionally raw HTML for composability; sanitize option available
  const safeIcon = sanitize && icon ? sanitizeHtmlContent(icon) : icon;

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';

  // Dot badge (status indicator)
  if (dot) {
    const dotVariants: Record<BadgeVariant, string> = {
      default: 'bg-gray-400',
      primary: 'bg-primary',
      secondary: 'bg-secondary',
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-danger',
      info: 'bg-blue-500',
      outline: 'border border-current',
    };

    const dotClasses = ['inline-block rounded-full', getSizeClasses(size, true), dotVariants[variant], safeClassName]
      .filter(Boolean)
      .join(' ');

    return `<span class="${dotClasses}" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}"></span>`;
  }

  const variantClasses = getVariantClasses(variant);
  const sizeClasses = getSizeClasses(size, false);

  const baseClasses = [
    'inline-flex items-center font-medium',
    pill ? 'rounded-full' : 'rounded-md',
    variantClasses,
    sizeClasses,
    safeClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const iconHtml = safeIcon ? `<span class="mr-1">${safeIcon}</span>` : '';

  const removeHtml = removable
    ? `<button
        type="button"
        class="ml-1.5 -mr-1 hover:opacity-70 transition-opacity"
        onclick="this.parentElement.remove()"
        aria-label="Remove"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>`
    : '';

  return `<span class="${baseClasses}">
    ${iconHtml}${escapeHtml(text)}${removeHtml}
  </span>`;
}

/**
 * Build a badge group
 */
export function badgeGroup(badges: string[], options: { gap?: 'sm' | 'md' | 'lg'; className?: string } = {}): string {
  const { gap = 'sm', className = '' } = options;
  const gapClasses = { sm: 'gap-1', md: 'gap-2', lg: 'gap-3' };

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="inline-flex flex-wrap ${gapClasses[gap]} ${safeClassName}">
    ${badges.join('\n')}
  </div>`;
}

// ============================================
// Status Badge Presets
// ============================================

/** Active status badge */
export const activeBadge = (text = 'Active') => badge(text, { variant: 'success', dot: false });

/** Inactive status badge */
export const inactiveBadge = (text = 'Inactive') => badge(text, { variant: 'default', dot: false });

/** Pending status badge */
export const pendingBadge = (text = 'Pending') => badge(text, { variant: 'warning', dot: false });

/** Error status badge */
export const errorBadge = (text = 'Error') => badge(text, { variant: 'danger', dot: false });

/** New badge */
export const newBadge = (text = 'New') => badge(text, { variant: 'primary', size: 'sm', pill: true });

/** Beta badge */
export const betaBadge = (text = 'Beta') => badge(text, { variant: 'secondary', size: 'sm', pill: true });

// ============================================
// Status Dot Presets
// ============================================

/** Online status dot */
export const onlineDot = (label = 'Online') => badge(label, { variant: 'success', dot: true });

/** Offline status dot */
export const offlineDot = (label = 'Offline') => badge(label, { variant: 'default', dot: true });

/** Busy status dot */
export const busyDot = (label = 'Busy') => badge(label, { variant: 'danger', dot: true });

/** Away status dot */
export const awayDot = (label = 'Away') => badge(label, { variant: 'warning', dot: true });
