/**
 * Validation Module
 *
 * Component input validation and template validation against Zod schemas
 * for FrontMCP UI widgets.
 *
 * @packageDocumentation
 */

// ============================================
// Component Validation (existing)
// ============================================

export { validationErrorBox, type ValidationErrorBoxOptions } from './error-box';

export { validateOptions, type ValidationConfig, type ValidationResult } from './wrapper';

// ============================================
// Schema Path Extraction (new)
// ============================================

export {
  extractSchemaPaths,
  getSchemaPathStrings,
  isValidSchemaPath,
  getTypeAtPath,
  getPathInfo,
  getRootFieldNames,
  getTypeDescription,
  type SchemaPath,
  type ExtractPathsOptions,
} from './schema-paths';

// ============================================
// Template Validation (new)
// ============================================

export {
  validateTemplate,
  formatValidationWarnings,
  logValidationWarnings,
  assertTemplateValid,
  isTemplateValid,
  getMissingFields,
  type TemplateValidationResult,
  type TemplateValidationError,
  type TemplateValidationWarning,
  type ValidateTemplateOptions,
  type ValidationErrorType,
  type ValidationWarningType,
} from './template-validator';
