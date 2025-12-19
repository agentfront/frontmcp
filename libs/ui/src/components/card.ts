/**
 * Card Component
 *
 * Versatile card component for content containers.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// Card Types
// ============================================

/**
 * Card variant styles
 */
export type CardVariant = 'default' | 'outlined' | 'elevated' | 'filled' | 'ghost';

/**
 * Card size options
 */
export type CardSize = 'sm' | 'md' | 'lg';

/**
 * Card component options
 */
export interface CardOptions {
  /** Card variant */
  variant?: CardVariant;
  /** Card size (padding) */
  size?: CardSize;
  /** Card title */
  title?: string;
  /** Card subtitle/description */
  subtitle?: string;
  /** Header actions (HTML) */
  headerActions?: string;
  /** Footer content (HTML) */
  footer?: string;
  /** Additional CSS classes */
  className?: string;
  /** Card ID */
  id?: string;
  /** Data attributes */
  data?: Record<string, string>;
  /** Clickable card (adds hover effects) */
  clickable?: boolean;
  /** Click handler URL */
  href?: string;
}

// ============================================
// Card Builder
// ============================================

/**
 * Get variant CSS classes
 */
function getVariantClasses(variant: CardVariant): string {
  const variants: Record<CardVariant, string> = {
    default: 'bg-white border border-border rounded-xl shadow-sm',
    outlined: 'bg-transparent border-2 border-border rounded-xl',
    elevated: 'bg-white rounded-xl shadow-lg',
    filled: 'bg-gray-50 rounded-xl',
    ghost: 'bg-transparent',
  };
  return variants[variant];
}

/**
 * Get size CSS classes
 */
function getSizeClasses(size: CardSize): string {
  const sizes: Record<CardSize, string> = {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };
  return sizes[size];
}

/**
 * Build data attributes string
 */
function buildDataAttrs(data?: Record<string, string>): string {
  if (!data) return '';
  return Object.entries(data)
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(' ');
}

/**
 * Build a card component
 */
export function card(content: string, options: CardOptions = {}): string {
  const {
    variant = 'default',
    size = 'md',
    title,
    subtitle,
    headerActions,
    footer,
    className = '',
    id,
    data,
    clickable = false,
    href,
  } = options;

  const variantClasses = getVariantClasses(variant);
  const sizeClasses = getSizeClasses(size);
  const clickableClasses = clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : '';

  const allClasses = [variantClasses, sizeClasses, clickableClasses, className].filter(Boolean).join(' ');
  const dataAttrs = buildDataAttrs(data);
  const idAttr = id ? `id="${escapeHtml(id)}"` : '';

  // Build header if title exists
  const hasHeader = title || subtitle || headerActions;
  const headerHtml = hasHeader
    ? `<div class="flex items-start justify-between mb-4">
        <div>
          ${title ? `<h3 class="text-lg font-semibold text-text-primary">${escapeHtml(title)}</h3>` : ''}
          ${subtitle ? `<p class="text-sm text-text-secondary mt-1">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${headerActions ? `<div class="flex items-center gap-2">${headerActions}</div>` : ''}
      </div>`
    : '';

  // Build footer if exists
  const footerHtml = footer ? `<div class="mt-4 pt-4 border-t border-divider">${footer}</div>` : '';

  // Wrap in anchor tag if href provided
  if (href) {
    return `<a href="${escapeHtml(href)}" class="${allClasses}" ${idAttr} ${dataAttrs}>
      ${headerHtml}
      ${content}
      ${footerHtml}
    </a>`;
  }

  return `<div class="${allClasses}" ${idAttr} ${dataAttrs}>
    ${headerHtml}
    ${content}
    ${footerHtml}
  </div>`;
}

/**
 * Build a card group (horizontal or vertical)
 */
export function cardGroup(
  cards: string[],
  options: {
    direction?: 'horizontal' | 'vertical';
    gap?: 'sm' | 'md' | 'lg';
    className?: string;
  } = {},
): string {
  const { direction = 'vertical', gap = 'md', className = '' } = options;

  const gapClasses = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' };
  const directionClasses = direction === 'horizontal' ? 'flex flex-row flex-wrap' : 'flex flex-col';

  return `<div class="${directionClasses} ${gapClasses[gap]} ${className}">
    ${cards.join('\n')}
  </div>`;
}
