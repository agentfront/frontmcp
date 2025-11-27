/**
 * Nesting depth validation for the pre-scanner.
 * Detects excessive bracket nesting that could overflow parser stack.
 *
 * @module pre-scanner/checks/nesting-check
 */

import type { PreScannerConfig } from '../config';
import type { ScanState } from '../scan-state';
import { PRESCANNER_ERROR_CODES } from '../errors';

/**
 * Opening brackets and their matching closers
 */
const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
};

const OPENING_BRACKETS = new Set(Object.keys(BRACKET_PAIRS));
const CLOSING_BRACKETS = new Set(Object.values(BRACKET_PAIRS));

/**
 * Check bracket nesting depth.
 * This is a fast O(n) scan that tracks nesting without full parsing.
 *
 * Note: This is a heuristic check. It doesn't handle brackets in strings
 * or comments perfectly, but it catches malicious deep nesting attacks
 * which wouldn't be valid code anyway.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkNestingDepth(source: string, config: PreScannerConfig, state: ScanState): void {
  let depth = 0;
  let maxDepth = 0;
  let maxDepthPosition = 0;
  let inString: string | null = null;
  let inTemplateString = false;
  let templateDepth = 0;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const nextChar = source[i + 1];

    // Handle escape sequences in strings
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    // Handle line comments
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    // Handle block comments
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // Skip the '/'
      }
      continue;
    }

    // Check for comment start
    if (!inString && !inTemplateString && char === '/') {
      if (nextChar === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      // Could be regex literal or division - skip for nesting check
      // The regex check will handle this separately
    }

    // Handle template strings with interpolation
    if (inTemplateString) {
      if (char === '`' && !escaped) {
        inTemplateString = false;
        continue;
      }
      if (char === '$' && nextChar === '{') {
        templateDepth++;
        depth++;
        if (depth > maxDepth) {
          maxDepth = depth;
          maxDepthPosition = i;
        }
        i++;
        continue;
      }
      continue;
    }

    // Handle regular strings
    if (inString) {
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    // Start of string
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }

    // Start of template string
    if (char === '`') {
      inTemplateString = true;
      continue;
    }

    // Handle closing brace in template string interpolation
    if (templateDepth > 0 && char === '}') {
      templateDepth--;
      depth--;
      inTemplateString = true;
      continue;
    }

    // Handle brackets
    if (OPENING_BRACKETS.has(char)) {
      depth++;
      if (depth > maxDepth) {
        maxDepth = depth;
        maxDepthPosition = i;
      }

      // Check limit immediately for early termination
      if (depth > config.maxNestingDepth) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.EXCESSIVE_NESTING,
          message: `Bracket nesting depth (${depth}) exceeds maximum allowed (${config.maxNestingDepth})`,
          position: i,
          data: { actual: depth, limit: config.maxNestingDepth },
        });
        return;
      }
    } else if (CLOSING_BRACKETS.has(char)) {
      depth = Math.max(0, depth - 1); // Avoid negative depth on malformed input
    }
  }

  state.updateMaxNestingDepth(maxDepth);
}

/**
 * Check for excessive consecutive operators.
 * Catches patterns like "a++++++b" that could confuse parsers.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkConsecutiveOperators(source: string, config: PreScannerConfig, state: ScanState): void {
  // Operators that can appear consecutively in attack patterns
  const operatorChars = new Set(['+', '-', '!', '~', '*', '/', '%', '&', '|', '^', '<', '>', '=']);

  let consecutiveCount = 0;
  let consecutiveStart = 0;
  let inString = false;
  let stringChar: string | null = null;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    // Handle escape in strings
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    // Track strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      consecutiveCount = 0;
      continue;
    }

    if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      continue;
    }

    if (inString) continue;

    // Check operators
    if (operatorChars.has(char)) {
      if (consecutiveCount === 0) {
        consecutiveStart = i;
      }
      consecutiveCount++;

      if (consecutiveCount > config.maxConsecutiveOperators) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.EXCESSIVE_OPERATORS,
          message: `Consecutive operators (${consecutiveCount}) exceed maximum allowed (${config.maxConsecutiveOperators})`,
          position: consecutiveStart,
          data: { actual: consecutiveCount, limit: config.maxConsecutiveOperators },
        });
        return;
      }
    } else if (!isWhitespace(char)) {
      // Reset on non-operator, non-whitespace
      consecutiveCount = 0;
    }
  }
}

/**
 * Perform all nesting-related checks.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function performNestingChecks(source: string, config: PreScannerConfig, state: ScanState): void {
  checkNestingDepth(source, config, state);
  if (state.shouldStop()) return;

  checkConsecutiveOperators(source, config, state);
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
