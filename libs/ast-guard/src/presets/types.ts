import type { FunctionArgumentConfig } from '../rules/call-argument-validation.rule';

/**
 * Preset configuration options that can be used to customize presets
 */
export interface PresetOptions {
  /**
   * Additional identifiers to disallow (merged with preset defaults)
   */
  additionalDisallowedIdentifiers?: string[];

  /**
   * Required function names that must be called
   */
  requiredFunctions?: string[];

  /**
   * Minimum number of calls for required functions
   */
  minFunctionCalls?: number;

  /**
   * Maximum number of calls for required functions
   */
  maxFunctionCalls?: number;

  /**
   * Function argument validation rules
   */
  functionArgumentRules?: Record<string, FunctionArgumentConfig>;

  /**
   * Allow specific loop types even in restricted presets
   */
  allowedLoops?: {
    allowFor?: boolean;
    allowWhile?: boolean;
    allowDoWhile?: boolean;
    allowForIn?: boolean;
    allowForOf?: boolean;
  };

  /**
   * Allow async/await even in restricted presets
   */
  allowAsync?: {
    allowAsyncFunctions?: boolean;
    allowAwait?: boolean;
  };
}

/**
 * Preset levels from highest to lowest security
 *
 * Security levels in order (high → low):
 * 1. STRICT - Maximum security for untrusted code (bank-grade)
 * 2. SECURE - High security with some flexibility
 * 3. STANDARD - Balanced security for most use cases
 * 4. PERMISSIVE - Low security, minimal restrictions
 */
export enum PresetLevel {
  /** Maximum security - blocks all dangerous patterns, enforces strict API usage (bank-grade) */
  STRICT = 'strict',

  /** High security - blocks most dangerous patterns with some flexibility */
  SECURE = 'secure',

  /** Balanced security - sensible defaults for most use cases */
  STANDARD = 'standard',

  /** Low security - minimal restrictions, allows most patterns */
  PERMISSIVE = 'permissive',
}
