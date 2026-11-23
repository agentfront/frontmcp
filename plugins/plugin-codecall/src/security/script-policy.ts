// file: plugins/plugin-codecall/src/security/script-policy.ts

import {
  ForbiddenLoopRule,
  getAgentScriptGlobals,
  JSAstValidator,
  UnknownGlobalRule,
  ValidationSeverity,
  type ValidationContext,
  type ValidationIssue,
  type ValidationRule,
} from '@enclave-vm/ast';

import type { ResolvedCodeCallVmOptions } from '../codecall.symbol';
import { CODECALL_ENCLAVE_SECURITY_LEVEL } from '../providers/code-call.config';

type ScriptPolicyOptions = Pick<
  ResolvedCodeCallVmOptions,
  'allowLoops' | 'disabledBuiltins' | 'disabledGlobals' | 'allowConsole'
>;

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

/** Refuses references to the globals it has messages for; a property or key with such a name is not one. */
class DisallowedGlobalsRule implements ValidationRule {
  readonly name = 'codecall-disallowed-globals';
  readonly description = 'Globals CodeCall scripts may not use';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  constructor(private readonly messages: ReadonlyMap<string, string>) {}

  validate(context: ValidationContext): void {
    visitIdentifierReferences(context.ast as unknown as AstNode, (identifier) => {
      const message = identifier.name === undefined ? undefined : this.messages.get(identifier.name);
      if (message === undefined) return;
      context.report({
        code: 'DISALLOWED_IDENTIFIER',
        message,
        location: identifier.loc ? { line: identifier.loc.start.line, column: identifier.loc.start.column } : undefined,
        data: { identifier: identifier.name },
      });
    });
  }
}

/** Globals of JavaScript that models reach for, and what a script uses instead where AgentScript has none. */
const ALTERNATIVES_TO_GLOBALS: ReadonlyArray<{ name: string; alternative: string }> = [
  { name: 'Set', alternative: 'use an object with true values, or an array' },
  { name: 'Map', alternative: 'use a plain object' },
  { name: 'WeakMap', alternative: 'use a plain object' },
  { name: 'WeakSet', alternative: 'use an object with true values, or an array' },
  { name: 'Symbol', alternative: 'use a string' },
  { name: 'RegExp', alternative: 'use string methods such as includes, startsWith, split and replaceAll' },
  { name: 'Promise', alternative: 'use parallel(items, (item) => callTool(name, args)) to run calls at once' },
  { name: 'Error', alternative: 'throw a string' },
  { name: 'TypeError', alternative: 'throw a string' },
  { name: 'RangeError', alternative: 'throw a string' },
  { name: 'structuredClone', alternative: 'use JSON.parse(JSON.stringify(value))' },
];

/** The globals of {@link ALTERNATIVES_TO_GLOBALS} the sandbox doesn't give CodeCall scripts. */
export function unavailableGlobals(): ReadonlyArray<{ name: string; alternative: string }> {
  const sandboxGlobals = new Set(getAgentScriptGlobals(CODECALL_ENCLAVE_SECURITY_LEVEL));
  return ALTERNATIVES_TO_GLOBALS.filter(({ name }) => !sandboxGlobals.has(name));
}

/**
 * Refuses a reference to a global the sandbox lacks, naming it as the script wrote it, with what to use instead.
 * A name the script declares itself (`const { Map } = data`) is the script's own and is left alone.
 */
class UnavailableGlobalsRule implements ValidationRule {
  readonly name = 'codecall-unavailable-globals';
  readonly description = 'Globals AgentScript does not have';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;
  private readonly globalReferences = new UnknownGlobalRule({ allowedGlobals: [], allowStandardGlobals: false });

  constructor(private readonly alternatives: ReadonlyMap<string, string>) {}

  validate(context: ValidationContext): void {
    this.globalReferences.validate({
      ...context,
      report: (issue) => {
        const name = issue.data?.['identifier'];
        const alternative = typeof name === 'string' ? this.alternatives.get(name) : undefined;
        if (alternative === undefined) return;
        context.report({
          code: 'DISALLOWED_IDENTIFIER',
          message: `${name} is not available in AgentScript; ${alternative}`,
          location: issue.location,
          data: { identifier: name },
        });
      },
    });
  }
}

/** Why each refused global is refused; `console` is refused unless the server set `vm.allowConsole: true`. */
function disallowedGlobalMessages({
  disabledBuiltins,
  disabledGlobals,
  allowConsole,
}: ScriptPolicyOptions): Map<string, string> {
  const messages = new Map([
    ...disabledBuiltins.map((name): [string, string] => [name, `${name} is disabled by vm.disabledBuiltins`]),
    ...disabledGlobals.map((name): [string, string] => [name, `${name} is disabled by vm.disabledGlobals`]),
  ]);
  if (!allowConsole) {
    messages.set(
      'console',
      'console is not available in CodeCall scripts unless vm.allowConsole is true; use mcpLog(level, message)',
    );
  }
  return messages;
}

function scriptPolicyRules(options: ScriptPolicyOptions): ValidationRule[] {
  const alternatives = new Map(unavailableGlobals().map(({ name, alternative }) => [name, alternative]));
  const rules: ValidationRule[] = [
    new DisallowedGlobalsRule(disallowedGlobalMessages(options)),
    new UnavailableGlobalsRule(alternatives),
  ];
  if (!options.allowLoops) {
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
 * The places a script uses a loop `vm.allowLoops: false` turns off, a global `vm.disabledBuiltins` or
 * `vm.disabledGlobals` lists, `console` without `vm.allowConsole: true`, or a global the sandbox doesn't have
 * (`Set`, `Promise`, ...), in the script's own lines. The sandbox takes no option for the first three and has no
 * advice for the last, so CodeCall checks before it runs the script, parsing it the way the sandbox does. A script
 * none of those parses accept is left to the sandbox, which fails on the same parse and reports the syntax error.
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
