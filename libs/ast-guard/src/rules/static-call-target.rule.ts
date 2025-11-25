import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Options for StaticCallTargetRule
 */
export interface StaticCallTargetOptions {
  /**
   * List of function names to validate
   * Default: ['callTool', '__safe_callTool']
   */
  targetFunctions?: string[];

  /**
   * Optional whitelist of allowed tool names
   * Supports exact strings or RegExp patterns
   * If provided, only these tool names are allowed
   */
  allowedToolNames?: (string | RegExp)[];

  /**
   * Which argument position to validate (0-indexed)
   * Default: 0 (first argument)
   */
  argumentPosition?: number;
}

/**
 * Rule that enforces static string literals for call targets
 *
 * This rule ensures that certain functions (like `callTool`) are called
 * with static string literals as their first argument. This prevents
 * dynamic tool name injection and enables static analysis of tool usage.
 *
 * @example
 * ```typescript
 * // These will FAIL validation:
 * callTool(toolName, args);           // Variable reference
 * callTool("tool" + suffix, args);    // Concatenation
 * callTool(`tool_${id}`, args);       // Template with expressions
 * callTool(cond ? "a" : "b", args);   // Ternary expression
 *
 * // These will PASS validation:
 * callTool("users:list", args);       // Static string literal
 * callTool('billing:invoice', args);  // Static string literal
 * ```
 */
export class StaticCallTargetRule implements ValidationRule {
  readonly name = 'static-call-target';
  readonly description = 'Enforces static string literals for call targets';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  private readonly targetFunctions: Set<string>;
  private readonly allowedToolNames: (string | RegExp)[] | undefined;
  private readonly argumentPosition: number;

  constructor(private options: StaticCallTargetOptions = {}) {
    this.targetFunctions = new Set(options.targetFunctions ?? ['callTool', '__safe_callTool']);
    this.allowedToolNames = options.allowedToolNames;
    this.argumentPosition = options.argumentPosition ?? 0;
  }

  validate(context: ValidationContext): void {
    walk.simple(context.ast as any, {
      CallExpression: (node: any) => {
        const callee = node.callee;
        let funcName: string | null = null;

        // Get function name from different call patterns
        if (callee.type === 'Identifier') {
          funcName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          funcName = callee.property.name;
        }

        // Skip if not a target function
        if (!funcName || !this.targetFunctions.has(funcName)) {
          return;
        }

        const args = node.arguments;
        const targetArg = args[this.argumentPosition];

        // Check if argument exists
        if (!targetArg) {
          context.report({
            code: 'MISSING_CALL_TARGET',
            message: `Function "${funcName}" requires a target argument at position ${this.argumentPosition + 1}`,
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
            data: {
              function: funcName,
              argumentPosition: this.argumentPosition,
            },
          });
          return;
        }

        // Check if argument is a static string literal
        const staticStringValue = this.extractStaticString(targetArg);

        if (staticStringValue === null) {
          const dynamicType = this.describeDynamicType(targetArg);
          context.report({
            code: 'DYNAMIC_CALL_TARGET',
            message:
              `Function "${funcName}" requires argument ${this.argumentPosition + 1} to be a static string literal. ` +
              `${dynamicType} are not allowed as they prevent static analysis and could enable injection attacks.`,
            location: targetArg.loc
              ? {
                  line: targetArg.loc.start.line,
                  column: targetArg.loc.start.column,
                }
              : undefined,
            data: {
              function: funcName,
              argumentPosition: this.argumentPosition,
              argumentType: targetArg.type,
              dynamicType,
            },
          });
          return;
        }

        // If allowedToolNames is specified, validate against it
        if (this.allowedToolNames && this.allowedToolNames.length > 0) {
          const isAllowed = this.allowedToolNames.some((pattern) => {
            if (typeof pattern === 'string') {
              return pattern === staticStringValue;
            }
            return pattern.test(staticStringValue);
          });

          if (!isAllowed) {
            context.report({
              code: 'UNKNOWN_TOOL_NAME',
              message: `Tool "${staticStringValue}" is not in the allowed tools list for function "${funcName}"`,
              location: targetArg.loc
                ? {
                    line: targetArg.loc.start.line,
                    column: targetArg.loc.start.column,
                  }
                : undefined,
              data: {
                function: funcName,
                toolName: staticStringValue,
                allowedTools: this.allowedToolNames.map((p) => (p instanceof RegExp ? p.source : p)),
              },
            });
          }
        }
      },
    });
  }

  /**
   * Extract a static string value from an AST node
   * Returns null if the node is not a static string
   */
  private extractStaticString(node: any): string | null {
    // Simple string literal: "foo" or 'foo'
    if (node.type === 'Literal' && typeof node.value === 'string') {
      return node.value;
    }

    // Template literal with no expressions: `foo`
    if (node.type === 'TemplateLiteral') {
      // Only allow template literals with zero expressions (fully static)
      if (node.expressions.length === 0 && node.quasis.length === 1) {
        return node.quasis[0].value.cooked;
      }
      // Template with expressions is dynamic
      return null;
    }

    // All other node types are considered dynamic
    return null;
  }

  /**
   * Describe why a node type is considered dynamic (for error messages)
   */
  private describeDynamicType(node: any): string {
    switch (node.type) {
      case 'Identifier':
        return `Variable references (like "${node.name}")`;
      case 'BinaryExpression':
        if (node.operator === '+') {
          return 'String concatenation expressions';
        }
        return 'Binary expressions';
      case 'TemplateLiteral':
        return 'Template literals with embedded expressions';
      case 'ConditionalExpression':
        return 'Conditional (ternary) expressions';
      case 'CallExpression':
        return 'Function call results';
      case 'MemberExpression':
        return 'Property access expressions';
      case 'LogicalExpression':
        return 'Logical expressions';
      case 'AssignmentExpression':
        return 'Assignment expressions';
      case 'SequenceExpression':
        return 'Sequence expressions';
      case 'AwaitExpression':
        return 'Await expressions';
      default:
        return `Dynamic expressions (${node.type})`;
    }
  }
}
