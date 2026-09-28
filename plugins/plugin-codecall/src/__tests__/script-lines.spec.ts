/**
 * The enclave validates a script after wrapping it in `async function __ag_main()`, adding loop
 * counters and printing it again one statement per line; its issues name lines of that code.
 * `validatedLineMapper` maps them back to the script's own lines.
 */
import { transformAgentScript } from '@enclave-vm/ast';

import { validatedLineMapper, withScriptLines } from '../utils/script-lines';

/** The line of the printed code (what the enclave validated) that the first line containing `needle` is on. */
function printedLineOf(script: string, needle: string, wrapInMain = true): number {
  const printed = transformAgentScript(script, { wrapInMain }).split('\n');
  const index = printed.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`"${needle}" is not in the printed code:\n${printed.join('\n')}`);
  return index + 1;
}

describe('validatedLineMapper', () => {
  it.each([
    [
      'statements on their own lines',
      'const a = 1;\nlet page = 1;\nwhile (page < 3) { page++; }\nreturn a;',
      'while',
      3,
    ],
    [
      'a block written on one line before it',
      'if (1) { const u = 1; const v = 2; }\nwhile (true) { break; }',
      'while',
      2,
    ],
    ['comments and blank lines before it', '// note\n\n\nwhile (true) { break; }', 'while', 4],
    [
      'top-level await (parsed inside a function)',
      'const a = await callTool("x", {});\nwhile (a) { break; }',
      'while',
      2,
    ],
    ['a trailing expression, printed as a return', 'const a = 1;\n\na + 1', 'return', 3],
  ])('maps a line after %s to the script line', (_label, script, needle, line) => {
    expect(validatedLineMapper(script)(printedLineOf(script, needle))).toBe(line);
  });

  it('maps statements inside a loop body to their own lines', () => {
    const script = 'let n = 0;\nwhile (n < 3) {\n  n++;\n\n  const twice = n * 2;\n}\nreturn n;';

    expect(validatedLineMapper(script)(printedLineOf(script, 'twice'))).toBe(5);
  });

  it('maps a for...of loop, whose iterable the transform wraps, to its line', () => {
    const script = 'const items = [1, 2];\n\nfor (const item of items) { const x = item; }';

    expect(validatedLineMapper(script)(printedLineOf(script, 'for (const'))).toBe(3);
  });

  it('maps a script already wrapped in __ag_main', () => {
    const script = 'async function __ag_main() {\n  const a = 1;\n\n  while (a) { break; }\n}';

    expect(validatedLineMapper(script)(printedLineOf(script, 'while', false))).toBe(4);
  });

  it('maps no script line to the wrapper or to a line the loop transform added', () => {
    const script = 'while (true) { break; }';
    const lineOf = validatedLineMapper(script);

    expect(lineOf(1)).toBeUndefined(); // async function __ag_main() {
    expect(lineOf(printedLineOf(script, 'while'))).toBe(1);
  });

  it('maps nothing for a script that does not parse', () => {
    expect(validatedLineMapper('const = ;')(2)).toBeUndefined();
  });
});

describe('withScriptLines', () => {
  const script = 'const q = 1; const r = 2;\nwhile (true) { break; }';
  const printed = printedLineOf(script, 'while');

  it('rewrites every issue line of a validation message', () => {
    const message = `AgentScript validation failed:\nFORBIDDEN_LOOP (line ${printed}): Loops\nINFINITE_LOOP (line ${printed}): Always true`;

    expect(withScriptLines(message, script)).toBe(
      'AgentScript validation failed:\nFORBIDDEN_LOOP (line 2): Loops\nINFINITE_LOOP (line 2): Always true',
    );
  });

  it('drops a line that is none of the script’s instead of keeping a wrong one', () => {
    expect(withScriptLines('AgentScript validation failed:\nRULE (line 1): Something', script)).toBe(
      'AgentScript validation failed:\nRULE: Something',
    );
  });

  it('leaves a message without issue lines unchanged', () => {
    expect(withScriptLines('AgentScript validation failed:\nRULE: Something', script)).toBe(
      'AgentScript validation failed:\nRULE: Something',
    );
  });
});
