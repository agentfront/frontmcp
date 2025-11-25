import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Rule that prevents usage of eval and related constructs
 *
 * Blocks:
 * - eval() calls
 * - new Function() calls
 * - setTimeout/setInterval with string arguments
 * - with statements (scope manipulation)
 */
export class NoEvalRule implements ValidationRule {
  readonly name = 'no-eval';
  readonly description = 'Prevents usage of eval and dynamic code execution';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  validate(context: ValidationContext): void {
    walk.simple(context.ast as any, {
      CallExpression: (node: any) => {
        const callee = node.callee;

        // Check for eval()
        if (callee.type === 'Identifier' && callee.name === 'eval') {
          context.report({
            code: 'NO_EVAL',
            message: 'Use of eval() is not allowed',
            location: callee.loc
              ? {
                  line: callee.loc.start.line,
                  column: callee.loc.start.column,
                }
              : undefined,
          });
        }

        // Check for setTimeout/setInterval with string argument
        if (callee.type === 'Identifier' && (callee.name === 'setTimeout' || callee.name === 'setInterval')) {
          const firstArg = node.arguments[0];
          if (firstArg && firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
            context.report({
              code: 'NO_EVAL',
              message: `Use of ${callee.name} with string argument is not allowed (acts like eval)`,
              location: callee.loc
                ? {
                    line: callee.loc.start.line,
                    column: callee.loc.start.column,
                  }
                : undefined,
            });
          }
        }
      },

      NewExpression: (node: any) => {
        const callee = node.callee;

        // Check for new Function()
        if (callee.type === 'Identifier' && callee.name === 'Function') {
          context.report({
            code: 'NO_EVAL',
            message: 'Use of Function constructor is not allowed (acts like eval)',
            location: callee.loc
              ? {
                  line: callee.loc.start.line,
                  column: callee.loc.start.column,
                }
              : undefined,
          });
        }
      },

      WithStatement: (node: any) => {
        // Check for with statement (scope manipulation)
        context.report({
          code: 'NO_EVAL',
          message: 'Use of with statement is not allowed (manipulates scope)',
          location: node.loc
            ? {
                line: node.loc.start.line,
                column: node.loc.start.column,
              }
            : undefined,
        });
      },
    });
  }
}
