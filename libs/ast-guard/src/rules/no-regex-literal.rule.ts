import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';
import { analyzeForReDoS, REDOS_THRESHOLDS } from '../pre-scanner/checks/regex-check';

/**
 * Options for the NoRegexLiteralRule
 */
export interface NoRegexLiteralOptions {
  /**
   * Block all regex literals regardless of content.
   * Use this for maximum security (AgentScript preset).
   * Default: false
   */
  blockAll?: boolean;

  /**
   * Analyze regex patterns for ReDoS vulnerabilities.
   * Patterns scoring above the threshold will be blocked.
   * Default: true (when blockAll is false)
   */
  analyzePatterns?: boolean;

  /**
   * ReDoS analysis level.
   * - 'catastrophic': Only detect exponential patterns (e.g., (a+)+)
   * - 'polynomial': Also detect polynomial patterns (e.g., .*a.*b)
   * Default: 'catastrophic'
   */
  analysisLevel?: 'catastrophic' | 'polynomial';

  /**
   * Vulnerability score threshold for blocking.
   * Patterns with scores >= this value will be blocked.
   * Default: 80 (REDOS_THRESHOLDS.BLOCK)
   */
  blockThreshold?: number;

  /**
   * Vulnerability score threshold for warnings.
   * Patterns with scores >= this value will generate warnings.
   * Default: 50 (REDOS_THRESHOLDS.WARN)
   */
  warnThreshold?: number;

  /**
   * Maximum regex pattern length.
   * Patterns longer than this will be blocked.
   * Default: 200
   */
  maxPatternLength?: number;

  /**
   * Whitelist of allowed patterns (exact match or regex).
   * These patterns bypass analysis.
   * Example: ['^[a-z]+$', /^\d{4}-\d{2}-\d{2}$/]
   */
  allowedPatterns?: (string | RegExp)[];
}

/**
 * Rule that blocks or analyzes regex literals for security vulnerabilities.
 *
 * This rule provides defense against ReDoS (Regular Expression Denial of Service)
 * attacks by:
 * 1. Optionally blocking all regex literals (for high-security environments)
 * 2. Analyzing patterns for catastrophic backtracking vulnerabilities
 * 3. Limiting pattern length to prevent complexity attacks
 *
 * @example
 * ```typescript
 * // Block all regex (AgentScript preset)
 * new NoRegexLiteralRule({ blockAll: true })
 *
 * // Analyze patterns (Strict/Secure preset)
 * new NoRegexLiteralRule({
 *   analyzePatterns: true,
 *   analysisLevel: 'catastrophic',
 * })
 *
 * // Allow specific patterns
 * new NoRegexLiteralRule({
 *   analyzePatterns: true,
 *   allowedPatterns: ['^[a-z]+$', /^\d+$/],
 * })
 * ```
 */
export class NoRegexLiteralRule implements ValidationRule {
  readonly name = 'no-regex-literal';
  readonly description = 'Blocks or analyzes regex literals for security vulnerabilities';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false; // Enabled via presets

  private readonly options: Required<Omit<NoRegexLiteralOptions, 'allowedPatterns'>> & {
    allowedPatterns: (string | RegExp)[];
  };

  constructor(options: NoRegexLiteralOptions = {}) {
    this.options = {
      blockAll: options.blockAll ?? false,
      analyzePatterns: options.analyzePatterns ?? true,
      analysisLevel: options.analysisLevel ?? 'catastrophic',
      blockThreshold: options.blockThreshold ?? REDOS_THRESHOLDS.BLOCK,
      warnThreshold: options.warnThreshold ?? REDOS_THRESHOLDS.WARN,
      maxPatternLength: options.maxPatternLength ?? 200,
      allowedPatterns: options.allowedPatterns ?? [],
    };
  }

  validate(context: ValidationContext): void {
    walk.simple(context.ast as any, {
      // Handle regex literals: /pattern/flags
      Literal: (node: any) => {
        if (node.regex) {
          this.checkRegex(node, node.regex.pattern, node.regex.flags, context);
        }
      },

      // Handle new RegExp() constructor calls
      NewExpression: (node: any) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
          // Get pattern from first argument if it's a string literal
          const patternArg = node.arguments[0];
          if (patternArg?.type === 'Literal' && typeof patternArg.value === 'string') {
            const flagsArg = node.arguments[1];
            const flags = flagsArg?.type === 'Literal' && typeof flagsArg.value === 'string' ? flagsArg.value : '';
            this.checkRegex(node, patternArg.value, flags, context);
          } else if (patternArg?.type === 'TemplateLiteral') {
            // Template literal - can't analyze statically, block if blockAll is true
            if (this.options.blockAll) {
              context.report({
                code: 'NO_REGEX_LITERAL',
                message: 'Dynamic RegExp constructor with template literal is not allowed in this security mode',
                location: this.getLocation(node),
              });
            } else {
              context.report({
                code: 'REGEX_DYNAMIC_PATTERN',
                severity: ValidationSeverity.WARNING,
                message: 'RegExp constructor with dynamic pattern cannot be analyzed for ReDoS vulnerabilities',
                location: this.getLocation(node),
              });
            }
          }
        }
      },

      // Handle RegExp() without new (still creates a regex)
      CallExpression: (node: any) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
          const patternArg = node.arguments[0];
          if (patternArg?.type === 'Literal' && typeof patternArg.value === 'string') {
            const flagsArg = node.arguments[1];
            const flags = flagsArg?.type === 'Literal' && typeof flagsArg.value === 'string' ? flagsArg.value : '';
            this.checkRegex(node, patternArg.value, flags, context);
          } else if (patternArg?.type === 'TemplateLiteral') {
            if (this.options.blockAll) {
              context.report({
                code: 'NO_REGEX_LITERAL',
                message: 'Dynamic RegExp call with template literal is not allowed in this security mode',
                location: this.getLocation(node),
              });
            } else {
              context.report({
                code: 'REGEX_DYNAMIC_PATTERN',
                severity: ValidationSeverity.WARNING,
                message: 'RegExp call with dynamic pattern cannot be analyzed for ReDoS vulnerabilities',
                location: this.getLocation(node),
              });
            }
          }
        }
      },
    });
  }

  private checkRegex(node: any, pattern: string, flags: string, context: ValidationContext): void {
    const location = this.getLocation(node);

    // Block all regex if configured
    if (this.options.blockAll) {
      const truncated = pattern.length > 50 ? pattern.slice(0, 50) + '...' : pattern;
      context.report({
        code: 'NO_REGEX_LITERAL',
        message: `Regex literals are not allowed in this security mode: /${truncated}/${flags}`,
        location,
        data: { pattern, flags },
      });
      return;
    }

    // Check if pattern is whitelisted
    if (this.isAllowedPattern(pattern)) {
      return;
    }

    // Check pattern length
    if (pattern.length > this.options.maxPatternLength) {
      context.report({
        code: 'REGEX_TOO_LONG',
        message: `Regex pattern length (${pattern.length}) exceeds maximum (${this.options.maxPatternLength})`,
        location,
        data: { patternLength: pattern.length, maxLength: this.options.maxPatternLength },
      });
      return;
    }

    // Analyze for ReDoS if enabled
    if (this.options.analyzePatterns) {
      const analysis = analyzeForReDoS(pattern, this.options.analysisLevel);

      if (analysis.score >= this.options.blockThreshold) {
        context.report({
          code: 'REGEX_REDOS_VULNERABLE',
          message: `ReDoS vulnerability detected (${analysis.vulnerabilityType}): ${analysis.explanation}`,
          location,
          data: {
            pattern,
            flags,
            score: analysis.score,
            vulnerabilityType: analysis.vulnerabilityType,
          },
        });
      } else if (analysis.score >= this.options.warnThreshold) {
        context.report({
          code: 'REGEX_REDOS_SUSPICIOUS',
          severity: ValidationSeverity.WARNING,
          message: `Potentially dangerous regex pattern (${analysis.vulnerabilityType}): review for ReDoS vulnerability`,
          location,
          data: {
            pattern,
            flags,
            score: analysis.score,
            vulnerabilityType: analysis.vulnerabilityType,
          },
        });
      }
    }
  }

  private isAllowedPattern(pattern: string): boolean {
    return this.options.allowedPatterns.some((allowed) => {
      if (typeof allowed === 'string') {
        return pattern === allowed;
      }
      return allowed.test(pattern);
    });
  }

  private getLocation(node: any): { line: number; column: number } | undefined {
    return node.loc
      ? {
          line: node.loc.start.line,
          column: node.loc.start.column,
        }
      : undefined;
  }
}
