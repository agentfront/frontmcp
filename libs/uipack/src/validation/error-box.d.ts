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
/**
 * Options for rendering a validation error box
 */
export interface ValidationErrorBoxOptions {
  /** Name of the component that failed validation */
  componentName: string;
  /** Name of the invalid parameter (path notation for nested, e.g., "htmx.get") */
  invalidParam: string;
}
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
export declare function validationErrorBox(options: ValidationErrorBoxOptions): string;
//# sourceMappingURL=error-box.d.ts.map
