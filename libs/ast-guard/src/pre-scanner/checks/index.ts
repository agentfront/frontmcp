/**
 * Pre-scanner check functions.
 * Each check module provides validation for a specific category of issues.
 *
 * @module pre-scanner/checks
 */

// Size checks
export { checkInputSize, checkNullBytes, checkLines, performSizeChecks } from './size-check';

// Nesting checks
export { checkNestingDepth, checkConsecutiveOperators, performNestingChecks } from './nesting-check';

// Regex checks
export {
  detectRegexLiterals,
  analyzeForReDoS,
  calculateStarHeight,
  performRegexChecks,
  REDOS_PATTERNS,
  REDOS_THRESHOLDS,
  type ReDoSAnalysisResult,
} from './regex-check';

// String checks
export { checkStringLiterals, performStringChecks } from './string-check';

// Unicode checks
export {
  checkBidiPatterns,
  checkInvisibleChars,
  checkHomographs,
  performUnicodeChecks,
  BIDI_OVERRIDE_CHARS,
  ALL_BIDI_CHARS,
  BIDI_PATTERN,
  INVISIBLE_CHARS,
  ALL_INVISIBLE_CHARS,
  INVISIBLE_PATTERN,
} from './unicode-check';
