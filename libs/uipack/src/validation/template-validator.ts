/**
 * Template Validator
 *
 * Validates Handlebars templates against Zod schemas to catch
 * references to non-existent fields.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { extractExpressions, extractAll, normalizePath } from '../handlebars/expression-extractor';
import { extractSchemaPaths, getSchemaPathStrings, type SchemaPath } from './schema-paths';

// ============================================
// Types
// ============================================

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

// ============================================
// Core Validation
// ============================================

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
export function validateTemplate(
  template: string,
  outputSchema: z.ZodTypeAny,
  options: ValidateTemplateOptions = {},
): TemplateValidationResult {
  const { inputSchema, warnOnOptional = true, suggestSimilar = true, maxSuggestionDistance = 3 } = options;

  const errors: TemplateValidationError[] = [];
  const warnings: TemplateValidationWarning[] = [];

  // Extract all paths from template
  const extraction = extractAll(template);
  const expressions = extractExpressions(template);

  // Get valid paths from schemas
  const outputPaths = getSchemaPathStrings(outputSchema, 'output');
  const inputPaths = inputSchema ? getSchemaPathStrings(inputSchema, 'input') : new Set<string>();

  // Get schema path info for optional checking
  const outputPathInfos = extractSchemaPaths(outputSchema, 'output');
  const inputPathInfos = inputSchema ? extractSchemaPaths(inputSchema, 'input') : [];

  // Build path info map
  const pathInfoMap = new Map<string, SchemaPath>();
  for (const info of [...outputPathInfos, ...inputPathInfos]) {
    pathInfoMap.set(info.path, info);
  }

  // Validate each expression
  for (const expr of expressions) {
    const { path, fullExpression, line, column } = expr;

    // Determine which schema to validate against
    let validPaths: Set<string>;
    let allPaths: string[];

    if (path.startsWith('output.')) {
      validPaths = outputPaths;
      allPaths = Array.from(outputPaths);
    } else if (path.startsWith('input.')) {
      if (!inputSchema) {
        // No input schema provided, skip validation
        continue;
      }
      validPaths = inputPaths;
      allPaths = Array.from(inputPaths);
    } else if (path.startsWith('structuredContent.')) {
      // structuredContent validation not implemented yet
      continue;
    } else {
      // Unknown prefix, skip
      continue;
    }

    // Check if path is valid
    const normalizedPath = normalizePath(path);
    const isValid = validPaths.has(path) || validPaths.has(normalizedPath);

    if (!isValid) {
      // Check for partial match (path might be accessing array element)
      const isArrayAccess = checkArrayAccess(path, validPaths);

      if (!isArrayAccess) {
        // Generate suggestions
        const suggestions = suggestSimilar ? findSimilarPaths(path, allPaths, maxSuggestionDistance) : [];

        errors.push({
          type: 'missing_field',
          path,
          expression: fullExpression,
          line,
          column,
          message: `Field '${getFieldName(path)}' does not exist in ${getSchemaName(path)} schema`,
          suggestions,
        });
      }
    } else {
      // Path is valid, check for warnings
      const pathInfo = pathInfoMap.get(path) ?? pathInfoMap.get(normalizedPath);

      if (pathInfo && warnOnOptional) {
        // Check if accessing optional field without guard
        if (pathInfo.optional && expr.type === 'variable') {
          // Check if there's an #if guard for this path (simplified check)
          const hasGuard = hasConditionalGuard(template, path);
          if (!hasGuard) {
            warnings.push({
              type: 'optional_field',
              path,
              expression: fullExpression,
              line,
              message: `Accessing optional field '${getFieldName(path)}' without {{#if}} guard`,
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    templatePaths: extraction.paths,
    schemaPaths: [...outputPaths, ...inputPaths],
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a path is accessing an array element.
 */
function checkArrayAccess(path: string, validPaths: Set<string>): boolean {
  const parts = path.split('.');

  // Look for numeric indices
  for (let i = 0; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) {
      // Replace this index with [] and check
      const wildcardParts = [...parts];
      wildcardParts[i] = '[]';
      const wildcardPath = wildcardParts.join('.');

      if (validPaths.has(wildcardPath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the field name from a path.
 */
function getFieldName(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

/**
 * Get the schema name from a path.
 */
function getSchemaName(path: string): string {
  if (path.startsWith('output.')) return 'output';
  if (path.startsWith('input.')) return 'input';
  if (path.startsWith('structuredContent.')) return 'structuredContent';
  return 'unknown';
}

/**
 * Check if there's a conditional guard for a path.
 * This is a simplified check - it looks for {{#if path}} before the usage.
 */
function hasConditionalGuard(template: string, path: string): boolean {
  // Check for {{#if path}} or {{#if (truthy path)}}
  const guardPattern = new RegExp(`\\{\\{#if\\s+${escapeRegex(path)}`, 'i');
  return guardPattern.test(template);
}

/**
 * Escape regex special characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find similar paths using Levenshtein distance.
 */
function findSimilarPaths(path: string, validPaths: string[], maxDistance: number): string[] {
  const fieldName = getFieldName(path);
  const prefix = path.substring(0, path.lastIndexOf('.') + 1);

  const suggestions: Array<{ path: string; distance: number }> = [];

  for (const validPath of validPaths) {
    // Only suggest paths with the same prefix depth
    if (!validPath.startsWith(prefix)) continue;

    const validFieldName = getFieldName(validPath);
    const distance = levenshteinDistance(fieldName, validFieldName);

    if (distance <= maxDistance && distance > 0) {
      suggestions.push({ path: validPath, distance });
    }
  }

  // Sort by distance and return top 3
  return suggestions
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((s) => s.path);
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

// ============================================
// Console Warning Output
// ============================================

/**
 * Format validation result as console warnings.
 *
 * @param result - Validation result
 * @param toolName - Tool name for context
 * @returns Formatted warning string
 */
export function formatValidationWarnings(result: TemplateValidationResult, toolName: string): string {
  if (result.valid && result.warnings.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push(`[FrontMCP] Template validation warnings for tool "${toolName}":`);
    lines.push('');

    for (const error of result.errors) {
      lines.push(`  Line ${error.line}: ${error.expression}`);
      lines.push(`    ${error.message}`);

      if (error.suggestions.length > 0) {
        lines.push(`    Did you mean: ${error.suggestions.join(', ')}?`);
      }

      lines.push('');
    }

    // List available fields
    const outputFields = result.schemaPaths
      .filter((p) => p.startsWith('output.') && p.split('.').length === 2)
      .map((p) => p.replace('output.', ''));

    if (outputFields.length > 0) {
      lines.push(`  Available output fields: ${outputFields.join(', ')}`);
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`  Warnings:`);

    for (const warning of result.warnings) {
      lines.push(`    Line ${warning.line}: ${warning.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Log validation warnings to console in development mode.
 *
 * @param result - Validation result
 * @param toolName - Tool name for context
 */
export function logValidationWarnings(result: TemplateValidationResult, toolName: string): void {
  const formatted = formatValidationWarnings(result, toolName);
  if (formatted) {
    console.warn(formatted);
  }
}

// ============================================
// Assertion Function
// ============================================

/**
 * Validate template and throw if invalid.
 *
 * @param template - The template to validate
 * @param outputSchema - Output schema
 * @param toolName - Tool name for error message
 * @throws Error if template has validation errors
 */
export function assertTemplateValid(template: string, outputSchema: z.ZodTypeAny, toolName: string): void {
  const result = validateTemplate(template, outputSchema);

  if (!result.valid) {
    const formatted = formatValidationWarnings(result, toolName);
    throw new Error(`Template validation failed for tool "${toolName}":\n${formatted}`);
  }
}

// ============================================
// Quick Validation
// ============================================

/**
 * Quickly check if a template is valid against a schema.
 *
 * @param template - The template to validate
 * @param outputSchema - Output schema
 * @returns true if valid, false otherwise
 */
export function isTemplateValid(template: string, outputSchema: z.ZodTypeAny): boolean {
  const result = validateTemplate(template, outputSchema);
  return result.valid;
}

/**
 * Get missing fields from a template.
 *
 * @param template - The template to check
 * @param outputSchema - Output schema
 * @returns Array of missing field paths
 */
export function getMissingFields(template: string, outputSchema: z.ZodTypeAny): string[] {
  const result = validateTemplate(template, outputSchema);
  return result.errors.map((e) => e.path);
}
