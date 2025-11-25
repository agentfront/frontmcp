import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';
import { RuleConfigurationError } from '../errors';

/**
 * Options for RequiredFunctionCallRule
 */
export interface RequiredFunctionCallOptions {
  /** Names of functions that must be called at least once */
  required: string[];
  /** Minimum number of times each function must be called */
  minCalls?: number;
  /** Maximum number of times each function can be called (0 = unlimited) */
  maxCalls?: number;
  /** Custom message template (use {function} placeholder) */
  messageTemplate?: string;
  /**
   * Mode for checking multiple required functions
   * - 'all': ALL functions in the list must be called (default)
   * - 'any': At least ONE function in the list must be called
   */
  mode?: 'all' | 'any';
}

/**
 * Rule that ensures specific functions are called
 *
 * Useful for ensuring that sandboxed code actually uses the provided API.
 * For example, ensuring code calls 'callTool' function.
 */
export class RequiredFunctionCallRule implements ValidationRule {
  readonly name = 'required-function-call';
  readonly description = 'Ensures specific functions are called';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false;

  constructor(private options: RequiredFunctionCallOptions) {
    if (!options.required || options.required.length === 0) {
      throw new RuleConfigurationError(
        'RequiredFunctionCallRule requires at least one required function',
        'required-function-call',
      );
    }
  }

  validate(context: ValidationContext): void {
    const { required, minCalls = 1, maxCalls = 0, messageTemplate, mode = 'all' } = this.options;
    const callCounts = new Map<string, number>();

    // Initialize counts
    for (const funcName of required) {
      callCounts.set(funcName, 0);
    }

    // Count function calls
    walk.simple(context.ast as any, {
      CallExpression: (node: any) => {
        const callee = node.callee;

        // Handle direct calls: funcName()
        if (callee.type === 'Identifier') {
          const name = callee.name;
          if (callCounts.has(name)) {
            callCounts.set(name, callCounts.get(name)! + 1);
          }
        }

        // Handle member calls: obj.funcName()
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          const name = callee.property.name;
          if (callCounts.has(name)) {
            callCounts.set(name, callCounts.get(name)! + 1);
          }
        }
      },
    });

    // Handle 'any' mode: at least one function must be called
    if (mode === 'any') {
      const totalCalls = Array.from(callCounts.values()).reduce((sum, count) => sum + count, 0);
      if (totalCalls < minCalls) {
        const functionNames = required.join(' or ');
        const message =
          messageTemplate || `At least one of [${functionNames}] must be called at least ${minCalls} time(s)`;

        context.report({
          code: 'REQUIRED_FUNCTION_NOT_CALLED',
          message,
          data: {
            functions: required,
            expectedMin: minCalls,
            actual: totalCalls,
          },
        });
      }
      return;
    }

    // Handle 'all' mode (default): each function must be called
    for (const [funcName, count] of callCounts.entries()) {
      if (count < minCalls) {
        const message =
          messageTemplate?.replace('{function}', funcName) ||
          `Function "${funcName}" must be called at least ${minCalls} time(s), but was called ${count} time(s)`;

        context.report({
          code: 'REQUIRED_FUNCTION_NOT_CALLED',
          message,
          data: {
            function: funcName,
            expectedMin: minCalls,
            actual: count,
          },
        });
      }

      // Check maximum calls
      if (maxCalls > 0 && count > maxCalls) {
        const message = `Function "${funcName}" can be called at most ${maxCalls} time(s), but was called ${count} time(s)`;

        context.report({
          code: 'FUNCTION_CALLED_TOO_MANY_TIMES',
          message,
          data: {
            function: funcName,
            expectedMax: maxCalls,
            actual: count,
          },
        });
      }
    }
  }
}
