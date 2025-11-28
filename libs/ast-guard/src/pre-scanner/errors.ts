/**
 * Error classes for the pre-scanner module.
 * These errors are thrown BEFORE AST parsing when security issues are detected.
 *
 * @module pre-scanner/errors
 */

import { AstGuardError } from '../errors';

/**
 * Error codes for pre-scanner issues.
 * These codes identify specific security concerns detected during pre-scanning.
 */
export const PRESCANNER_ERROR_CODES = {
  /** Input exceeds size limit */
  INPUT_TOO_LARGE: 'PRESCANNER_INPUT_TOO_LARGE',
  /** Line exceeds maximum length */
  LINE_TOO_LONG: 'PRESCANNER_LINE_TOO_LONG',
  /** Too many lines in input */
  TOO_MANY_LINES: 'PRESCANNER_TOO_MANY_LINES',
  /** Null byte detected (binary/attack indicator) */
  NULL_BYTE_DETECTED: 'PRESCANNER_NULL_BYTE',
  /** Bracket nesting exceeds limit */
  EXCESSIVE_NESTING: 'PRESCANNER_NESTING_OVERFLOW',
  /** Consecutive operators exceed limit */
  EXCESSIVE_OPERATORS: 'PRESCANNER_OPERATOR_SPAM',
  /** Regex literal detected (blocked in strict mode) */
  REGEX_BLOCKED: 'PRESCANNER_REGEX_BLOCKED',
  /** ReDoS vulnerability detected in regex */
  REGEX_REDOS_DETECTED: 'PRESCANNER_REDOS',
  /** Regex pattern too long */
  REGEX_TOO_LONG: 'PRESCANNER_REGEX_TOO_LONG',
  /** Too many regex literals */
  REGEX_COUNT_EXCEEDED: 'PRESCANNER_REGEX_COUNT',
  /** String literal too long */
  STRING_TOO_LONG: 'PRESCANNER_STRING_TOO_LONG',
  /** Total string content exceeds limit */
  STRING_TOTAL_EXCEEDED: 'PRESCANNER_STRING_TOTAL',
  /** BiDi/Trojan Source attack detected */
  BIDI_ATTACK: 'PRESCANNER_BIDI_ATTACK',
  /** Suspicious Unicode characters detected */
  UNICODE_SUSPICIOUS: 'PRESCANNER_UNICODE_SUSPICIOUS',
  /** Homograph attack detected */
  HOMOGRAPH_ATTACK: 'PRESCANNER_HOMOGRAPH',
} as const;

/**
 * Type for pre-scanner error codes
 */
export type PreScannerErrorCode = (typeof PRESCANNER_ERROR_CODES)[keyof typeof PRESCANNER_ERROR_CODES];

/**
 * Details provided with pre-scanner errors
 */
export interface PreScannerErrorDetails {
  /** Position in source where issue was found */
  position?: number;
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
  /** Actual value that triggered the error */
  actual?: number | string;
  /** The limit that was exceeded */
  limit?: number;
  /** The pattern that was detected (for regex/unicode issues) */
  pattern?: string;
  /** Additional context */
  context?: string;
}

/**
 * Error thrown during pre-scanning when a security issue is detected.
 * This error is thrown BEFORE the AST parser runs, providing
 * defense-in-depth against parser-level attacks.
 *
 * @example
 * ```typescript
 * throw new PreScannerError(
 *   'Input size (150MB) exceeds maximum allowed (100MB)',
 *   PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE,
 *   { actual: 157286400, limit: 104857600 }
 * );
 * ```
 */
export class PreScannerError extends AstGuardError {
  /**
   * The specific error code identifying the issue type
   */
  readonly errorCode: PreScannerErrorCode;

  /**
   * Additional details about the error
   */
  readonly details: PreScannerErrorDetails;

  constructor(message: string, errorCode: PreScannerErrorCode, details: PreScannerErrorDetails = {}) {
    super(message, errorCode);
    this.name = 'PreScannerError';
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, PreScannerError.prototype);
  }

  /**
   * Returns a structured representation of the error for logging/reporting
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.errorCode,
      message: this.message,
      details: this.details,
    };
  }

  /**
   * Creates a formatted error message with location information
   */
  formatWithLocation(): string {
    const parts = [this.message];

    if (this.details.line !== undefined) {
      parts.push(`at line ${this.details.line}`);
      if (this.details.column !== undefined) {
        parts[parts.length - 1] += `:${this.details.column}`;
      }
    } else if (this.details.position !== undefined) {
      parts.push(`at position ${this.details.position}`);
    }

    return parts.join(' ');
  }
}

/**
 * Error thrown when ReDoS vulnerability is detected in a regex pattern
 */
export class ReDoSError extends PreScannerError {
  /**
   * The vulnerability score (0-100, higher = more dangerous)
   */
  readonly vulnerabilityScore: number;

  /**
   * The type of ReDoS pattern detected
   */
  readonly patternType: string;

  constructor(
    message: string,
    details: PreScannerErrorDetails & {
      vulnerabilityScore: number;
      patternType: string;
    },
  ) {
    super(message, PRESCANNER_ERROR_CODES.REGEX_REDOS_DETECTED, details);
    this.name = 'ReDoSError';
    this.vulnerabilityScore = details.vulnerabilityScore;
    this.patternType = details.patternType;
    Object.setPrototypeOf(this, ReDoSError.prototype);
  }
}

/**
 * Error thrown when BiDi/Trojan Source attack is detected
 */
export class BiDiAttackError extends PreScannerError {
  /**
   * The type of BiDi attack detected
   */
  readonly attackType: 'trojan_source' | 'invisible_chars' | 'direction_override';

  constructor(
    message: string,
    attackType: 'trojan_source' | 'invisible_chars' | 'direction_override',
    details: PreScannerErrorDetails = {},
  ) {
    super(message, PRESCANNER_ERROR_CODES.BIDI_ATTACK, details);
    this.name = 'BiDiAttackError';
    this.attackType = attackType;
    Object.setPrototypeOf(this, BiDiAttackError.prototype);
  }
}

/**
 * Factory functions for creating common pre-scanner errors
 */
export const PreScannerErrors = {
  inputTooLarge(actual: number, limit: number): PreScannerError {
    return new PreScannerError(
      `Input size (${formatBytes(actual)}) exceeds maximum allowed (${formatBytes(limit)})`,
      PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE,
      { actual, limit },
    );
  },

  lineTooLong(line: number, length: number, limit: number): PreScannerError {
    return new PreScannerError(
      `Line ${line} length (${length}) exceeds maximum allowed (${limit})`,
      PRESCANNER_ERROR_CODES.LINE_TOO_LONG,
      { line, actual: length, limit },
    );
  },

  tooManyLines(actual: number, limit: number): PreScannerError {
    return new PreScannerError(
      `File has ${actual} lines, exceeding maximum allowed (${limit})`,
      PRESCANNER_ERROR_CODES.TOO_MANY_LINES,
      { actual, limit },
    );
  },

  nullByteDetected(position: number): PreScannerError {
    return new PreScannerError(
      `Null byte (\\x00) detected at position ${position}. This may indicate binary data or an attack.`,
      PRESCANNER_ERROR_CODES.NULL_BYTE_DETECTED,
      { position },
    );
  },

  excessiveNesting(depth: number, limit: number, position: number): PreScannerError {
    return new PreScannerError(
      `Bracket nesting depth (${depth}) exceeds maximum allowed (${limit})`,
      PRESCANNER_ERROR_CODES.EXCESSIVE_NESTING,
      { actual: depth, limit, position },
    );
  },

  regexBlocked(pattern: string, position: number, line?: number): PreScannerError {
    const truncated = pattern.length > 50 ? pattern.slice(0, 50) + '...' : pattern;
    return new PreScannerError(
      `Regex literals are blocked in this security mode: /${truncated}/`,
      PRESCANNER_ERROR_CODES.REGEX_BLOCKED,
      { pattern, position, line },
    );
  },

  regexTooLong(length: number, limit: number, position: number): PreScannerError {
    return new PreScannerError(
      `Regex pattern length (${length}) exceeds maximum allowed (${limit})`,
      PRESCANNER_ERROR_CODES.REGEX_TOO_LONG,
      { actual: length, limit, position },
    );
  },

  regexCountExceeded(count: number, limit: number): PreScannerError {
    return new PreScannerError(
      `Number of regex literals (${count}) exceeds maximum allowed (${limit})`,
      PRESCANNER_ERROR_CODES.REGEX_COUNT_EXCEEDED,
      { actual: count, limit },
    );
  },

  redosDetected(pattern: string, patternType: string, score: number, position: number): ReDoSError {
    return new ReDoSError(`ReDoS vulnerability detected in regex: ${patternType} pattern found`, {
      pattern,
      position,
      vulnerabilityScore: score,
      patternType,
    });
  },

  bidiAttack(
    attackType: 'trojan_source' | 'invisible_chars' | 'direction_override',
    position: number,
    line?: number,
  ): BiDiAttackError {
    const messages = {
      trojan_source: 'Trojan Source attack detected: Unicode direction override characters found',
      invisible_chars: 'Suspicious invisible Unicode characters detected',
      direction_override: 'Unicode BiDi direction override attack detected',
    };
    return new BiDiAttackError(messages[attackType], attackType, { position, line });
  },
} as const;

/**
 * Helper to format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
