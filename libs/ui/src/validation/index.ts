/**
 * @file index.ts
 * @description Validation module exports for @frontmcp/ui.
 *
 * Provides Zod-based input validation utilities for UI components.
 * All components use these utilities to validate options at runtime
 * and display user-friendly error boxes on invalid input.
 *
 * @module @frontmcp/ui/validation
 */

// Error box component
export { validationErrorBox, type ValidationErrorBoxOptions } from './error-box';

// Validation wrapper utilities
export { validateOptions, withValidation, type ValidationConfig, type ValidationResult } from './wrapper';
