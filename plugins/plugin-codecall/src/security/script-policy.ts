// file: plugins/plugin-codecall/src/security/script-policy.ts

import {
  ForbiddenLoopRule,
  JSAstValidator,
  ValidationSeverity,
  type ValidationContext,
  type ValidationIssue,
  type ValidationRule,
} from '@enclave-vm/ast';

import type { ResolvedCodeCallVmOptions } from '../codecall.symbol';

type ScriptPolicyOptions = Pick<ResolvedCodeCallVmOptions, 'allowLoops'>;

interface AstNode {
  type: string;
  name?: string;
  computed?: boolean;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

const AGENTSCRIPT_PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
} as const;

/** The parses the sandbox tries, in its order: a script, a module, then the body of an async function. */
const PARSE_ATTEMPTS = [
  { wrap: (code: string) => code, parseOptions: AGENTSCRIPT_PARSE_OPTIONS, lineOffset: 0 },
  { wrap: (code: string) => code, parseOptions: { ...AGENTSCRIPT_PARSE_OPTIONS, sourceType: 'module' }, lineOffset: 0 },
  {
    wrap: (code: string) => `async function __temp__() {\n${code}\n}`,
    parseOptions: AGENTSCRIPT_PARSE_OPTIONS,
    lineOffset: 1,
  },
] as const;

const NON_REFERENCE_KEYS = new Set(['type', 'loc', 'start', 'end', 'range', 'label']);

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function isPropertyName(parent: AstNode | undefined, key: string): boolean {
  if (!parent || parent['computed']) return false;
  if (parent.type === 'MemberExpression') return key === 'property';
  return key === 'key' && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type);
}

function visitIdentifierReferences(
  node: AstNode,
  visit: (identifier: AstNode) => void,
  parent?: AstNode,
  key = '',
): void {
  if (node.type === 'Identifier') {
    if (!isPropertyName(parent, key)) visit(node);
    return;
  }
  for (const [childKey, child] of Object.entries(node)) {
    if (NON_REFERENCE_KEYS.has(childKey)) continue;
    const children = Array.isArray(child) ? child : [child];
    for (const childNode of children) {
      if (isAstNode(childNode)) visitIdentifierReferences(childNode, visit, node, childKey);
    }
  }
}

/** Refuses references to the global `console`; a property or key named `console` is not one. */
class GlobalConsoleRule implements ValidationRule {
  readonly name = 'codecall-global-console';
  readonly description = 'console is not available in CodeCall scripts';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  validate(context: ValidationContext): void {
    visitIdentifierReferences(context.ast as unknown as AstNode, (identifier) => {
      if (identifier.name !== 'console') return;
      context.report({
        code: 'DISALLOWED_IDENTIFIER',
        message: 'console is not available in CodeCall scripts; use mcpLog(level, message)',
        location: identifier.loc ? { line: identifier.loc.start.line, column: identifier.loc.start.column } : undefined,
        data: { identifier: 'console' },
      });
    });
  }
}

function scriptPolicyRules({ allowLoops }: ScriptPolicyOptions): ValidationRule[] {
  const rules: ValidationRule[] = [new GlobalConsoleRule()];
  if (!allowLoops) {
    rules.push(
      new ForbiddenLoopRule({
        allowFor: false,
        allowForOf: true,
        allowWhile: false,
        allowDoWhile: false,
        allowForIn: false,
        message: 'Only for-of loops are allowed (vm.allowLoops is false)',
      }),
    );
  }
  return rules;
}

/**
 * The places a script uses a loop `vm.allowLoops: false` turns off, or `console`, which the sandbox
 * never gives a script, in the script's own lines. The sandbox takes no loop option, so CodeCall
 * checks before it runs the script, parsing it the way the sandbox does. A script none of those
 * parses accept is left to the sandbox, which fails on the same parse and reports the syntax error.
 */
export async function findScriptPolicyIssues(code: string, options: ScriptPolicyOptions): Promise<ValidationIssue[]> {
  const validator = new JSAstValidator(scriptPolicyRules(options));
  for (const attempt of PARSE_ATTEMPTS) {
    const result = await validator.validate(attempt.wrap(code), {
      parseOptions: attempt.parseOptions,
      preScan: { enabled: false },
    });
    if (result.parseError) continue;
    return result.issues.map((issue) =>
      issue.location && attempt.lineOffset > 0
        ? { ...issue, location: { ...issue.location, line: issue.location.line - attempt.lineOffset } }
        : issue,
    );
  }
  return [];
}
