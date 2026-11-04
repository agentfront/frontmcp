import type * as EnclaveAst from '@enclave-vm/ast';
import type { BrowserEnclave } from '@enclave-vm/browser';
import type { InterpreterAdapter } from '@enclave-vm/core/worker';

import { isBrowserPage } from './browser-runtime';

const MAX_STEPS = 2_000_000;
const MAX_TOOL_CALLS = 25;
const TIMEOUT_MS = 8_000;

/** The input key the options of a script's `callTool` travel under: each sandbox passes its tool handler two arguments. */
const CALL_OPTIONS_KEY = '__callToolOptions';

/** The script's `callTool(actionId, input, options)`, declared ahead of its program, folds the options into the input. */
const CALL_TOOL_PRELUDE = `async function callTool(actionId, input, options) {
  return __safe_callTool(actionId, options == null ? input : { ...input, ${CALL_OPTIONS_KEY}: options });
}`;

/** What a script's `await callTool(actionId, input)` runs: the only way the script touches the outside world. */
export type WorkflowToolHandler = (
  actionId: string,
  scriptInput: Record<string, unknown> | undefined,
) => Promise<unknown>;

export interface WorkflowRunResult {
  success: boolean;
  value?: unknown;
  error?: { message: string };
  stats: { duration: number; toolCallCount: number; iterationCount: number };
}

/** Where a workflow's script runs: each sandbox allows 25 calls and 8 seconds, and gives `callTool` the same options. */
export interface WorkflowSandbox {
  /** The program the script runs as; throws for a script that doesn't parse. */
  compile(script: string): Promise<string>;
  run(program: string, toolHandler: WorkflowToolHandler): Promise<WorkflowRunResult>;
}

/** The iframe sandbox in a browser page, which has the DOM it needs, and the interpreter everywhere else. */
export function loadWorkflowSandbox(): Promise<WorkflowSandbox | { unavailable: string }> {
  return isBrowserPage() ? loadBrowserSandbox() : loadInterpreterSandbox();
}

/** A script's `callTool` input without the options folded into it, and whether a failed call throws. */
export function splitCallOptions(scriptInput: Record<string, unknown> | undefined): {
  input: Record<string, unknown>;
  throwOnError: boolean;
} {
  const { [CALL_OPTIONS_KEY]: options, ...input } = scriptInput ?? {};
  const quiet =
    typeof options === 'object' && options !== null && 'throwOnError' in options && options.throwOnError === false;
  return { input, throwOnError: !quiet };
}

async function loadInterpreterSandbox(): Promise<WorkflowSandbox | { unavailable: string }> {
  try {
    const { transformAgentScript } = await import('@enclave-vm/ast');
    const { InterpreterAdapter } = await import('@enclave-vm/core/worker');
    return interpreterSandbox(transformAgentScript, InterpreterAdapter);
  } catch {
    return unavailableSandbox('@enclave-vm/core');
  }
}

async function loadBrowserSandbox(): Promise<WorkflowSandbox | { unavailable: string }> {
  try {
    const ast = await import('@enclave-vm/ast');
    const { BrowserEnclave } = await import('@enclave-vm/browser');
    return browserSandbox(ast, BrowserEnclave);
  } catch {
    return unavailableSandbox('@enclave-vm/browser');
  }
}

function unavailableSandbox(sandboxPackage: string): { unavailable: string } {
  return {
    unavailable: `workflow execution unavailable: the @enclave-vm sandbox is not installed. Install ${sandboxPackage} and @enclave-vm/ast to enable run_workflow.`,
  };
}

function interpreterSandbox(
  transformAgentScript: typeof EnclaveAst.transformAgentScript,
  Interpreter: typeof InterpreterAdapter,
): WorkflowSandbox {
  return {
    // No loop rewrite: the interpreter enforces its own step budget, and the loop helpers aren't in its scope.
    compile: async (script) =>
      `${CALL_TOOL_PRELUDE}\n${transformAgentScript(script, { transformLoops: false, additionalIdentifiers: ['callTool'] })}`,
    run: (program, toolHandler) => {
      const adapter = new Interpreter({ maxSteps: MAX_STEPS });
      const context = {
        config: { maxToolCalls: MAX_TOOL_CALLS, timeout: TIMEOUT_MS },
        stats: { duration: 0, toolCallCount: 0, iterationCount: 0, startTime: 0 },
        abortController: new AbortController(),
        aborted: false,
        toolHandler,
      };
      // enclave >= 2.14 types the context's config as its full config, of which the interpreter reads these two fields.
      return adapter.execute(program, context as Parameters<typeof adapter.execute>[1]);
    },
  };
}

function browserSandbox(ast: typeof EnclaveAst, Enclave: typeof BrowserEnclave): WorkflowSandbox {
  return {
    compile: (script) => foldCallToolOptions(ast, script),
    run: async (program, toolHandler) => {
      const enclave = new Enclave({ timeout: TIMEOUT_MS, maxToolCalls: MAX_TOOL_CALLS });
      try {
        return await enclave.run(program, toolHandler);
      } finally {
        enclave.dispose();
      }
    },
  };
}

/** The browser sandbox hands its tool handler the input alone, so each call's options are moved into it, as the prelude does. */
async function foldCallToolOptions(ast: typeof EnclaveAst, script: string): Promise<string> {
  const wrapped = ast.transformAgentScript(script, { transformCallTool: false, transformLoops: false });
  const { ast: program, parseError } = await new ast.JSAstValidator([]).validate(wrapped);
  if (!program) throw parseError ?? new Error('the script could not be parsed');
  foldOptionsOfCalls(program);
  return ast.generateCode(program);
}

interface SyntaxNode {
  type: string;
  [field: string]: unknown;
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return typeof value === 'object' && value !== null && typeof (value as Partial<SyntaxNode>).type === 'string';
}

function isCallToolWithOptions(node: SyntaxNode): node is SyntaxNode & { arguments: SyntaxNode[] } {
  const { callee, arguments: callArguments } = node;
  return (
    node.type === 'CallExpression' &&
    isSyntaxNode(callee) &&
    callee.type === 'Identifier' &&
    callee['name'] === 'callTool' &&
    Array.isArray(callArguments) &&
    callArguments.length === 3 &&
    callArguments.every((argument) => isSyntaxNode(argument) && argument.type !== 'SpreadElement')
  );
}

/** Rewrites each `callTool(actionId, input, options)` in the tree to `callTool(actionId, { ...input, __callToolOptions: options })`. */
function foldOptionsOfCalls(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(foldOptionsOfCalls);
    return;
  }
  if (!isSyntaxNode(node)) return;
  Object.values(node).forEach(foldOptionsOfCalls);
  if (!isCallToolWithOptions(node)) return;
  const [actionId, input, options] = node.arguments;
  const optionsProperty = {
    type: 'Property',
    kind: 'init',
    key: { type: 'Identifier', name: CALL_OPTIONS_KEY },
    value: options,
    computed: false,
    method: false,
    shorthand: false,
  };
  node.arguments = [
    actionId,
    { type: 'ObjectExpression', properties: [{ type: 'SpreadElement', argument: input }, optionsProperty] },
  ];
}
