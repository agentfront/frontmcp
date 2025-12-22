/**
 * @file wrapper.ts
 * @description Validation wrapper utilities for component input validation.
 *
 * Provides functions to validate component options against Zod schemas
 * and return either the validated data or an error box HTML string.
 *
 * @example
 * ```typescript
 * import { validateOptions } from '@frontmcp/ui';
 * import { z } from 'zod';
 *
 * const schema = z.object({ variant: z.enum(['primary', 'secondary']) });
 *
 * const result = validateOptions(options, {
 *   componentName: 'Button',
 *   schema,
 * });
 *
 * if (!result.success) return result.error; // Returns error box HTML
 *
 * // Use result.data safely
 * ```
 *
 * @module @frontmcp/ui/validation/wrapper
 */
import { type ZodSchema } from 'zod';
/**
 * Configuration for validation
 */
export interface ValidationConfig {
  /** Name of the component being validated */
  componentName: string;
  /** Zod schema to validate against */
  schema: ZodSchema;
}
/**
 * Result of validation - either success with data or failure with error HTML
 */
export type ValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
    };
/**
 * Validates input against a Zod schema
 *
 * Returns either:
 * - `{ success: true, data: T }` with validated/parsed data
 * - `{ success: false, error: string }` with error box HTML
 *
 * @param options - The options object to validate
 * @param config - Validation configuration (component name and schema)
 * @returns ValidationResult with either data or error HTML
 *
 * @example
 * ```typescript
 * const result = validateOptions({ variant: 'invalid' }, {
 *   componentName: 'Button',
 *   schema: ButtonOptionsSchema,
 * });
 *
 * if (!result.success) {
 *   return result.error; // Error box HTML
 * }
 *
 * // result.data is typed and validated
 * ```
 */
export declare function validateOptions<T>(options: unknown, config: ValidationConfig): ValidationResult<T>;
/**
 * Higher-order function to wrap a component function with validation
 *
 * Creates a new function that validates the options before calling the
 * original component. If validation fails, returns the error box HTML
 * instead of calling the component.
 *
 * @param componentFn - The original component function
 * @param config - Validation configuration
 * @returns Wrapped function that validates before calling
 *
 * @example
 * ```typescript
 * const buttonImpl = (text: string, opts: ButtonOptions) => `<button>...</button>`;
 *
 * const button = withValidation(buttonImpl, {
 *   componentName: 'Button',
 *   schema: ButtonOptionsSchema,
 * });
 *
 * // button() now validates options before rendering
 * ```
 */
export declare function withValidation<TInput, TOptions>(
  componentFn: (input: TInput, options: TOptions) => string,
  config: ValidationConfig,
): (input: TInput, options: unknown) => string;
//# sourceMappingURL=wrapper.d.ts.map
