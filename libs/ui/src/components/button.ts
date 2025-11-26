/**
 * @file button.ts
 * @description Button Component for FrontMCP UI.
 *
 * Versatile button component with multiple variants, sizes, and states.
 * Includes HTMX support for dynamic interactions without JavaScript.
 *
 * @example Basic button
 * ```typescript
 * import { button } from '@frontmcp/ui';
 *
 * // Primary button (default)
 * const html = button('Click Me');
 * // <button type="button" class="...bg-primary...">Click Me</button>
 * ```
 *
 * @example Button variants
 * ```typescript
 * import { button, primaryButton, dangerButton, outlineButton } from '@frontmcp/ui';
 *
 * // Using variant option
 * const secondary = button('Save', { variant: 'secondary' });
 * const danger = button('Delete', { variant: 'danger' });
 *
 * // Using shorthand functions
 * const primary = primaryButton('Submit');
 * const outline = outlineButton('Cancel');
 * ```
 *
 * @example Button with loading state
 * ```typescript
 * const loadingBtn = button('Saving...', {
 *   loading: true,
 *   disabled: true,
 * });
 * ```
 *
 * @example Button with HTMX
 * ```typescript
 * const htmxBtn = button('Load More', {
 *   htmx: {
 *     get: '/api/items?page=2',
 *     target: '#items-list',
 *     swap: 'beforeend',
 *   },
 * });
 * ```
 *
 * @example Button group
 * ```typescript
 * import { button, buttonGroup } from '@frontmcp/ui';
 *
 * const group = buttonGroup([
 *   button('Edit', { variant: 'outline' }),
 *   button('Delete', { variant: 'danger' }),
 * ], { attached: true });
 * ```
 *
 * @module @frontmcp/ui/components/button
 */

import { escapeHtml } from '../layouts/base';
import { validateOptions } from '../validation';
import {
  ButtonOptionsSchema,
  ButtonGroupOptionsSchema,
  type ButtonOptions,
  type ButtonVariant,
  type ButtonSize,
  type ButtonGroupOptions,
} from './button.schema';

// Re-export types from schema
export type { ButtonOptions, ButtonVariant, ButtonSize, ButtonGroupOptions };

// ============================================
// Button Builder
// ============================================

/**
 * Get variant CSS classes
 */
function getVariantClasses(variant: ButtonVariant): string {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-primary hover:bg-primary/90 text-white shadow-sm',
    secondary: 'bg-secondary hover:bg-secondary/90 text-white shadow-sm',
    outline: 'border-2 border-primary text-primary hover:bg-primary/10',
    ghost: 'text-text-primary hover:bg-gray-100',
    danger: 'bg-danger hover:bg-danger/90 text-white shadow-sm',
    success: 'bg-success hover:bg-success/90 text-white shadow-sm',
    link: 'text-primary hover:text-primary/80 hover:underline',
  };
  return variants[variant];
}

/**
 * Get size CSS classes
 */
function getSizeClasses(size: ButtonSize, iconOnly: boolean): string {
  if (iconOnly) {
    const iconSizes: Record<ButtonSize, string> = {
      xs: 'p-1.5',
      sm: 'p-2',
      md: 'p-2.5',
      lg: 'p-3',
      xl: 'p-4',
    };
    return iconSizes[size];
  }

  const sizes: Record<ButtonSize, string> = {
    xs: 'px-2.5 py-1.5 text-xs',
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base',
    xl: 'px-6 py-3.5 text-lg',
  };
  return sizes[size];
}

/**
 * Build HTMX attributes string
 */
function buildHtmxAttrs(htmx?: ButtonOptions['htmx']): string {
  if (!htmx) return '';
  const attrs: string[] = [];
  if (htmx.get) attrs.push(`hx-get="${escapeHtml(htmx.get)}"`);
  if (htmx.post) attrs.push(`hx-post="${escapeHtml(htmx.post)}"`);
  if (htmx.put) attrs.push(`hx-put="${escapeHtml(htmx.put)}"`);
  if (htmx.delete) attrs.push(`hx-delete="${escapeHtml(htmx.delete)}"`);
  if (htmx.target) attrs.push(`hx-target="${escapeHtml(htmx.target)}"`);
  if (htmx.swap) attrs.push(`hx-swap="${escapeHtml(htmx.swap)}"`);
  if (htmx.trigger) attrs.push(`hx-trigger="${escapeHtml(htmx.trigger)}"`);
  if (htmx.confirm) attrs.push(`hx-confirm="${escapeHtml(htmx.confirm)}"`);
  if (htmx.indicator) attrs.push(`hx-indicator="${escapeHtml(htmx.indicator)}"`);
  return attrs.join(' ');
}

/**
 * Loading spinner SVG
 */
const loadingSpinner = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
</svg>`;

/**
 * Validate href protocol to prevent javascript: and other dangerous protocols
 */
function isValidHrefProtocol(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  // Allow only safe protocols (allowlist approach is more secure than blocklist)
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  );
}

/**
 * Build a button component
 *
 * @param text - Button label text (used as aria-label for icon-only buttons)
 * @param options - Button configuration options
 * @returns HTML string for the button, or validation error box on invalid input
 *
 * @remarks
 * **Security considerations:**
 * - The `iconBefore` and `iconAfter` options accept raw HTML strings for SVG icons.
 *   These are NOT escaped and should only contain trusted content (e.g., icon library output).
 *   Never pass user-provided content to these options.
 * - The `href` option is validated to prevent javascript:, data:, and vbscript: protocols.
 *
 * **Accessibility:**
 * - When `iconOnly: true`, the `text` parameter is automatically used as `aria-label`
 *   unless an explicit `ariaLabel` option is provided.
 * - Empty button text with `iconOnly: false` will log a warning for accessibility.
 */
export function button(text: string, options: ButtonOptions = {}): string {
  // Validate options using Zod schema
  const validation = validateOptions<ButtonOptions>(options, {
    schema: ButtonOptionsSchema,
    componentName: 'button',
  });

  if (!validation.success) {
    return validation.error;
  }

  const validatedOptions = validation.data;
  const {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    fullWidth = false,
    iconBefore,
    iconAfter,
    iconOnly = false,
    className = '',
    id,
    name,
    value,
    href,
    target,
    htmx,
    data,
    ariaLabel,
  } = validatedOptions;

  // Warn about empty button text (accessibility concern)
  if (!iconOnly && !text.trim()) {
    console.warn('[frontmcp/ui] Button has empty text. Consider providing text or using iconOnly with ariaLabel.');
  }

  // Validate href protocol
  if (href && !isValidHrefProtocol(href)) {
    console.warn(`[frontmcp/ui] Button href contains potentially dangerous protocol: "${href.slice(0, 20)}..."`);
    // Don't render the href - fall back to button behavior
  }

  const variantClasses = getVariantClasses(variant);
  const sizeClasses = getSizeClasses(size, iconOnly);

  const baseClasses = [
    'inline-flex items-center justify-center',
    'font-medium',
    'rounded-lg',
    'transition-colors duration-200',
    'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2',
    disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    fullWidth ? 'w-full' : '',
    variantClasses,
    sizeClasses,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const htmxAttrs = buildHtmxAttrs(htmx);
  const dataAttrs = data
    ? Object.entries(data)
        .map(([key, val]) => `data-${key}="${escapeHtml(val)}"`)
        .join(' ')
    : '';

  const idAttr = id ? `id="${escapeHtml(id)}"` : '';
  const nameAttr = name ? `name="${escapeHtml(name)}"` : '';
  const valueAttr = value ? `value="${escapeHtml(value)}"` : '';
  const disabledAttr = disabled || loading ? 'disabled' : '';
  const targetAttr = target ? `target="${escapeHtml(target)}"` : '';

  // For icon-only buttons, use text as aria-label if no explicit ariaLabel provided (WCAG)
  const effectiveAriaLabel = ariaLabel ?? (iconOnly && text ? text : undefined);
  const ariaLabelAttr = effectiveAriaLabel ? `aria-label="${escapeHtml(effectiveAriaLabel)}"` : '';

  // Build content (both icons hide during loading for consistent visual behavior)
  const iconBeforeHtml = iconBefore && !loading ? `<span class="${iconOnly ? '' : 'mr-2'}">${iconBefore}</span>` : '';
  const iconAfterHtml = iconAfter && !loading ? `<span class="${iconOnly ? '' : 'ml-2'}">${iconAfter}</span>` : '';
  const loadingHtml = loading ? loadingSpinner : '';
  const textHtml = iconOnly ? '' : escapeHtml(text);

  const contentHtml = `${loadingHtml}${iconBeforeHtml}${textHtml}${iconAfterHtml}`;

  // Use anchor tag if href provided and protocol is safe
  if (href && !disabled && !loading && isValidHrefProtocol(href)) {
    return `<a href="${escapeHtml(
      href,
    )}" class="${baseClasses}" ${idAttr} ${htmxAttrs} ${dataAttrs} ${ariaLabelAttr} ${targetAttr}>
      ${contentHtml}
    </a>`;
  }

  return `<button type="${type}" class="${baseClasses}" ${idAttr} ${nameAttr} ${valueAttr} ${disabledAttr} ${htmxAttrs} ${dataAttrs} ${ariaLabelAttr}>
    ${contentHtml}
  </button>`;
}

/**
 * Build a button group
 *
 * @param buttons - Array of button HTML strings
 * @param options - Button group configuration options
 * @returns HTML string for the button group, or validation error box on invalid input
 */
export function buttonGroup(buttons: string[], options: ButtonGroupOptions = {}): string {
  if (buttons.length === 0) {
    console.warn('[frontmcp/ui] buttonGroup called with empty buttons array');
    return '';
  }

  // Validate options using Zod schema
  const validation = validateOptions<ButtonGroupOptions>(options, {
    schema: ButtonGroupOptionsSchema,
    componentName: 'buttonGroup',
  });

  if (!validation.success) {
    return validation.error;
  }

  const validatedOptions = validation.data;
  const { attached = false, direction = 'horizontal', gap = 'md', className = '' } = validatedOptions;

  if (attached) {
    const classes =
      direction === 'horizontal'
        ? 'inline-flex rounded-lg shadow-sm [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:not(:first-child):not(:last-child)]:rounded-none [&>*:not(:first-child)]:-ml-px'
        : 'inline-flex flex-col rounded-lg shadow-sm [&>*:first-child]:rounded-b-none [&>*:last-child]:rounded-t-none [&>*:not(:first-child):not(:last-child)]:rounded-none [&>*:not(:first-child)]:-mt-px';
    return `<div class="${classes} ${className}">${buttons.join('')}</div>`;
  }

  const gapClasses = { sm: 'gap-2', md: 'gap-3', lg: 'gap-4' };
  const directionClasses = direction === 'horizontal' ? 'flex flex-row' : 'flex flex-col';

  return `<div class="${directionClasses} ${gapClasses[gap]} ${className}">${buttons.join('')}</div>`;
}

// ============================================
// Convenience Functions
// ============================================

/** Primary button shorthand */
export const primaryButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'primary' });

/** Secondary button shorthand */
export const secondaryButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'secondary' });

/** Outline button shorthand */
export const outlineButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'outline' });

/** Ghost button shorthand */
export const ghostButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'ghost' });

/** Danger button shorthand */
export const dangerButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'danger' });

/** Link button shorthand */
export const linkButton = (text: string, opts?: Omit<ButtonOptions, 'variant'>) =>
  button(text, { ...opts, variant: 'link' });
