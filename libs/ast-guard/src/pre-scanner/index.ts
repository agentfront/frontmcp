/**
 * Pre-Scanner Module - Layer 0 Defense for AST Guard
 *
 * This module provides pre-parsing security checks that run BEFORE
 * the JavaScript parser (acorn). It catches attacks that could
 * DoS the parser itself, providing defense-in-depth security.
 *
 * @packageDocumentation
 * @module pre-scanner
 */

// Main PreScanner class
export { PreScanner, type PreScannerOptions, preScan, isPreScanValid } from './pre-scanner';

// Mandatory limits (cannot be disabled)
export {
  MANDATORY_LIMITS,
  type MandatoryLimitKey,
  exceedsMandatoryLimit,
  clampToMandatoryLimit,
  validateLimitsAgainstMandatory,
} from './mandatory-limits';

// Configuration
export {
  type PreScannerConfig,
  type PartialPreScannerConfig,
  type PreScannerPresetLevel,
  type RegexMode,
  type RegexAnalysisLevel,
  PRESCANNER_PRESETS,
  AGENTSCRIPT_PRESCANNER_CONFIG,
  STRICT_PRESCANNER_CONFIG,
  SECURE_PRESCANNER_CONFIG,
  STANDARD_PRESCANNER_CONFIG,
  PERMISSIVE_PRESCANNER_CONFIG,
  getPreScannerPreset,
  createPreScannerConfig,
} from './config';

// Errors
export {
  PRESCANNER_ERROR_CODES,
  type PreScannerErrorCode,
  type PreScannerErrorDetails,
  PreScannerError,
  ReDoSError,
  BiDiAttackError,
  PreScannerErrors,
} from './errors';

// Scan state
export {
  type PreScanIssueSeverity,
  type PreScanIssue,
  type DetectedRegex,
  type PreScanStats,
  type PreScanResult,
  ScanState,
} from './scan-state';

// Re-export check utilities for advanced use cases
export {
  REDOS_PATTERNS,
  REDOS_THRESHOLDS,
  type ReDoSAnalysisResult,
  analyzeForReDoS,
  calculateStarHeight,
  BIDI_OVERRIDE_CHARS,
  ALL_BIDI_CHARS,
  INVISIBLE_CHARS,
  ALL_INVISIBLE_CHARS,
} from './checks';
