/**
 * Template Validator
 *
 * Validates Handlebars templates against Zod schemas to catch
 * references to non-existent fields.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
/**
 * Validation error types.
 */
export type ValidationErrorType = 'missing_field' | 'invalid_path' | 'type_mismatch';
/**
 * Validation warning types.
 */
export type ValidationWarningType = 'optional_field' | 'array_access' | 'deep_path' | 'dynamic_path';
/**
 * A validation error for a missing or invalid field.
 */
export interface TemplateValidationError {
  /** Error type */
  type: ValidationErrorType;
  /** The invalid path (e.g., "output.city") */
  path: string;
  /** The full Handlebars expression */
  expression: string;
  /** Line number in template */
  line: number;
  /** Column position */
  column: number;
  /** Human-readable error message */
  message: string;
  /** Suggested similar paths */
  suggestions: string[];
}
/**
 * A validation warning (non-blocking).
 */
export interface TemplateValidationWarning {
  /** Warning type */
  type: ValidationWarningType;
  /** The path that triggered the warning */
  path: string;
  /** The full Handlebars expression */
  expression: string;
  /** Line number in template */
  line: number;
  /** Human-readable warning message */
  message: string;
}
/**
 * Result of template validation.
 */
export interface TemplateValidationResult {
  /** Whether the template is valid (no errors) */
  valid: boolean;
  /** Validation errors (missing fields, etc.) */
  errors: TemplateValidationError[];
  /** Validation warnings (optional fields, etc.) */
  warnings: TemplateValidationWarning[];
  /** All paths found in the template */
  templatePaths: string[];
  /** All valid paths from the schema */
  schemaPaths: string[];
}
/**
 * Options for template validation.
 */
export interface ValidateTemplateOptions {
  /** Schema for input.* paths (optional) */
  inputSchema?: z.ZodTypeAny;
  /** Warn when accessing optional fields without {{#if}} guard */
  warnOnOptional?: boolean;
  /** Suggest similar paths for typos */
  suggestSimilar?: boolean;
  /** Maximum Levenshtein distance for suggestions */
  maxSuggestionDistance?: number;
  /** Tool name for error messages */
  toolName?: string;
}
/**
 * Validate a Handlebars template against an output schema.
 *
 * @param template - The Handlebars template string
 * @param outputSchema - Zod schema for the output
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateTemplate(
 *   '<div>{{output.temperature}} in {{output.city}}</div>',
 *   z.object({ temperature: z.number() })
 * );
 *
 * if (!result.valid) {
 *   console.warn('Template has issues:', result.errors);
 * }
 * ```
 */
export declare function validateTemplate(
  template: string,
  outputSchema: z.ZodTypeAny,
  options?: ValidateTemplateOptions,
): TemplateValidationResult;
/**
 * Format validation result as console warnings.
 *
 * @param result - Validation result
 * @param toolName - Tool name for context
 * @returns Formatted warning string
 */
export declare function formatValidationWarnings(result: TemplateValidationResult, toolName: string): string;
/**
 * Log validation warnings to console in development mode.
 *
 * @param result - Validation result
 * @param toolName - Tool name for context
 */
export declare function logValidationWarnings(result: TemplateValidationResult, toolName: string): void;
/**
 * Validate template and throw if invalid.
 *
 * @param template - The template to validate
 * @param outputSchema - Output schema
 * @param toolName - Tool name for error message
 * @throws Error if template has validation errors
 */
export declare function assertTemplateValid(template: string, outputSchema: z.ZodTypeAny, toolName: string): void;
/**
 * Quickly check if a template is valid against a schema.
 *
 * @param template - The template to validate
 * @param outputSchema - Output schema
 * @returns true if valid, false otherwise
 */
export declare function isTemplateValid(template: string, outputSchema: z.ZodTypeAny): boolean;
/**
 * Get missing fields from a template.
 *
 * @param template - The template to check
 * @param outputSchema - Output schema
 * @returns Array of missing field paths
 */
export declare function getMissingFields(template: string, outputSchema: z.ZodTypeAny): string[];
//# sourceMappingURL=template-validator.d.ts.map
