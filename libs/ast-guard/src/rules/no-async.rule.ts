import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Options for NoAsyncRule
 */
export interface NoAsyncOptions {
  /** Whether to allow async functions */
  allowAsyncFunctions?: boolean;
  /** Whether to allow await expressions */
  allowAwait?: boolean;
  /** Custom message */
  message?: string;
}

/**
 * Rule that prevents usage of async/await
 *
 * Useful for synchronous-only execution environments.
 */
export class NoAsyncRule implements ValidationRule {
  readonly name = 'no-async';
  readonly description = 'Prevents usage of async/await constructs';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false;

  constructor(private options: NoAsyncOptions = {}) {}

  validate(context: ValidationContext): void {
    const { allowAsyncFunctions = false, allowAwait = false, message } = this.options;

    walk.simple(context.ast as any, {
      FunctionDeclaration: (node: any) => {
        if (!allowAsyncFunctions && node.async) {
          context.report({
            code: 'NO_ASYNC',
            message: message || 'Async functions are not allowed',
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
          });
        }
      },

      FunctionExpression: (node: any) => {
        if (!allowAsyncFunctions && node.async) {
          context.report({
            code: 'NO_ASYNC',
            message: message || 'Async function expressions are not allowed',
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
          });
        }
      },

      ArrowFunctionExpression: (node: any) => {
        if (!allowAsyncFunctions && node.async) {
          context.report({
            code: 'NO_ASYNC',
            message: message || 'Async arrow functions are not allowed',
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
          });
        }
      },

      AwaitExpression: (node: any) => {
        if (!allowAwait) {
          context.report({
            code: 'NO_AWAIT',
            message: message || 'Await expressions are not allowed',
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
          });
        }
      },
    });
  }
}
