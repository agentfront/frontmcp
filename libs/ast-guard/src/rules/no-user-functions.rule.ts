import type * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { ValidationRule, ValidationContext } from '../interfaces';
import { ValidationSeverity } from '../interfaces';

/**
 * Configuration options for NoUserDefinedFunctionsRule
 */
export interface NoUserDefinedFunctionsOptions {
  /**
   * Whether to allow arrow functions
   * Default: true (allows arrow functions in safe contexts like array.map)
   */
  allowArrowFunctions?: boolean;

  /**
   * Whether to allow function expressions
   * Default: false (blocks all function expressions in v1)
   */
  allowFunctionExpressions?: boolean;

  /**
   * List of allowed function names (for internal/compiler use)
   * Default: ['__ag_main'] (the main wrapper function)
   */
  allowedFunctionNames?: string[];

  /**
   * Custom error message
   */
  message?: string;
}

/**
 * NoUserDefinedFunctionsRule - Blocks user-defined functions (v1 restriction)
 *
 * In AgentScript v1, user-defined functions are not allowed to:
 * - Simplify the language surface area
 * - Prevent recursion (which complicates resource limits)
 * - Keep orchestration code linear and predictable
 * - Reduce complexity of static analysis
 *
 * **Blocked constructs:**
 * ```javascript
 * function helper() {}                    // ❌ BLOCKED: function declaration
 * const fn = function() {};               // ❌ BLOCKED: function expression
 * const obj = { method() {} };            // ❌ BLOCKED: method definition
 * class Foo { method() {} }               // ❌ BLOCKED: class method
 * ```
 *
 * **Allowed constructs (default):**
 * ```javascript
 * const fn = () => {};                    // ✅ OK: arrow function (for callbacks)
 * array.map(x => x * 2);                  // ✅ OK: arrow in array method
 * array.filter(x => x > 0);               // ✅ OK: arrow in array method
 *
 * // Internal compiler wrapper (whitelisted)
 * async function __ag_main() {}           // ✅ OK: internal compiler function
 * ```
 *
 * **Rationale:**
 * - Arrow functions are allowed because they're commonly used in array methods
 *   (map, filter, reduce) which are essential for data manipulation
 * - Arrow functions don't have their own `this` binding, making them safer
 * - Full function declarations enable recursion and complex control flow,
 *   which makes resource limiting harder
 *
 * @example
 * ```typescript
 * // Strict v1: No functions at all
 * const rule = new NoUserDefinedFunctionsRule({
 *   allowArrowFunctions: false,
 * });
 *
 * // Permissive v1: Allow arrows for array methods
 * const rule = new NoUserDefinedFunctionsRule({
 *   allowArrowFunctions: true,
 * });
 * ```
 */
export class NoUserDefinedFunctionsRule implements ValidationRule {
  readonly name = 'no-user-functions';
  readonly description = 'Blocks user-defined functions (AgentScript v1 restriction)';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  private readonly allowArrowFunctions: boolean;
  private readonly allowFunctionExpressions: boolean;
  private readonly allowedFunctionNames: Set<string>;
  private readonly customMessage?: string;

  constructor(options: NoUserDefinedFunctionsOptions = {}) {
    this.allowArrowFunctions = options.allowArrowFunctions !== false; // default true
    this.allowFunctionExpressions = options.allowFunctionExpressions === true; // default false
    this.allowedFunctionNames = new Set(options.allowedFunctionNames || ['__ag_main']);
    this.customMessage = options.message;
  }

  validate(context: ValidationContext): void {
    const { ast } = context;

    walk.simple(ast, {
      // Function declarations: function foo() {}
      FunctionDeclaration: (node: any) => {
        // Check if this function name is whitelisted (e.g., __ag_main)
        if (node.id && this.allowedFunctionNames.has(node.id.name)) {
          return; // Allow internal compiler functions
        }

        context.report({
          code: 'NO_USER_FUNCTION_DECLARATION',
          message:
            this.customMessage ||
            `Function declarations are not allowed in AgentScript v1. ` +
              `Function "${node.id?.name || 'anonymous'}" is not permitted. ` +
              `Use inline arrow functions for callbacks instead (e.g., array.map(x => x * 2)).`,
          location: node.loc
            ? {
                line: node.loc.start.line,
                column: node.loc.start.column,
                endLine: node.loc.end.line,
                endColumn: node.loc.end.column,
              }
            : undefined,
          data: {
            functionName: node.id?.name,
            type: 'FunctionDeclaration',
          },
        });
      },

      // Function expressions: const fn = function() {}
      FunctionExpression: (node: any) => {
        if (this.allowFunctionExpressions) {
          return;
        }

        // Check if this is a method definition (special case)
        // Methods are handled separately in MethodDefinition

        context.report({
          code: 'NO_USER_FUNCTION_EXPRESSION',
          message:
            this.customMessage ||
            `Function expressions are not allowed in AgentScript v1. ` +
              `Use inline arrow functions for callbacks instead (e.g., array.map(x => x * 2)).`,
          location: node.loc
            ? {
                line: node.loc.start.line,
                column: node.loc.start.column,
                endLine: node.loc.end.line,
                endColumn: node.loc.end.column,
              }
            : undefined,
          data: {
            functionName: node.id?.name,
            type: 'FunctionExpression',
          },
        });
      },

      // Arrow functions: const fn = () => {}
      ArrowFunctionExpression: (node: any) => {
        if (this.allowArrowFunctions) {
          return;
        }

        context.report({
          code: 'NO_USER_ARROW_FUNCTION',
          message:
            this.customMessage ||
            `Arrow functions are not allowed in this strict mode. ` +
              `Enable allowArrowFunctions option if you want to use arrow functions for callbacks.`,
          location: node.loc
            ? {
                line: node.loc.start.line,
                column: node.loc.start.column,
                endLine: node.loc.end.line,
                endColumn: node.loc.end.column,
              }
            : undefined,
          data: {
            type: 'ArrowFunctionExpression',
          },
        });
      },

      // Method definitions: class { foo() {} } or { foo() {} }
      MethodDefinition: (node: any) => {
        context.report({
          code: 'NO_USER_METHOD_DEFINITION',
          message:
            this.customMessage ||
            `Method definitions are not allowed in AgentScript v1. ` +
              `Method "${node.key?.name || 'unknown'}" is not permitted.`,
          location: node.loc
            ? {
                line: node.loc.start.line,
                column: node.loc.start.column,
                endLine: node.loc.end.line,
                endColumn: node.loc.end.column,
              }
            : undefined,
          data: {
            methodName: node.key?.name,
            type: 'MethodDefinition',
          },
        });
      },

      // Property methods in object literals: { foo() {} }
      Property: (node: any) => {
        // Check if this is a method shorthand
        if (node.method === true) {
          context.report({
            code: 'NO_USER_METHOD_SHORTHAND',
            message:
              this.customMessage ||
              `Method shorthand syntax is not allowed in AgentScript v1. ` +
                `Property "${node.key?.name || 'unknown'}" uses method syntax. ` +
                `Use arrow functions instead: { ${node.key?.name || 'prop'}: () => {...} }`,
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                  endLine: node.loc.end.line,
                  endColumn: node.loc.end.column,
                }
              : undefined,
            data: {
              propertyName: node.key?.name,
              type: 'MethodShorthand',
            },
          });
        }
      },
    });
  }
}
