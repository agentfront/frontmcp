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
  PreScanConfig,
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
  NoCallTargetAssignmentRule,
  UnicodeSecurityRule,
  StaticCallTargetRule,
  NoRegexLiteralRule,
  NoRegexMethodsRule,
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
export type { StaticCallTargetOptions } from './rules/static-call-target.rule';
export type { NoRegexLiteralOptions } from './rules/no-regex-literal.rule';
export type { NoRegexMethodsOptions } from './rules/no-regex-methods.rule';

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

// AST Transforms (for pass-by-reference support)
export {
  // String extraction
  extractLargeStrings,
  shouldExtract,
  // Concatenation transformation
  transformConcatenation,
  transformTemplateLiterals,
} from './transforms';

export type {
  StringExtractionConfig,
  StringExtractionResult,
  ConcatTransformConfig,
  ConcatTransformResult,
} from './transforms';

// Pre-Scanner (Layer 0 Defense)
export {
  PreScanner,
  preScan,
  isPreScanValid,
  MANDATORY_LIMITS,
  PRESCANNER_ERROR_CODES,
  PreScannerError,
  ReDoSError,
  BiDiAttackError,
  PreScannerErrors,
  ScanState,
  PRESCANNER_PRESETS,
  AGENTSCRIPT_PRESCANNER_CONFIG,
  STRICT_PRESCANNER_CONFIG,
  SECURE_PRESCANNER_CONFIG,
  STANDARD_PRESCANNER_CONFIG,
  PERMISSIVE_PRESCANNER_CONFIG,
  getPreScannerPreset,
  createPreScannerConfig,
  exceedsMandatoryLimit,
  clampToMandatoryLimit,
  // ReDoS analysis utilities
  REDOS_PATTERNS,
  REDOS_THRESHOLDS,
  analyzeForReDoS,
  calculateStarHeight,
  // BiDi attack detection
  BIDI_OVERRIDE_CHARS,
  ALL_BIDI_CHARS,
  INVISIBLE_CHARS,
  ALL_INVISIBLE_CHARS,
} from './pre-scanner';

export type {
  PreScannerOptions,
  PreScannerConfig,
  PartialPreScannerConfig,
  PreScannerPresetLevel,
  RegexMode,
  RegexAnalysisLevel,
  PreScannerErrorCode,
  PreScannerErrorDetails,
  PreScanIssueSeverity,
  PreScanIssue,
  DetectedRegex,
  PreScanStats,
  PreScanResult,
  MandatoryLimitKey,
  ReDoSAnalysisResult,
} from './pre-scanner';
