// file: plugins/plugin-codecall/src/security/script-policy.ts

import {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  JSAstValidator,
  type ValidationIssue,
  type ValidationRule,
} from '@enclave-vm/ast';

import type { ResolvedCodeCallVmOptions } from '../codecall.symbol';

type ScriptPolicyOptions = Pick<ResolvedCodeCallVmOptions, 'allowLoops'>;

const AGENTSCRIPT_PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
} as const;

function scriptPolicyRules({ allowLoops }: ScriptPolicyOptions): ValidationRule[] {
  const rules: ValidationRule[] = [
    new DisallowedIdentifierRule({
      disallowed: ['console'],
      messageTemplate: 'console is not available in CodeCall scripts; use mcpLog(level, message)',
    }),
  ];
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
 * checks before it runs the script. A script that does not parse is left to the sandbox, which
 * reports the syntax error.
 */
export async function findScriptPolicyIssues(code: string, options: ScriptPolicyOptions): Promise<ValidationIssue[]> {
  const result = await new JSAstValidator(scriptPolicyRules(options)).validate(code, {
    parseOptions: AGENTSCRIPT_PARSE_OPTIONS,
    preScan: { enabled: false },
  });
  return result.parseError ? [] : result.issues;
}
