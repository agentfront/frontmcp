import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';
import { RuleConfigurationError } from '../errors';

/**
 * Validator function for arguments
 */
export type ArgumentValidator = (args: any[], node: any) => string | null;

/**
 * Configuration for a specific function's argument validation
 */
export interface FunctionArgumentConfig {
  /** Minimum number of arguments required */
  minArgs?: number;
  /** Maximum number of arguments allowed */
  maxArgs?: number;
  /** Expected argument types (by position) */
  expectedTypes?: Array<'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'literal'>;
  /** Custom validator function */
  validator?: ArgumentValidator;
  /** Custom error message */
  message?: string;
}

/**
 * Options for CallArgumentValidationRule
 */
export interface CallArgumentValidationOptions {
  /** Map of function name to argument configuration */
  functions: Record<string, FunctionArgumentConfig>;
}

/**
 * Rule that validates function call arguments
 *
 * Ensures that specific functions are called with the correct number
 * and types of arguments. Useful for enforcing API contracts.
 */
export class CallArgumentValidationRule implements ValidationRule {
  readonly name = 'call-argument-validation';
  readonly description = 'Validates function call arguments';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false;

  constructor(private options: CallArgumentValidationOptions) {
    if (!options.functions || Object.keys(options.functions).length === 0) {
      throw new RuleConfigurationError(
        'CallArgumentValidationRule requires at least one function configuration',
        'call-argument-validation',
      );
    }
  }

  validate(context: ValidationContext): void {
    const { functions } = this.options;

    walk.simple(context.ast as any, {
      CallExpression: (node: any) => {
        const callee = node.callee;
        let funcName: string | null = null;

        // Get function name
        if (callee.type === 'Identifier') {
          funcName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          funcName = callee.property.name;
        }

        if (!funcName || !functions[funcName]) {
          return;
        }

        const config = functions[funcName];
        const args = node.arguments;

        // Validate argument count
        if (config.minArgs !== undefined && args.length < config.minArgs) {
          context.report({
            code: 'INVALID_ARGUMENT_COUNT',
            message:
              config.message ||
              `Function "${funcName}" requires at least ${config.minArgs} argument(s), but got ${args.length}`,
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
            data: {
              function: funcName,
              expected: config.minArgs,
              actual: args.length,
            },
          });
          return;
        }

        if (config.maxArgs !== undefined && args.length > config.maxArgs) {
          context.report({
            code: 'INVALID_ARGUMENT_COUNT',
            message:
              config.message ||
              `Function "${funcName}" accepts at most ${config.maxArgs} argument(s), but got ${args.length}`,
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
            data: {
              function: funcName,
              expected: config.maxArgs,
              actual: args.length,
            },
          });
          return;
        }

        // Validate argument types
        if (config.expectedTypes) {
          for (let i = 0; i < config.expectedTypes.length && i < args.length; i++) {
            const expectedType = config.expectedTypes[i];
            const arg = args[i];
            const actualType = this.getArgumentType(arg);

            if (expectedType !== actualType) {
              context.report({
                code: 'INVALID_ARGUMENT_TYPE',
                message:
                  config.message ||
                  `Function "${funcName}" expects argument ${
                    i + 1
                  } to be of type "${expectedType}", but got "${actualType}"`,
                location: arg.loc
                  ? {
                      line: arg.loc.start.line,
                      column: arg.loc.start.column,
                    }
                  : undefined,
                data: {
                  function: funcName,
                  argumentIndex: i,
                  expected: expectedType,
                  actual: actualType,
                },
              });
            }
          }
        }

        // Custom validator
        if (config.validator) {
          const error = config.validator(args, node);
          if (error) {
            context.report({
              code: 'CUSTOM_ARGUMENT_VALIDATION_FAILED',
              message: error,
              location: node.loc
                ? {
                    line: node.loc.start.line,
                    column: node.loc.start.column,
                  }
                : undefined,
              data: { function: funcName },
            });
          }
        }
      },
    });
  }

  /**
   * Get the type of an argument node
   */
  private getArgumentType(node: any): string {
    switch (node.type) {
      case 'Literal':
        if (node.value === null) return 'literal';
        if (Array.isArray(node.value)) return 'array';
        return typeof node.value;

      case 'ObjectExpression':
        return 'object';

      case 'ArrayExpression':
        return 'array';

      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return 'function';

      case 'Identifier':
        // Can't determine type statically
        return 'unknown';

      default:
        return 'unknown';
    }
  }
}
