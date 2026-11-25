import { analyzeScopes } from '@enclave-vm/ast';
import * as acorn from 'acorn';

import type { CodeCallJournalEntry } from '../runs/run-record.types';

/** The reserved name a script's `keep(name, value)` reaches the tool handler under; CodeCall answers it itself. */
export const KEEP_CALL_NAME = 'codecall:keep';

/** The reserved name a script's `recall(name)` reaches the tool handler under; CodeCall answers it itself. */
export const RECALL_CALL_NAME = 'codecall:recall';

/** The longest name a script can keep a value under. */
export const MAX_KEPT_NAME_CHARS = 128;

type KeptValueFunction = 'keep' | 'recall';

/** Each function as the script gets it: a `callTool()` of its reserved name, so it is journaled like a tool call. */
const DECLARATIONS: Readonly<Record<KeptValueFunction, string>> = {
  keep: `const keep = (name, value) => callTool('${KEEP_CALL_NAME}', { name, value });`,
  recall: `const recall = (name) => callTool('${RECALL_CALL_NAME}', { name });`,
};

const FUNCTIONS: readonly KeptValueFunction[] = ['keep', 'recall'];

const MENTIONS_FUNCTION = /\b(?:keep|recall)\b/;

type ScriptReference = ReturnType<typeof analyzeScopes>['freeReferences'][number];

interface CallNode {
  type: string;
  callee?: unknown;
  arguments?: ReadonlyArray<{ type?: string; value?: unknown }>;
}

/** What a script runs as, with `keep` and `recall`. */
export interface KeptValueScript {
  /** The script, with `keep` and `recall` declared on its first line where it uses them as globals. */
  script: string;
  /** The names it recalls by a string literal, whose large kept values its run starts with. */
  recalledNames: string[];
}

/** Whether a tool handler call is a `keep` or a `recall`. */
export function isKeptValueCall(callName: string): boolean {
  return callName === KEEP_CALL_NAME || callName === RECALL_CALL_NAME;
}

/** The journal fields of a `keep` or `recall`; none for a tool call. */
export function keptValueCallOf(callName: string, args: unknown): Pick<CodeCallJournalEntry, 'kind' | 'name'> {
  if (!isKeptValueCall(callName)) return {};
  const name = (args as { name?: unknown } | null | undefined)?.name;
  return {
    kind: callName === KEEP_CALL_NAME ? 'keep' : 'recall',
    ...(typeof name === 'string' && { name: name.slice(0, MAX_KEPT_NAME_CHARS) }),
  };
}

/** The names a run's `keep` calls kept, each once, in the order they were first kept. */
export function keptNamesOf(journal: readonly CodeCallJournalEntry[]): string[] {
  const kept = journal.flatMap((entry) =>
    entry.kind === 'keep' && entry.outcome === 'success' && entry.name !== undefined ? [entry.name] : [],
  );
  return [...new Set(kept)];
}

function parsedScript(script: string): acorn.Node | undefined {
  try {
    return acorn.parse(script, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch {
    return undefined;
  }
}

function literalNameOf({ node, parent }: ScriptReference): string | undefined {
  const call = parent as CallNode | undefined;
  if (call?.type !== 'CallExpression' || call.callee !== node) return undefined;
  const [first] = call.arguments ?? [];
  return first?.type === 'Literal' && typeof first.value === 'string' ? first.value : undefined;
}

/**
 * The script with `keep` and `recall` declared where it uses them as globals, so a script that declares its own
 * keeps it and a script that uses neither runs exactly as sent. The declarations go before its first line, on that
 * line, so every line keeps its number. A script that doesn't parse is left to the sandbox to refuse.
 */
export function withKeptValueFunctions(script: string): KeptValueScript {
  const program = MENTIONS_FUNCTION.test(script) ? parsedScript(script) : undefined;
  if (!program) return { script, recalledNames: [] };
  const globals = analyzeScopes(program).freeReferences.filter((reference) =>
    FUNCTIONS.includes(reference.name as KeptValueFunction),
  );
  const used = new Set(globals.map((reference) => reference.name));
  const declarations = FUNCTIONS.filter((name) => used.has(name)).map((name) => DECLARATIONS[name]);
  const recalledNames = globals
    .filter((reference) => reference.name === 'recall')
    .map(literalNameOf)
    .filter((name): name is string => name !== undefined);
  return { script: declarations.join('') + script, recalledNames };
}
