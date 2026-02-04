/**
 * Card Component
 *
 * Versatile card component for content containers.
 */

import { escapeHtml } from '../layouts/base';
import { sanitizeHtmlContent } from '@frontmcp/uipack/runtime';

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
 * Card component options.
 *
 * **Security Note**: The `headerActions`, `footer`, and `content` parameters accept raw HTML.
 * Do NOT pass untrusted user input to these parameters without sanitization.
 * Use `escapeHtml()` from `@frontmcp/ui/layouts` for text content, or use the
 * `sanitize` option to automatically sanitize HTML content.
 */
export interface CardOptions {
  /** Card variant */
  variant?: CardVariant;
  /** Card size (padding) */
  size?: CardSize;
  /** Card title (will be HTML-escaped) */
  title?: string;
  /** Card subtitle/description (will be HTML-escaped) */
  subtitle?: string;
  /**
   * Header actions (raw HTML).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  headerActions?: string;
  /**
   * Footer content (raw HTML).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
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
  /**
   * If true, sanitizes HTML content to prevent XSS.
   * Removes script tags, event handlers, and dangerous attributes.
   * @default false
   */
  sanitize?: boolean;
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
 * Build a card component.
 *
 * @param content - Card body content (raw HTML).
 *   **Warning**: Do not pass untrusted user input without sanitization.
 *   Use the `sanitize: true` option to automatically sanitize content.
 * @param options - Card options
 * @returns HTML string for the card
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
    sanitize = false,
  } = options;

  // Sanitize raw HTML content if requested
  // codeql[js/html-constructed-from-input]: content, headerActions, and footer are intentionally raw HTML for composability; sanitize option available
  const safeContent = sanitize ? sanitizeHtmlContent(content) : content;
  const safeHeaderActions = sanitize && headerActions ? sanitizeHtmlContent(headerActions) : headerActions;
  const safeFooter = sanitize && footer ? sanitizeHtmlContent(footer) : footer;

  const variantClasses = getVariantClasses(variant);
  const sizeClasses = getSizeClasses(size);
  const clickableClasses = clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : '';

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  const allClasses = [variantClasses, sizeClasses, clickableClasses, safeClassName].filter(Boolean).join(' ');
  const dataAttrs = buildDataAttrs(data);
  const idAttr = id ? `id="${escapeHtml(id)}"` : '';

  // Build header if title exists
  const hasHeader = title || subtitle || safeHeaderActions;
  const headerHtml = hasHeader
    ? `<div class="flex items-start justify-between mb-4">
        <div>
          ${title ? `<h3 class="text-lg font-semibold text-text-primary">${escapeHtml(title)}</h3>` : ''}
          ${subtitle ? `<p class="text-sm text-text-secondary mt-1">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${safeHeaderActions ? `<div class="flex items-center gap-2">${safeHeaderActions}</div>` : ''}
      </div>`
    : '';

  // Build footer if exists
  const footerHtml = safeFooter ? `<div class="mt-4 pt-4 border-t border-divider">${safeFooter}</div>` : '';

  // Wrap in anchor tag if href provided
  if (href) {
    return `<a href="${escapeHtml(href)}" class="${allClasses}" ${idAttr} ${dataAttrs}>
      ${headerHtml}
      ${safeContent}
      ${footerHtml}
    </a>`;
  }

  return `<div class="${allClasses}" ${idAttr} ${dataAttrs}>
    ${headerHtml}
    ${safeContent}
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

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="${directionClasses} ${gapClasses[gap]} ${safeClassName}">
    ${cards.join('\n')}
  </div>`;
}
