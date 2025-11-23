import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Options for ForbiddenLoopRule
 */
export interface ForbiddenLoopOptions {
  /** Whether to allow for loops */
  allowFor?: boolean;
  /** Whether to allow while loops */
  allowWhile?: boolean;
  /** Whether to allow do-while loops */
  allowDoWhile?: boolean;
  /** Whether to allow for-of loops */
  allowForOf?: boolean;
  /** Whether to allow for-in loops */
  allowForIn?: boolean;
  /** Custom message */
  message?: string;
}

/**
 * Rule that prevents usage of loop constructs
 *
 * Useful for sandboxed code execution where infinite loops could cause issues.
 * Can be configured to allow specific loop types.
 */
export class ForbiddenLoopRule implements ValidationRule {
  readonly name = 'forbidden-loop';
  readonly description = 'Prevents usage of loop constructs';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false;

  constructor(private options: ForbiddenLoopOptions = {}) {}

  validate(context: ValidationContext): void {
    const {
      allowFor = false,
      allowWhile = false,
      allowDoWhile = false,
      allowForOf = false,
      allowForIn = false,
      message = 'Loop constructs are not allowed',
    } = this.options;

    const handlers: Record<string, (node: any) => void> = {};

    if (!allowFor) {
      handlers['ForStatement'] = (node: any) => this.reportLoop(context, node, 'for', message);
    }

    if (!allowWhile) {
      handlers['WhileStatement'] = (node: any) => this.reportLoop(context, node, 'while', message);
    }

    if (!allowDoWhile) {
      handlers['DoWhileStatement'] = (node: any) => this.reportLoop(context, node, 'do-while', message);
    }

    if (!allowForOf) {
      handlers['ForOfStatement'] = (node: any) => this.reportLoop(context, node, 'for-of', message);
    }

    if (!allowForIn) {
      handlers['ForInStatement'] = (node: any) => this.reportLoop(context, node, 'for-in', message);
    }

    walk.simple(context.ast as any, handlers);
  }

  private reportLoop(context: ValidationContext, node: any, loopType: string, message: string): void {
    context.report({
      code: 'FORBIDDEN_LOOP',
      message: `${message} (${loopType} loop)`,
      location: node.loc
        ? {
            line: node.loc.start.line,
            column: node.loc.start.column,
          }
        : undefined,
      data: { loopType },
    });
  }
}
