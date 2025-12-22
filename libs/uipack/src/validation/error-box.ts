/**
 * @file error-box.ts
 * @description Validation error box component for displaying input validation failures.
 *
 * Renders a styled error card when component options fail Zod validation.
 * Shows component name and invalid parameter without exposing internal details.
 *
 * @example
 * ```typescript
 * import { validationErrorBox } from '@frontmcp/ui';
 *
 * validationErrorBox({
 *   componentName: 'Button',
 *   invalidParam: 'variant',
 * });
 * ```
 *
 * @module @frontmcp/ui/validation/error-box
 */

import { escapeHtml } from '../utils';

// ============================================
// Types
// ============================================

/**
 * Options for rendering a validation error box
 */
export interface ValidationErrorBoxOptions {
  /** Name of the component that failed validation */
  componentName: string;
  /** Name of the invalid parameter (path notation for nested, e.g., "htmx.get") */
  invalidParam: string;
}

// ============================================
// Error Box Component
// ============================================

/**
 * Error icon SVG
 */
const errorIcon = `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
</svg>`;

/**
 * Renders a validation error box for invalid component options
 *
 * This component is rendered in place of the actual component when
 * validation fails. It shows:
 * - The component name
 * - The invalid parameter name
 * - A styled error message
 *
 * It does NOT expose:
 * - The actual invalid value
 * - Internal Zod error messages
 * - Schema structure details
 *
 * @param options - Error box configuration
 * @returns HTML string for the error box
 *
 * @example
 * ```typescript
 * // Basic usage
 * validationErrorBox({ componentName: 'Button', invalidParam: 'variant' });
 *
 * // Nested param
 * validationErrorBox({ componentName: 'Button', invalidParam: 'htmx.get' });
 * ```
 */
export function validationErrorBox(options: ValidationErrorBoxOptions): string {
  const { componentName, invalidParam } = options;

  return `<div
  class="validation-error flex items-start gap-3 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg"
  role="alert"
  data-testid="validation-error"
  data-component="${escapeHtml(componentName)}"
  data-param="${escapeHtml(invalidParam)}"
>
  ${errorIcon}
  <div class="min-w-0">
    <p class="font-semibold text-sm">${escapeHtml(componentName)}: Invalid Configuration</p>
    <p class="text-sm opacity-90 mt-0.5">The "${escapeHtml(invalidParam)}" parameter is invalid.</p>
  </div>
</div>`;
}
