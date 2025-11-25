/**
 * AST Guard - A production-ready AST security guard for JavaScript
 *
 * @packageDocumentation
 */

// Core validator
export { JSAstValidator } from './validator';

// Transformer
export { transformAst, generateCode, transformCode } from './transformer';

// AgentScript Transformer
export { transformAgentScript, isWrappedInMain, unwrapFromMain } from './agentscript-transformer';
export type { AgentScriptTransformConfig } from './agentscript-transformer';

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
  TransformConfig,
  TransformMode,
  WhitelistedGlobals,
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
  NoGlobalAccessRule,
  ReservedPrefixRule,
  UnknownGlobalRule,
  NoUserDefinedFunctionsRule,
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
export type { NoGlobalAccessOptions } from './rules/no-global-access.rule';
export type { ReservedPrefixOptions } from './rules/reserved-prefix.rule';
export type { UnknownGlobalOptions } from './rules/unknown-global.rule';
export type { NoUserDefinedFunctionsOptions } from './rules/no-user-functions.rule';

// Presets
export {
  PresetLevel,
  Presets,
  createPreset,
  createStrictPreset,
  createSecurePreset,
  createStandardPreset,
  createPermissivePreset,
  createAgentScriptPreset,
} from './presets';

export type { PresetOptions, AgentScriptOptions } from './presets';

// AgentScript tool descriptions for AI agents
export {
  AGENTSCRIPT_DESCRIPTION,
  AGENTSCRIPT_DESCRIPTION_SHORT,
  AGENTSCRIPT_DESCRIPTION_MEDIUM,
  AGENTSCRIPT_DESCRIPTION_FULL,
} from './agentscript-description';
