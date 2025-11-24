/**
 * AST Guard - A production-ready AST security guard for JavaScript
 *
 * @packageDocumentation
 */

// Core validator
export { JSAstValidator } from './validator';

// Interfaces and types
export type {
  ValidationRule,
  ValidationConfig,
  ValidationResult,
  ValidationContext,
  ValidationIssue,
  ValidationStats,
  SourceLocation,
  RuleConfig,
} from './interfaces';

export { ValidationSeverity } from './interfaces';

// Error classes
export {
  AstGuardError,
  ParseError,
  RuleConfigurationError,
  ConfigurationError,
  RuleNotFoundError,
  InvalidSourceError,
} from './errors';

// Built-in rules
export {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  RequiredFunctionCallRule,
  UnreachableCodeRule,
  CallArgumentValidationRule,
  NoEvalRule,
  NoAsyncRule,
} from './rules';

// Rule options types
export type { DisallowedIdentifierOptions } from './rules/disallowed-identifier.rule';
export type { ForbiddenLoopOptions } from './rules/forbidden-loop.rule';
export type { RequiredFunctionCallOptions } from './rules/required-function-call.rule';
export type {
  CallArgumentValidationOptions,
  FunctionArgumentConfig,
  ArgumentValidator,
} from './rules/call-argument-validation.rule';
export type { NoAsyncOptions } from './rules/no-async.rule';

// Presets
export {
  PresetLevel,
  Presets,
  createPreset,
  createStrictPreset,
  createSecurePreset,
  createStandardPreset,
  createPermissivePreset,
} from './presets';

export type { PresetOptions } from './presets';
