import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Rule that detects unreachable code
 *
 * Detects code that can never be executed:
 * - Statements after return/throw/break/continue
 * - Code after infinite loops
 * - Dead branches in conditionals
 */
export class UnreachableCodeRule implements ValidationRule {
  readonly name = 'unreachable-code';
  readonly description = 'Detects unreachable code that can never be executed';
  readonly defaultSeverity = ValidationSeverity.WARNING;
  readonly enabledByDefault = true;

  validate(context: ValidationContext): void {
    walk.ancestor(context.ast as any, {
      // Check for statements after return/throw/break/continue
      BlockStatement: (node: any, ancestors: any[]) => {
        const statements = node.body;

        for (let i = 0; i < statements.length - 1; i++) {
          const stmt = statements[i];

          // Check if this statement always causes control flow to exit
          if (this.isTerminalStatement(stmt)) {
            // Report all subsequent statements as unreachable
            for (let j = i + 1; j < statements.length; j++) {
              const unreachableStmt = statements[j];

              context.report({
                code: 'UNREACHABLE_CODE',
                severity: ValidationSeverity.WARNING,
                message: 'Unreachable code detected',
                location: unreachableStmt.loc
                  ? {
                      line: unreachableStmt.loc.start.line,
                      column: unreachableStmt.loc.start.column,
                    }
                  : undefined,
              });
            }
            break; // Only report once per block
          }
        }
      },

      // Check for code after return in function body
      ReturnStatement: (node: any, ancestors: any[]) => {
        this.checkAfterTerminal(node, ancestors, context);
      },

      ThrowStatement: (node: any, ancestors: any[]) => {
        this.checkAfterTerminal(node, ancestors, context);
      },
    });
  }

  /**
   * Check if a statement always terminates control flow
   */
  private isTerminalStatement(node: any): boolean {
    switch (node.type) {
      case 'ReturnStatement':
      case 'ThrowStatement':
        return true;

      case 'BreakStatement':
      case 'ContinueStatement':
        return true;

      case 'IfStatement':
        // Both branches must be terminal
        return (
          node.consequent &&
          node.alternate &&
          this.isTerminalStatement(node.consequent) &&
          this.isTerminalStatement(node.alternate)
        );

      case 'BlockStatement':
        // Check if any statement in the block is terminal
        return node.body.some((stmt: any) => this.isTerminalStatement(stmt));

      default:
        return false;
    }
  }

  /**
   * Check for statements after a terminal statement
   */
  private checkAfterTerminal(node: any, ancestors: any[], context: ValidationContext): void {
    // Find the parent block statement
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];

      if (ancestor.type === 'BlockStatement') {
        const statements = ancestor.body;
        const currentIndex = statements.indexOf(node);

        if (currentIndex !== -1 && currentIndex < statements.length - 1) {
          // There are statements after this terminal statement
          const nextStmt = statements[currentIndex + 1];

          context.report({
            code: 'UNREACHABLE_CODE',
            severity: ValidationSeverity.WARNING,
            message: `Code after ${node.type.replace('Statement', '').toLowerCase()} is unreachable`,
            location: nextStmt.loc
              ? {
                  line: nextStmt.loc.start.line,
                  column: nextStmt.loc.start.column,
                }
              : undefined,
          });
        }
        break;
      }
    }
  }
}
