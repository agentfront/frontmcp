import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Options for the NoRegexMethodsRule
 */
export interface NoRegexMethodsOptions {
  /**
   * Methods to block on strings.
   * These methods accept regex as arguments.
   * Default: ['match', 'matchAll', 'search', 'replace', 'replaceAll', 'split']
   */
  blockedStringMethods?: string[];

  /**
   * Methods to block on regex objects.
   * These methods execute regex matching.
   * Default: ['test', 'exec']
   */
  blockedRegexMethods?: string[];

  /**
   * Allow methods when the first argument is a string literal (not regex).
   * For example: "hello".split(",") is safe.
   * Default: true
   */
  allowStringArguments?: boolean;

  /**
   * Custom error message template.
   * Placeholders: {method}
   */
  messageTemplate?: string;
}

/**
 * Default methods that accept regex on strings
 */
const DEFAULT_STRING_METHODS = [
  'match', // str.match(regex)
  'matchAll', // str.matchAll(regex)
  'search', // str.search(regex)
  'replace', // str.replace(regex, replacement)
  'replaceAll', // str.replaceAll(regex, replacement)
  'split', // str.split(regex)
];

/**
 * Default methods on regex objects
 */
const DEFAULT_REGEX_METHODS = [
  'test', // regex.test(str)
  'exec', // regex.exec(str)
];

/**
 * Rule that blocks regex method calls to prevent ReDoS attacks.
 *
 * Even if regex literals are blocked, an attacker could potentially
 * construct regex through other means and use these methods. This rule
 * provides defense-in-depth by blocking the execution paths.
 *
 * **Blocked patterns:**
 * - `string.match(regex)`
 * - `string.matchAll(regex)`
 * - `string.search(regex)`
 * - `string.replace(regex, ...)`
 * - `string.replaceAll(regex, ...)`
 * - `string.split(regex)`
 * - `regex.test(string)`
 * - `regex.exec(string)`
 *
 * **Allowed (when allowStringArguments is true):**
 * - `"hello".split(",")` - string argument, not regex
 * - `"hello".replace("l", "x")` - string argument
 *
 * @example
 * ```typescript
 * // Block all regex methods (AgentScript preset)
 * new NoRegexMethodsRule()
 *
 * // Allow string arguments
 * new NoRegexMethodsRule({ allowStringArguments: true })
 *
 * // Custom blocked methods
 * new NoRegexMethodsRule({
 *   blockedStringMethods: ['match', 'replace'],
 *   blockedRegexMethods: ['test'],
 * })
 * ```
 */
export class NoRegexMethodsRule implements ValidationRule {
  readonly name = 'no-regex-methods';
  readonly description = 'Blocks regex method calls to prevent ReDoS attacks';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false; // Enabled via presets

  private readonly blockedStringMethods: Set<string>;
  private readonly blockedRegexMethods: Set<string>;
  private readonly allowStringArguments: boolean;
  private readonly messageTemplate: string;

  constructor(options: NoRegexMethodsOptions = {}) {
    this.blockedStringMethods = new Set(options.blockedStringMethods ?? DEFAULT_STRING_METHODS);
    this.blockedRegexMethods = new Set(options.blockedRegexMethods ?? DEFAULT_REGEX_METHODS);
    this.allowStringArguments = options.allowStringArguments ?? true;
    this.messageTemplate = options.messageTemplate ?? 'Use of .{method}() with regex is not allowed (ReDoS risk)';
  }

  validate(context: ValidationContext): void {
    walk.simple(context.ast as any, {
      CallExpression: (node: any) => {
        this.checkMethodCall(node, context);
      },
    });
  }

  private checkMethodCall(node: any, context: ValidationContext): void {
    const callee = node.callee;

    // Only check member expressions: obj.method()
    if (callee.type !== 'MemberExpression') {
      return;
    }

    // Get method name
    const methodName = this.getMethodName(callee);
    if (!methodName) {
      return;
    }

    // Check string methods (e.g., str.match, str.replace)
    if (this.blockedStringMethods.has(methodName)) {
      // If allowing string arguments, check the first argument
      if (this.allowStringArguments && this.hasStringArgument(node)) {
        return; // Safe - using string, not regex
      }

      // Check if argument is a regex literal or RegExp constructor
      if (this.hasRegexArgument(node)) {
        this.report(node, methodName, context);
        return;
      }

      // For dynamic arguments, we need to be cautious
      // If we can't prove it's safe, report a warning
      if (!this.hasStringArgument(node) && node.arguments.length > 0) {
        context.report({
          code: 'REGEX_METHOD_DYNAMIC',
          severity: ValidationSeverity.WARNING,
          message: `Call to .${methodName}() with dynamic argument - ensure argument is not a regex (ReDoS risk)`,
          location: this.getLocation(callee),
          data: { method: methodName },
        });
      }
    }

    // Check regex object methods (e.g., /pattern/.test, regex.exec)
    if (this.blockedRegexMethods.has(methodName)) {
      // Check if caller is a regex literal
      if (this.isRegexLiteral(callee.object)) {
        this.report(node, methodName, context);
        return;
      }

      // Check if caller might be a regex (we can't always tell statically)
      // Report a warning for dynamic cases
      if (!this.isStringLiteral(callee.object)) {
        context.report({
          code: 'REGEX_METHOD_DYNAMIC',
          severity: ValidationSeverity.WARNING,
          message: `Call to .${methodName}() - ensure object is not a regex (ReDoS risk)`,
          location: this.getLocation(callee),
          data: { method: methodName },
        });
      }
    }
  }

  private getMethodName(callee: any): string | null {
    // obj.method() - identifier property
    if (callee.property?.type === 'Identifier') {
      return callee.property.name;
    }

    // obj['method']() - literal property
    if (callee.property?.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value;
    }

    return null;
  }

  private hasStringArgument(node: any): boolean {
    const firstArg = node.arguments[0];
    if (!firstArg) return false;

    // Direct string literal
    if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
      return true;
    }

    // Template literal without expressions
    if (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0) {
      return true;
    }

    return false;
  }

  private hasRegexArgument(node: any): boolean {
    const firstArg = node.arguments[0];
    if (!firstArg) return false;

    // Regex literal: /pattern/
    if (firstArg.type === 'Literal' && firstArg.regex) {
      return true;
    }

    // new RegExp() or RegExp()
    if (
      (firstArg.type === 'NewExpression' || firstArg.type === 'CallExpression') &&
      firstArg.callee?.type === 'Identifier' &&
      firstArg.callee?.name === 'RegExp'
    ) {
      return true;
    }

    return false;
  }

  private isRegexLiteral(node: any): boolean {
    return node?.type === 'Literal' && node.regex;
  }

  private isStringLiteral(node: any): boolean {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
      return true;
    }
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return true;
    }
    return false;
  }

  private report(node: any, methodName: string, context: ValidationContext): void {
    context.report({
      code: 'NO_REGEX_METHOD',
      message: this.messageTemplate.replace('{method}', methodName),
      location: this.getLocation(node.callee),
      data: { method: methodName },
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
