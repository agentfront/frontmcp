// file: plugins/plugin-codecall/src/utils/script-lines.ts

import { isWrappedInMain, transformAgentScript } from '@enclave-vm/ast';
import * as acorn from 'acorn';

/**
 * Lines in the enclave's AgentScript validation messages, mapped back to the script's own lines.
 *
 * The enclave validates the script after transforming it: it wraps the statements in
 * `async function __ag_main() { … }`, adds a counter before every loop and a check at the start of
 * its body, and prints the result again, one statement per line, without the script's comments and
 * blank lines. The lines a validation issue names (`FORBIDDEN_LOOP (line 5): …`) are lines of that
 * printed code, not of the script: two past the script's line for a loop on the first lines, and
 * further off after any block the script wrote on one line.
 *
 * The transform only renames identifiers and adds those nodes, so the printed code, parsed again,
 * has the script's statements in the same places. Walking both trees side by side pairs every node
 * of the printed code with the script's own, and so every printed line with a script line.
 */

interface AstNode {
  type: string;
  loc?: acorn.SourceLocation | null;
  [key: string]: unknown;
}

/** What `transformAgentScript` prints a script as, and the script's own tree to pair it with. */
interface Trees {
  printed: AstNode[];
  script: AstNode[];
  /** Lines to subtract from the script tree's lines (1 when it had to be parsed inside a function). */
  offset: number;
}

const PARSE_OPTIONS = { ecmaVersion: 'latest', locations: true } as const;

/** Keys of an AST node that hold no child node. */
const NON_CHILD_KEYS = new Set(['type', 'loc', 'start', 'end', 'range']);

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** A node the loop transform added: `let __iter_N = 0;` before a loop, `if (++__iter_N > __maxIterations) throw …` in it. */
function isAddedByTransform(node: AstNode): boolean {
  if (node.type === 'VariableDeclaration') {
    const [declaration] = (node['declarations'] as AstNode[] | undefined) ?? [];
    const id = declaration?.['id'] as AstNode | undefined;
    return typeof id?.['name'] === 'string' && (id['name'] as string).startsWith('__iter_');
  }
  if (node.type === 'IfStatement') {
    const right = (node['test'] as AstNode | undefined)?.['right'] as AstNode | undefined;
    return right?.type === 'Identifier' && right['name'] === '__maxIterations';
  }
  return false;
}

/** The script parsed the way `transformAgentScript` parses it: as a script, a module, then inside a function. */
function parseScript(script: string): { body: AstNode[]; offset: number } {
  try {
    return { body: parseBody(script, 'script'), offset: 0 };
  } catch {
    try {
      return { body: parseBody(script, 'module'), offset: 0 };
    } catch {
      const wrapped = parseBody(`async function __temp__() {\n${script}\n}`, 'script');
      const fn = wrapped[0];
      const block = fn?.['body'] as AstNode | undefined;
      return { body: (block?.['body'] as AstNode[] | undefined) ?? [], offset: 1 };
    }
  }
}

function parseBody(code: string, sourceType: 'script' | 'module'): AstNode[] {
  const program = acorn.parse(code, { ...PARSE_OPTIONS, sourceType }) as unknown as AstNode;
  return (program['body'] as AstNode[] | undefined) ?? [];
}

function treesOf(script: string): Trees | undefined {
  try {
    const wrap = !isWrappedInMain(script);
    const printed = parseBody(transformAgentScript(script, { wrapInMain: wrap }), 'script');
    const { body, offset } = parseScript(script);
    if (!wrap) return { printed, script: body, offset };
    const main = printed[0]?.['body'] as AstNode | undefined;
    return { printed: (main?.['body'] as AstNode[] | undefined) ?? [], script: body, offset };
  } catch {
    return undefined;
  }
}

interface PairedLines {
  printedStart: number;
  printedEnd: number;
  scriptLine: number;
  depth: number;
}

function pairLists(printed: unknown[], script: unknown[], depth: number, out: PairedLines[], offset: number): void {
  const kept = printed.filter((node) => !(isNode(node) && isAddedByTransform(node)));
  if (kept.length !== script.length) return;
  kept.forEach((node, index) => {
    const own = script[index];
    if (isNode(node) && isNode(own)) pairNodes(node, own, depth, out, offset);
  });
}

function pairNodes(printed: AstNode, script: AstNode, depth: number, out: PairedLines[], offset: number): void {
  // The transform makes a trailing expression the script's return value: `x + 1` prints as `return x + 1`.
  if (printed.type === 'ReturnStatement' && script.type === 'ExpressionStatement') {
    record(printed, script, depth, out, offset);
    const argument = printed['argument'];
    const expression = script['expression'];
    if (isNode(argument) && isNode(expression)) pairNodes(argument, expression, depth + 1, out, offset);
    return;
  }
  if (printed.type !== script.type) return;
  record(printed, script, depth, out, offset);
  for (const key of Object.keys(printed)) {
    if (NON_CHILD_KEYS.has(key)) continue;
    const printedChild = printed[key];
    const scriptChild = script[key];
    if (Array.isArray(printedChild) && Array.isArray(scriptChild)) {
      pairLists(printedChild, scriptChild, depth + 1, out, offset);
    } else if (isNode(printedChild) && isNode(scriptChild)) {
      pairNodes(printedChild, scriptChild, depth + 1, out, offset);
    }
  }
}

function record(printed: AstNode, script: AstNode, depth: number, out: PairedLines[], offset: number): void {
  if (!printed.loc || !script.loc) return;
  out.push({
    printedStart: printed.loc.start.line,
    printedEnd: printed.loc.end.line,
    scriptLine: script.loc.start.line - offset,
    depth,
  });
}

/**
 * A function from a line of the code the enclave validated (for this script) to the script's own
 * line, or `undefined` for a line that is none of the script's (the wrapper, a line the loop
 * transform added) or a script that can't be parsed.
 *
 * @param script The script as the caller sent it
 */
export function validatedLineMapper(script: string): (printedLine: number) => number | undefined {
  const trees = treesOf(script);
  if (!trees) return () => undefined;
  const pairs: PairedLines[] = [];
  pairLists(trees.printed, trees.script, 0, pairs, trees.offset);
  return (printedLine) => {
    // An issue names the line its node starts on: take the deepest node starting there, else the
    // deepest node the line falls inside.
    const starting = pairs.filter((pair) => pair.printedStart === printedLine);
    const candidates =
      starting.length > 0
        ? starting
        : pairs.filter((pair) => pair.printedStart <= printedLine && printedLine <= pair.printedEnd);
    const best = candidates.reduce<PairedLines | undefined>(
      (deepest, pair) => (!deepest || pair.depth > deepest.depth ? pair : deepest),
      undefined,
    );
    return best && best.scriptLine >= 1 ? best.scriptLine : undefined;
  };
}

/** An issue line in an AgentScript validation message: `FORBIDDEN_LOOP (line 5): …`. */
const ISSUE_LINE_RE = / \(line (\d+)\)/g;

/**
 * `message` with the lines its issues name mapped back to the script's own lines. A line that is
 * none of the script's is dropped rather than left pointing at the wrong line.
 */
export function withScriptLines(message: string, script: string): string {
  if (!message.includes('(line ')) return message;
  const lineOf = validatedLineMapper(script);
  return message.replace(ISSUE_LINE_RE, (_match, printed: string) => {
    const line = lineOf(Number(printed));
    return line === undefined ? '' : ` (line ${line})`;
  });
}
