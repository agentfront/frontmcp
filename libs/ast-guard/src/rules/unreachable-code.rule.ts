import * as walk from 'acorn-walk';
import type * as acorn from 'acorn';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Rule that detects unreachable code
 *
 * Detects code that can never be executed:
 * - Statements after return/throw/break/continue
 */
export class UnreachableCodeRule implements ValidationRule {
  readonly name = 'unreachable-code';
  readonly description = 'Detects unreachable code that can never be executed';
  readonly defaultSeverity = ValidationSeverity.WARNING;
  readonly enabledByDefault = true;

  validate(context: ValidationContext): void {
    walk.ancestor(context.ast, {
      // Check for statements after return/throw/break/continue
      BlockStatement: (node: any) => {
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
    });
  }

  /**
   * Check if a statement always terminates control flow
   */
  private isTerminalStatement(node: acorn.Node): boolean {
    const n = node as any; // acorn.Node lacks specific type definitions for node properties
    switch (n.type) {
      case 'ReturnStatement':
      case 'ThrowStatement':
        return true;

      case 'BreakStatement':
      case 'ContinueStatement':
        return true;

      case 'IfStatement':
        // Both branches must be terminal
        return (
          n.consequent && n.alternate && this.isTerminalStatement(n.consequent) && this.isTerminalStatement(n.alternate)
        );

      case 'BlockStatement':
        // Check if any statement in the block is terminal
        return n.body.some((stmt: any) => this.isTerminalStatement(stmt));

      default:
        return false;
    }
  }
}
