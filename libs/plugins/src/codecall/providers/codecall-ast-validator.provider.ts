// file: libs/plugins/src/codecall/providers/codecall-ast-validator.provider.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import {
  CodeCallAstValidator,
  CodeCallAstValidationIssue,
  CodeCallAstValidationResult,
  ResolvedCodeCallVmOptions,
} from '../codecall.symbol';

@Provider({
  name: 'codecall:ast-validator',
  description: 'AST validator for CodeCall JavaScript plans',
  scope: ProviderScope.GLOBAL,
})
export default class CodeCallAstValidatorProvider implements CodeCallAstValidator {
  constructor(private readonly vmOptions: ResolvedCodeCallVmOptions) {}

  validate(script: string): CodeCallAstValidationResult {
    const issues: CodeCallAstValidationIssue[] = [];

    let ast: acorn.Node;
    try {
      ast = acorn.parse(script, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true,
      }) as unknown as acorn.Node;
    } catch (err: any) {
      issues.push({
        kind: 'ParseError',
        message: err?.message ?? 'Failed to parse script',
        location:
          typeof err?.loc?.line === 'number' && typeof err?.loc?.column === 'number'
            ? { line: err.loc.line, column: err.loc.column }
            : undefined,
      });

      return { ok: false, issues };
    }

    const { disabledBuiltins, disabledGlobals, allowLoops } = this.vmOptions;
    const forbidden = new Set([...disabledBuiltins, ...disabledGlobals]);

    walk.simple(ast as any, {
      Identifier: (node: any) => {
        if (forbidden.has(node.name)) {
          issues.push({
            kind: disabledGlobals.includes(node.name) ? 'DisallowedGlobal' : 'IllegalBuiltinAccess',
            message: `Access to "${node.name}" is not allowed in CodeCall scripts.`,
            location: node.loc ? { line: node.loc.start.line, column: node.loc.start.column } : undefined,
            identifier: node.name,
          });
        }
      },

      // loop constructs when allowLoops === false
      ForStatement: this.checkLoop(issues, allowLoops),
      WhileStatement: this.checkLoop(issues, allowLoops),
      DoWhileStatement: this.checkLoop(issues, allowLoops),
      ForOfStatement: this.checkLoop(issues, allowLoops),
      ForInStatement: this.checkLoop(issues, allowLoops),
    });

    return {
      ok: issues.length === 0,
      issues,
    };
  }

  private checkLoop(issues: CodeCallAstValidationIssue[], allowLoops: boolean): (node: any) => void {
    return (node: any) => {
      if (allowLoops) return;
      issues.push({
        kind: 'DisallowedLoop',
        message: 'Loops are not allowed in this CodeCall VM preset.',
        location: node.loc ? { line: node.loc.start.line, column: node.loc.start.column } : undefined,
      });
    };
  }
}
