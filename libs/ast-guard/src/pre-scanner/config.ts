/**
 * Configuration interfaces and preset configurations for the pre-scanner.
 *
 * @module pre-scanner/config
 */

import { MANDATORY_LIMITS, clampToMandatoryLimit } from './mandatory-limits';

/**
 * Regex handling modes for the pre-scanner.
 */
export type RegexMode = 'block' | 'analyze' | 'allow';

/**
 * ReDoS analysis levels.
 * - 'catastrophic': Only detect patterns that cause exponential backtracking
 * - 'polynomial': Also detect patterns that cause polynomial slowdowns
 */
export type RegexAnalysisLevel = 'catastrophic' | 'polynomial';

/**
 * Configuration for the pre-scanner.
 * All limits are validated against mandatory caps and cannot exceed them.
 */
export interface PreScannerConfig {
  // ===== SIZE LIMITS =====
  /**
   * Maximum input size in bytes.
   * Default: varies by preset (AgentScript: 100KB, Strict: 500KB, etc.)
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_INPUT_SIZE (100MB)
   */
  maxInputSize: number;

  /**
   * Maximum line length in characters.
   * Default: varies by preset (AgentScript: 2000, Strict: 5000, etc.)
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_LINE_LENGTH (100,000)
   */
  maxLineLength: number;

  /**
   * Maximum number of lines.
   * Default: varies by preset (AgentScript: 1000, Strict: 2000, etc.)
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_LINES (1,000,000)
   */
  maxLines: number;

  // ===== NESTING/COMPLEXITY =====
  /**
   * Maximum bracket nesting depth (prevents parser stack overflow).
   * Default: varies by preset (AgentScript: 20, Strict: 30, etc.)
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_NESTING (200)
   */
  maxNestingDepth: number;

  /**
   * Maximum consecutive operators (e.g., ++++++).
   * Prevents parser confusion attacks.
   * Default: 10
   */
  maxConsecutiveOperators: number;

  // ===== REGEX HANDLING =====
  /**
   * How to handle regex literals:
   * - 'block': Block all regex literals (AgentScript default)
   * - 'analyze': Allow but check for ReDoS patterns (Strict/Secure/Standard default)
   * - 'allow': Allow all regex without analysis (Permissive)
   */
  regexMode: RegexMode;

  /**
   * Maximum regex pattern length (for 'analyze' mode).
   * Default: 200
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_REGEX_LENGTH (1000)
   */
  maxRegexLength?: number;

  /**
   * Maximum number of regex literals per file (for 'analyze' mode).
   * Default: 20
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_REGEX_COUNT (50)
   */
  maxRegexCount?: number;

  /**
   * ReDoS analysis level (for 'analyze' mode).
   * - 'catastrophic': Only detect exponential patterns (e.g., (a+)+)
   * - 'polynomial': Also detect polynomial patterns (e.g., .*a.*b)
   */
  regexAnalysisLevel?: RegexAnalysisLevel;

  // ===== STRING LIMITS =====
  /**
   * Maximum single string literal length.
   * Default: varies by preset (AgentScript: 10KB, etc.)
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_STRING (5MB)
   */
  maxStringLength: number;

  /**
   * Maximum total string content across all literals.
   * Default: varies by preset
   * Cannot exceed MANDATORY_LIMITS.ABSOLUTE_MAX_TOTAL_STRING_CONTENT (50MB)
   */
  maxTotalStringContent: number;

  // ===== UNICODE SECURITY =====
  /**
   * Enable Unicode pre-check for BiDi attacks.
   * Default: true for all presets except Permissive
   */
  unicodePreCheck: boolean;

  /**
   * Block BiDi direction override characters (Trojan Source attacks).
   * Default: true for all presets except Permissive
   * When true, blocks: U+202A-E (LRE, RLE, PDF, LRO, RLO), U+2066-9 (LRI, RLI, FSI, PDI)
   */
  blockBidiPatterns: boolean;

  /**
   * Block invisible/zero-width characters.
   * Default: true for AgentScript/Strict
   */
  blockInvisibleChars?: boolean;
}

/**
 * Partial configuration for customization
 */
export type PartialPreScannerConfig = Partial<PreScannerConfig>;

/**
 * Pre-scanner preset levels (mirrors the main preset levels)
 */
export type PreScannerPresetLevel = 'agentscript' | 'strict' | 'secure' | 'standard' | 'permissive';

/**
 * AgentScript preset - Maximum security for AI agent orchestration
 *
 * Key restrictions:
 * - 100KB max input (agents shouldn't need large scripts)
 * - Block ALL regex (agents use API filtering, not regex)
 * - Short line length limits
 * - Strict BiDi/unicode blocking
 */
export const AGENTSCRIPT_PRESCANNER_CONFIG: PreScannerConfig = {
  // Size limits - very restrictive
  maxInputSize: 100 * 1024, // 100KB
  maxLineLength: 2000,
  maxLines: 1000,

  // Nesting - prevent complex code
  maxNestingDepth: 20,
  maxConsecutiveOperators: 5,

  // Regex - BLOCK ALL
  regexMode: 'block',
  maxRegexLength: 0, // Not applicable when blocked
  maxRegexCount: 0,

  // Strings - moderate limits
  maxStringLength: 10 * 1024, // 10KB
  maxTotalStringContent: 100 * 1024, // 100KB

  // Unicode - strict security
  unicodePreCheck: true,
  blockBidiPatterns: true,
  blockInvisibleChars: true,
};

/**
 * Strict preset - High security with ReDoS analysis
 */
export const STRICT_PRESCANNER_CONFIG: PreScannerConfig = {
  maxInputSize: 500 * 1024, // 500KB
  maxLineLength: 5000,
  maxLines: 2000,

  maxNestingDepth: 30,
  maxConsecutiveOperators: 10,

  regexMode: 'analyze',
  maxRegexLength: 100,
  maxRegexCount: 10,
  regexAnalysisLevel: 'catastrophic',

  maxStringLength: 50 * 1024, // 50KB
  maxTotalStringContent: 500 * 1024, // 500KB

  unicodePreCheck: true,
  blockBidiPatterns: true,
  blockInvisibleChars: true,
};

/**
 * Secure preset - Balanced security with ReDoS analysis
 */
export const SECURE_PRESCANNER_CONFIG: PreScannerConfig = {
  maxInputSize: 1 * 1024 * 1024, // 1MB
  maxLineLength: 8000,
  maxLines: 5000,

  maxNestingDepth: 40,
  maxConsecutiveOperators: 15,

  regexMode: 'analyze',
  maxRegexLength: 200,
  maxRegexCount: 20,
  regexAnalysisLevel: 'catastrophic',

  maxStringLength: 100 * 1024, // 100KB
  maxTotalStringContent: 1 * 1024 * 1024, // 1MB

  unicodePreCheck: true,
  blockBidiPatterns: true,
  blockInvisibleChars: false,
};

/**
 * Standard preset - Reasonable defaults with ReDoS analysis
 */
export const STANDARD_PRESCANNER_CONFIG: PreScannerConfig = {
  maxInputSize: 5 * 1024 * 1024, // 5MB
  maxLineLength: 10000,
  maxLines: 10000,

  maxNestingDepth: 50,
  maxConsecutiveOperators: 20,

  regexMode: 'analyze',
  maxRegexLength: 500,
  maxRegexCount: 30,
  regexAnalysisLevel: 'polynomial',

  maxStringLength: 500 * 1024, // 500KB
  maxTotalStringContent: 5 * 1024 * 1024, // 5MB

  unicodePreCheck: true,
  blockBidiPatterns: false,
  blockInvisibleChars: false,
};

/**
 * Permissive preset - Minimal restrictions
 * WARNING: Should only be used for trusted code in controlled environments
 */
export const PERMISSIVE_PRESCANNER_CONFIG: PreScannerConfig = {
  maxInputSize: 10 * 1024 * 1024, // 10MB
  maxLineLength: 50000,
  maxLines: 100000,

  maxNestingDepth: 100,
  maxConsecutiveOperators: 50,

  regexMode: 'allow',
  maxRegexLength: 1000,
  maxRegexCount: 50,

  maxStringLength: 1 * 1024 * 1024, // 1MB
  maxTotalStringContent: 10 * 1024 * 1024, // 10MB

  unicodePreCheck: false,
  blockBidiPatterns: false,
  blockInvisibleChars: false,
};

/**
 * Map of preset levels to configurations
 */
export const PRESCANNER_PRESETS: Record<PreScannerPresetLevel, PreScannerConfig> = {
  agentscript: AGENTSCRIPT_PRESCANNER_CONFIG,
  strict: STRICT_PRESCANNER_CONFIG,
  secure: SECURE_PRESCANNER_CONFIG,
  standard: STANDARD_PRESCANNER_CONFIG,
  permissive: PERMISSIVE_PRESCANNER_CONFIG,
};

/**
 * Get a pre-scanner configuration by preset level
 */
export function getPreScannerPreset(level: PreScannerPresetLevel): PreScannerConfig {
  return { ...PRESCANNER_PRESETS[level] };
}

/**
 * Create a custom configuration by merging with a preset
 * All limits are automatically clamped to mandatory maximums
 */
export function createPreScannerConfig(
  basePreset: PreScannerPresetLevel,
  overrides?: PartialPreScannerConfig,
): PreScannerConfig {
  const base = getPreScannerPreset(basePreset);
  const merged = { ...base, ...overrides };

  // Clamp all size limits to mandatory maximums
  return {
    ...merged,
    maxInputSize: clampToMandatoryLimit('ABSOLUTE_MAX_INPUT_SIZE', merged.maxInputSize),
    maxLineLength: clampToMandatoryLimit('ABSOLUTE_MAX_LINE_LENGTH', merged.maxLineLength),
    maxLines: clampToMandatoryLimit('ABSOLUTE_MAX_LINES', merged.maxLines),
    maxNestingDepth: clampToMandatoryLimit('ABSOLUTE_MAX_NESTING', merged.maxNestingDepth),
    maxStringLength: clampToMandatoryLimit('ABSOLUTE_MAX_STRING', merged.maxStringLength),
    maxTotalStringContent: clampToMandatoryLimit('ABSOLUTE_MAX_TOTAL_STRING_CONTENT', merged.maxTotalStringContent),
    maxRegexLength: merged.maxRegexLength
      ? clampToMandatoryLimit('ABSOLUTE_MAX_REGEX_LENGTH', merged.maxRegexLength)
      : merged.maxRegexLength,
    maxRegexCount: merged.maxRegexCount
      ? clampToMandatoryLimit('ABSOLUTE_MAX_REGEX_COUNT', merged.maxRegexCount)
      : merged.maxRegexCount,
  };
}

/**
 * Comparison table for documentation purposes.
 *
 * | Config              | AgentScript | STRICT   | SECURE   | STANDARD | PERMISSIVE |
 * |---------------------|-------------|----------|----------|----------|------------|
 * | maxInputSize        | 100KB       | 500KB    | 1MB      | 5MB      | 10MB       |
 * | maxLineLength       | 2000        | 5000     | 8000     | 10000    | 50000      |
 * | maxLines            | 1000        | 2000     | 5000     | 10000    | 100000     |
 * | maxNestingDepth     | 20          | 30       | 40       | 50       | 100        |
 * | regexMode           | 'block'     | 'analyze'| 'analyze'| 'analyze'| 'allow'    |
 * | blockBidiPatterns   | YES         | YES      | YES      | NO       | NO         |
 * | blockInvisibleChars | YES         | YES      | NO       | NO       | NO         |
 */
