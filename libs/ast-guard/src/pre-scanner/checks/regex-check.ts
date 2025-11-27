/**
 * Regex detection and ReDoS analysis for the pre-scanner.
 * Detects regex literals and analyzes them for catastrophic backtracking.
 *
 * @module pre-scanner/checks/regex-check
 */

import type { PreScannerConfig } from '../config';
import type { ScanState, DetectedRegex } from '../scan-state';
import { PRESCANNER_ERROR_CODES } from '../errors';

/**
 * ReDoS pattern types and their vulnerability scores
 */
export const REDOS_PATTERNS = {
  /** Nested quantifiers: (a+)+ */
  NESTED_QUANTIFIER: { name: 'nested_quantifier', baseScore: 90 },
  /** Overlapping alternation: (a|a)+ */
  OVERLAPPING_ALTERNATION: { name: 'overlapping_alternation', baseScore: 80 },
  /** Greedy backtracking: (.*a)+ */
  GREEDY_BACKTRACKING: { name: 'greedy_backtracking', baseScore: 75 },
  /** Multiple greedy: .*.*  */
  MULTIPLE_GREEDY: { name: 'multiple_greedy', baseScore: 70 },
  /** Repetition inside star: (a{2,})+ */
  REPETITION_IN_STAR: { name: 'repetition_in_star', baseScore: 85 },
  /** Star inside repetition: (a+){2,} */
  STAR_IN_REPETITION: { name: 'star_in_repetition', baseScore: 85 },
  /** Overlapping character classes: [a-z]+[a-z]+ */
  OVERLAPPING_CLASSES: { name: 'overlapping_classes', baseScore: 50 },
} as const;

/**
 * Thresholds for ReDoS detection
 */
export const REDOS_THRESHOLDS = {
  /** Block immediately - critical vulnerability */
  BLOCK: 80,
  /** Warn but allow - suspicious pattern */
  WARN: 50,
  /** Safe - no detected issues */
  SAFE: 0,
} as const;

/**
 * JavaScript keywords that can be followed by a regex literal.
 * These keywords complete a statement or expression, so / after them is a regex, not division.
 */
const REGEX_KEYWORD_PREFIXES = new Set([
  'return',
  'throw',
  'case',
  'typeof',
  'void',
  'delete',
  'in',
  'instanceof',
  'new',
  'yield',
  'await',
]);

/**
 * Result of ReDoS analysis for a single pattern
 */
export interface ReDoSAnalysisResult {
  /** The analyzed pattern */
  pattern: string;
  /** Is the pattern vulnerable? */
  vulnerable: boolean;
  /** Vulnerability score (0-100) */
  score: number;
  /** Type of vulnerability detected */
  vulnerabilityType?: string;
  /** Human-readable explanation */
  explanation?: string;
}

/**
 * Detect regex literals in source code.
 * This uses a simplified heuristic approach that may have false positives/negatives
 * but is safe for security purposes (may block valid code, won't allow attacks).
 *
 * @param source - The source code to scan
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function detectRegexLiterals(source: string, config: PreScannerConfig, state: ScanState): void {
  // If regex mode is 'allow', skip detection entirely
  if (config.regexMode === 'allow') {
    return;
  }

  const regexes = findRegexLiterals(source);

  // Check regex count limit
  const maxCount = config.maxRegexCount ?? 20;
  if (regexes.length > maxCount) {
    state.reportFatalError({
      code: PRESCANNER_ERROR_CODES.REGEX_COUNT_EXCEEDED,
      message: `Number of regex literals (${regexes.length}) exceeds maximum allowed (${maxCount})`,
      data: { actual: regexes.length, limit: maxCount },
    });
    return;
  }

  // Process each regex
  for (const regex of regexes) {
    // Check if regex should be blocked entirely
    if (config.regexMode === 'block') {
      state.reportFatalError({
        code: PRESCANNER_ERROR_CODES.REGEX_BLOCKED,
        message: `Regex literals are blocked in this security mode: /${truncate(regex.pattern, 50)}/`,
        position: regex.position,
        line: regex.line,
        data: { pattern: regex.pattern },
      });
      return;
    }

    // Check regex length
    const maxLength = config.maxRegexLength ?? 200;
    if (regex.pattern.length > maxLength) {
      state.reportFatalError({
        code: PRESCANNER_ERROR_CODES.REGEX_TOO_LONG,
        message: `Regex pattern length (${regex.pattern.length}) exceeds maximum allowed (${maxLength})`,
        position: regex.position,
        data: { actual: regex.pattern.length, limit: maxLength },
      });
      return;
    }

    // Analyze for ReDoS (in 'analyze' mode)
    const analysis = analyzeForReDoS(regex.pattern, config.regexAnalysisLevel ?? 'catastrophic');

    // Record the detected regex
    state.addRegex({
      pattern: regex.pattern,
      flags: regex.flags,
      position: regex.position,
      line: regex.line,
      vulnerabilityScore: analysis.score,
      vulnerabilityType: analysis.vulnerabilityType,
    });

    // Report based on score
    if (analysis.score >= REDOS_THRESHOLDS.BLOCK) {
      state.reportFatalError({
        code: PRESCANNER_ERROR_CODES.REGEX_REDOS_DETECTED,
        message: `ReDoS vulnerability detected: ${analysis.vulnerabilityType} in /${truncate(regex.pattern, 50)}/`,
        position: regex.position,
        line: regex.line,
        data: {
          pattern: regex.pattern,
          score: analysis.score,
          type: analysis.vulnerabilityType,
          explanation: analysis.explanation,
        },
      });
      return;
    } else if (analysis.score >= REDOS_THRESHOLDS.WARN) {
      state.reportWarning({
        code: PRESCANNER_ERROR_CODES.REGEX_REDOS_DETECTED,
        message: `Suspicious regex pattern: ${analysis.vulnerabilityType} in /${truncate(regex.pattern, 50)}/`,
        position: regex.position,
        line: regex.line,
        data: {
          pattern: regex.pattern,
          score: analysis.score,
          type: analysis.vulnerabilityType,
        },
      });
    }
  }
}

/**
 * Find regex literals in source code.
 * Returns position, line, pattern, and flags for each.
 */
function findRegexLiterals(source: string): Array<{
  pattern: string;
  flags: string;
  position: number;
  line: number;
}> {
  const results: Array<{ pattern: string; flags: string; position: number; line: number }> = [];

  let inString: string | null = null;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  let line = 1;

  // Track context to distinguish regex from division
  let lastSignificantToken: 'operator' | 'identifier' | 'number' | 'close' | 'other' = 'other';
  // Buffer for tracking identifier/keyword being scanned
  let identifierBuffer = '';

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const nextChar = source[i + 1];

    // Track line numbers
    if (char === '\n') {
      line++;
      inLineComment = false;
      continue;
    }

    // Handle escape
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && (inString || inTemplateString)) {
      escaped = true;
      continue;
    }

    // Skip comments
    if (inLineComment) continue;

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    // Check comment start
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
    }

    // Handle strings
    if (inTemplateString) {
      if (char === '`') inTemplateString = false;
      continue;
    }

    if (inString) {
      if (char === inString) inString = null;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      lastSignificantToken = 'other';
      continue;
    }

    if (char === '`') {
      inTemplateString = true;
      lastSignificantToken = 'other';
      continue;
    }

    // Potential regex literal
    if (char === '/') {
      // Division vs regex heuristic:
      // Regex follows: return, =, (, [, {, ,, ;, :, !, &, |, ?, +, -, ~, typeof, void, in, delete
      // Division follows: identifier, number, ), ]
      if (
        lastSignificantToken !== 'identifier' &&
        lastSignificantToken !== 'number' &&
        lastSignificantToken !== 'close'
      ) {
        // Try to parse as regex
        const regexResult = tryParseRegex(source, i);
        if (regexResult) {
          results.push({
            pattern: regexResult.pattern,
            flags: regexResult.flags,
            position: i,
            line,
          });
          i = regexResult.endIndex;
          lastSignificantToken = 'other';
          continue;
        }
      }
      lastSignificantToken = 'operator';
      continue;
    }

    // Track token types for regex vs division detection
    if (isIdentifierChar(char)) {
      identifierBuffer += char;
    } else {
      // Check if the completed identifier is a keyword that allows regex
      if (identifierBuffer) {
        if (REGEX_KEYWORD_PREFIXES.has(identifierBuffer)) {
          lastSignificantToken = 'other'; // Allows regex after keyword
        } else {
          lastSignificantToken = 'identifier'; // Regular identifier
        }
        identifierBuffer = '';
      }
      // Handle other token types
      if (isDigit(char)) {
        lastSignificantToken = 'number';
      } else if (char === ')' || char === ']') {
        lastSignificantToken = 'close';
      } else if (isOperator(char)) {
        lastSignificantToken = 'operator';
      } else if (!isWhitespace(char)) {
        lastSignificantToken = 'other';
      }
    }
  }

  return results;
}

/**
 * Try to parse a regex literal starting at position
 */
function tryParseRegex(source: string, start: number): { pattern: string; flags: string; endIndex: number } | null {
  if (source[start] !== '/') return null;

  let pattern = '';
  let escaped = false;
  let inCharClass = false;
  let i = start + 1;

  // Parse pattern
  while (i < source.length) {
    const char = source[i];

    if (escaped) {
      pattern += char;
      escaped = false;
      i++;
      continue;
    }

    if (char === '\\') {
      pattern += char;
      escaped = true;
      i++;
      continue;
    }

    if (char === '[') {
      inCharClass = true;
      pattern += char;
      i++;
      continue;
    }

    if (char === ']' && inCharClass) {
      inCharClass = false;
      pattern += char;
      i++;
      continue;
    }

    if (char === '/' && !inCharClass) {
      // End of pattern
      i++;
      break;
    }

    if (char === '\n' || char === '\r') {
      // Invalid - newline in regex
      return null;
    }

    pattern += char;
    i++;
  }

  // Empty pattern or unclosed - invalid
  if (pattern.length === 0 || source[i - 1] !== '/') {
    return null;
  }

  // Parse flags (includes ES2022 'd' indices and ES2024 'v' unicodeSets)
  let flags = '';
  while (i < source.length && /[dgimsuyv]/.test(source[i])) {
    flags += source[i];
    i++;
  }

  return { pattern, flags, endIndex: i - 1 };
}

/**
 * Analyze a regex pattern for ReDoS vulnerabilities.
 * Uses static analysis to detect dangerous patterns.
 */
export function analyzeForReDoS(pattern: string, level: 'catastrophic' | 'polynomial'): ReDoSAnalysisResult {
  let maxScore = 0;
  let detectedType: string | undefined;
  let explanation: string | undefined;

  // Check for nested quantifiers: (a+)+, (a*)+, (a+)*, etc.
  // This is the most common ReDoS pattern
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern) || /\([^)]*[+*]\)[+*]/.test(pattern)) {
    const score = REDOS_PATTERNS.NESTED_QUANTIFIER.baseScore;
    if (score > maxScore) {
      maxScore = score;
      detectedType = REDOS_PATTERNS.NESTED_QUANTIFIER.name;
      explanation = 'Nested quantifiers cause exponential backtracking';
    }
  }

  // Check for (.+)+ or (.*)+
  if (/\(\.\*\)[+*]|\(\.\+\)[+*]/.test(pattern)) {
    const score = REDOS_PATTERNS.NESTED_QUANTIFIER.baseScore + 5;
    if (score > maxScore) {
      maxScore = score;
      detectedType = REDOS_PATTERNS.NESTED_QUANTIFIER.name;
      explanation = 'Wildcard with nested quantifier causes severe backtracking';
    }
  }

  // Check for repetition inside star: (a{2,})+
  if (/\([^)]*\{\d+,\}[^)]*\)[+*]/.test(pattern)) {
    const score = REDOS_PATTERNS.REPETITION_IN_STAR.baseScore;
    if (score > maxScore) {
      maxScore = score;
      detectedType = REDOS_PATTERNS.REPETITION_IN_STAR.name;
      explanation = 'Repetition quantifier inside star causes exponential backtracking';
    }
  }

  // Check for star inside repetition: (a+){2,}
  if (/\([^)]*[+*][^)]*\)\{\d+,\}/.test(pattern)) {
    const score = REDOS_PATTERNS.STAR_IN_REPETITION.baseScore;
    if (score > maxScore) {
      maxScore = score;
      detectedType = REDOS_PATTERNS.STAR_IN_REPETITION.name;
      explanation = 'Star quantifier inside repetition causes exponential backtracking';
    }
  }

  // Check for overlapping alternation: (a|a)+, (a|ab)+
  // Simplified check - looks for repeated patterns in alternation
  const altMatch = pattern.match(/\(([^|)]+)\|([^)]+)\)[+*]/);
  if (altMatch) {
    const [, left, right] = altMatch;
    if (left === right || left.startsWith(right) || right.startsWith(left)) {
      const score = REDOS_PATTERNS.OVERLAPPING_ALTERNATION.baseScore;
      if (score > maxScore) {
        maxScore = score;
        detectedType = REDOS_PATTERNS.OVERLAPPING_ALTERNATION.name;
        explanation = 'Overlapping alternatives cause exponential backtracking';
      }
    }
  }

  // Polynomial-level checks (less severe but still problematic)
  if (level === 'polynomial') {
    // Multiple greedy quantifiers: .*foo.*bar
    if (/\.\*.*\.\*/.test(pattern) || /\.\+.*\.\+/.test(pattern)) {
      const score = REDOS_PATTERNS.MULTIPLE_GREEDY.baseScore;
      if (score > maxScore) {
        maxScore = score;
        detectedType = REDOS_PATTERNS.MULTIPLE_GREEDY.name;
        explanation = 'Multiple greedy quantifiers cause polynomial backtracking';
      }
    }

    // Greedy backtracking: (.*a)+
    if (/\(\.\*[^)]+\)[+*]|\(\.\+[^)]+\)[+*]/.test(pattern)) {
      const score = REDOS_PATTERNS.GREEDY_BACKTRACKING.baseScore;
      if (score > maxScore) {
        maxScore = score;
        detectedType = REDOS_PATTERNS.GREEDY_BACKTRACKING.name;
        explanation = 'Greedy quantifier before fixed pattern causes backtracking';
      }
    }

    // Overlapping character classes: [a-z]+[a-z]+
    if (/\[[^\]]+\][+*]\[[^\]]+\][+*]/.test(pattern)) {
      // Check if classes overlap (simplified)
      const score = REDOS_PATTERNS.OVERLAPPING_CLASSES.baseScore;
      if (score > maxScore) {
        maxScore = score;
        detectedType = REDOS_PATTERNS.OVERLAPPING_CLASSES.name;
        explanation = 'Overlapping character classes may cause backtracking';
      }
    }
  }

  return {
    pattern,
    vulnerable: maxScore >= REDOS_THRESHOLDS.WARN,
    score: maxScore,
    vulnerabilityType: detectedType,
    explanation,
  };
}

/**
 * Calculate star height (nesting depth of quantifiers).
 * Star height > 1 indicates potential vulnerability.
 *
 * Uses a group stack to properly track nested quantified groups.
 * For example, (a+)+ has star height 2:
 * - Level 1: a+ (char with quantifier)
 * - Level 2: (a+)+ (group containing quantified content, itself quantified)
 */
export function calculateStarHeight(pattern: string): number {
  let maxHeight = 0;
  const groupStack: boolean[] = []; // Track if each group level has quantified content

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '(') {
      groupStack.push(false); // Push new group, not yet containing quantified content
    } else if (char === ')') {
      const next = pattern[i + 1];
      const hasQuantifier = next === '+' || next === '*' || next === '?';

      if (hasQuantifier) {
        // Count nested quantified groups including this one
        const depth = groupStack.filter((g) => g).length + 1;
        if (depth > maxHeight) {
          maxHeight = depth;
        }
        groupStack.pop();
        // Mark parent group as containing quantified content
        if (groupStack.length > 0) {
          groupStack[groupStack.length - 1] = true;
        }
      } else {
        groupStack.pop();
      }
    } else if ((char === '+' || char === '*') && pattern[i - 1] !== ')') {
      // Direct quantifier on character within current group
      const depth = groupStack.filter((g) => g).length + 1;
      if (depth > maxHeight) {
        maxHeight = depth;
      }
      // Mark current group as containing quantified content
      if (groupStack.length > 0) {
        groupStack[groupStack.length - 1] = true;
      }
    }
  }

  return maxHeight;
}

/**
 * Perform regex checks.
 */
export function performRegexChecks(source: string, config: PreScannerConfig, state: ScanState): void {
  detectRegexLiterals(source, config, state);
}

// Helper functions
function isIdentifierChar(char: string): boolean {
  return /[a-zA-Z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function isOperator(char: string): boolean {
  return /[+\-*/%=<>!&|^~?:]/.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
