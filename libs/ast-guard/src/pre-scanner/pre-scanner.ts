/**
 * Main PreScanner class - Layer 0 Defense for AST Guard.
 *
 * The PreScanner runs BEFORE the JavaScript parser (acorn) to catch attacks
 * that could DoS the parser itself. This provides defense-in-depth security.
 *
 * @module pre-scanner/pre-scanner
 */

import type { PreScannerConfig, PreScannerPresetLevel } from './config';
import { getPreScannerPreset, createPreScannerConfig } from './config';
import type { PreScanResult } from './scan-state';
import { ScanState } from './scan-state';
import { PRESCANNER_ERROR_CODES } from './errors';
import { performSizeChecks } from './checks/size-check';
import { performNestingChecks } from './checks/nesting-check';
import { performRegexChecks } from './checks/regex-check';
import { performStringChecks } from './checks/string-check';
import { performUnicodeChecks } from './checks/unicode-check';

/**
 * Options for creating a PreScanner instance
 */
export interface PreScannerOptions {
  /**
   * Preset level to use as base configuration.
   * Default: 'standard'
   */
  preset?: PreScannerPresetLevel;

  /**
   * Custom configuration overrides.
   * These are merged with the preset configuration.
   */
  config?: Partial<PreScannerConfig>;
}

/**
 * PreScanner - Layer 0 security scanning before AST parsing.
 *
 * This scanner runs BEFORE acorn.parse() to catch attacks that could:
 * - Exhaust memory (huge inputs)
 * - Overflow the parser stack (deep nesting)
 * - Cause ReDoS via regex literals
 * - Exploit Unicode vulnerabilities (Trojan Source)
 *
 * @example
 * ```typescript
 * // Default configuration (standard preset)
 * const scanner = new PreScanner();
 * const result = scanner.scan(sourceCode);
 *
 * if (!result.success) {
 *   throw new Error(result.fatalIssue?.message);
 * }
 *
 * // Now safe to parse with acorn
 * const ast = acorn.parse(sourceCode, options);
 * ```
 *
 * @example
 * ```typescript
 * // AgentScript preset (maximum security)
 * const scanner = new PreScanner({ preset: 'agentscript' });
 *
 * // Or with custom overrides
 * const scanner = new PreScanner({
 *   preset: 'secure',
 *   config: {
 *     maxInputSize: 200 * 1024, // 200KB instead of 1MB
 *     regexMode: 'block', // Block all regex
 *   },
 * });
 * ```
 */
export class PreScanner {
  /**
   * The resolved configuration for this scanner
   */
  readonly config: PreScannerConfig;

  /**
   * The preset level used (if any)
   */
  readonly presetLevel: PreScannerPresetLevel;

  /**
   * Create a new PreScanner instance.
   *
   * @param options - Configuration options
   */
  constructor(options: PreScannerOptions = {}) {
    this.presetLevel = options.preset ?? 'standard';
    this.config = options.config
      ? createPreScannerConfig(this.presetLevel, options.config)
      : getPreScannerPreset(this.presetLevel);
  }

  /**
   * Scan source code for security issues.
   *
   * This method performs multiple passes over the source code,
   * checking for various security issues in order of severity.
   * It stops early if a fatal issue is found.
   *
   * @param source - The source code to scan
   * @returns Scan result with success status, issues, and statistics
   *
   * @example
   * ```typescript
   * const result = scanner.scan(code);
   *
   * if (result.success) {
   *   // Safe to proceed with AST parsing
   *   console.log(`Scan passed in ${result.stats.scanDurationMs}ms`);
   * } else {
   *   // Handle security issue
   *   console.error(`Blocked: ${result.fatalIssue?.message}`);
   *   console.error(`Error code: ${result.fatalIssue?.code}`);
   * }
   * ```
   */
  scan(source: string): PreScanResult {
    // Fast path for empty input
    if (!source || source.length === 0) {
      return ScanState.quickFail({
        code: PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE, // Note: Using INPUT_TOO_LARGE for empty input (no INVALID_INPUT code)
        message: 'Empty input is not valid source code',
      });
    }

    const state = new ScanState();

    // Phase 1: Size checks (fastest, catch biggest attacks first)
    performSizeChecks(source, this.config, state);
    if (state.shouldStop()) {
      return state.finalize();
    }

    // Phase 2: Unicode security (catch Trojan Source attacks early)
    performUnicodeChecks(source, this.config, state);
    if (state.shouldStop()) {
      return state.finalize();
    }

    // Phase 3: Nesting depth (prevent stack overflow in parser)
    performNestingChecks(source, this.config, state);
    if (state.shouldStop()) {
      return state.finalize();
    }

    // Phase 4: Regex detection and ReDoS analysis
    performRegexChecks(source, this.config, state);
    if (state.shouldStop()) {
      return state.finalize();
    }

    // Phase 5: String literal checks
    performStringChecks(source, this.config, state);

    return state.finalize();
  }

  /**
   * Quick validation that only checks critical security issues.
   * Faster than full scan but may miss some warnings.
   *
   * @param source - The source code to validate
   * @returns true if the source passes critical checks
   */
  quickValidate(source: string): boolean {
    if (!source || source.length === 0) {
      return false;
    }

    const state = new ScanState();

    // Only run critical checks
    performSizeChecks(source, this.config, state);
    if (state.shouldStop()) return false;

    performUnicodeChecks(source, this.config, state);
    if (state.shouldStop()) return false;

    performNestingChecks(source, this.config, state);
    return !state.shouldStop();
  }

  /**
   * Get the current configuration.
   * Returns a copy to prevent mutation.
   */
  getConfig(): Readonly<PreScannerConfig> {
    return { ...this.config };
  }

  /**
   * Create a new scanner with modified configuration.
   * The original scanner is not modified.
   *
   * @param overrides - Configuration overrides
   * @returns New PreScanner instance with merged configuration
   */
  withConfig(overrides: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({
      preset: this.presetLevel,
      config: { ...this.config, ...overrides },
    });
  }

  /**
   * Create scanners for common use cases
   */
  static forAgentScript(overrides?: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({ preset: 'agentscript', config: overrides });
  }

  static forStrict(overrides?: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({ preset: 'strict', config: overrides });
  }

  static forSecure(overrides?: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({ preset: 'secure', config: overrides });
  }

  static forStandard(overrides?: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({ preset: 'standard', config: overrides });
  }

  static forPermissive(overrides?: Partial<PreScannerConfig>): PreScanner {
    return new PreScanner({ preset: 'permissive', config: overrides });
  }
}

/**
 * Convenience function to scan source code with default settings.
 *
 * @param source - The source code to scan
 * @param preset - Optional preset level (default: 'standard')
 * @returns Scan result
 *
 * @example
 * ```typescript
 * const result = preScan(code);
 * if (!result.success) {
 *   throw new Error(result.fatalIssue?.message);
 * }
 * ```
 */
export function preScan(source: string, preset?: PreScannerPresetLevel): PreScanResult {
  const scanner = new PreScanner({ preset });
  return scanner.scan(source);
}

/**
 * Convenience function for quick validation.
 *
 * @param source - The source code to validate
 * @param preset - Optional preset level (default: 'standard')
 * @returns true if source passes validation
 */
export function isPreScanValid(source: string, preset?: PreScannerPresetLevel): boolean {
  const scanner = new PreScanner({ preset });
  return scanner.quickValidate(source);
}
