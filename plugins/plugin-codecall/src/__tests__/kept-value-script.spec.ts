import {
  isKeptValueCall,
  keptNamesOf,
  keptValueCallOf,
  withKeptValueFunctions,
} from '../kept-values/kept-value-script';
import type { CodeCallJournalEntry } from '../runs/run-record.types';

const KEEP = "const keep = (name, value) => callTool('codecall:keep', { name, value });";
const RECALL = "const recall = (name) => callTool('codecall:recall', { name });";

describe('withKeptValueFunctions', () => {
  it('runs a script that uses neither function exactly as sent', () => {
    const script = "const users = await callTool('users:list', {});\nreturn users;";

    expect(withKeptValueFunctions(script)).toEqual({ script, recalledNames: [] });
  });

  it('declares only the functions the script uses, on its first line', () => {
    const script = "await keep('overdue', [1, 2]);\nreturn 1;";

    expect(withKeptValueFunctions(script).script).toBe(`${KEEP}${script}`);
    expect(withKeptValueFunctions('return await recall("a");').script).toBe(`${RECALL}return await recall("a");`);
  });

  it('keeps every line of the script on its own number', () => {
    const script = "const a = 1;\nawait keep('a', a);\nreturn await recall('a');";

    const { script: run } = withKeptValueFunctions(script);

    expect(run.split('\n').slice(1)).toEqual(script.split('\n').slice(1));
  });

  it('leaves a function the script declares itself as the script has it', () => {
    const script = 'const keep = [1, 2].filter((n) => n > 1);\nreturn keep;';

    expect(withKeptValueFunctions(script).script).toBe(script);
  });

  it('lists the names the script recalls by a string literal', () => {
    const script =
      "const a = await recall('overdue');\nconst name = 'b';\nconst b = await recall(name);\n" +
      'const c = await parallel([\'x\'], (n) => recall(n));\nreturn [a, b, c, await recall("doc")];';

    expect(withKeptValueFunctions(script).recalledNames).toEqual(['overdue', 'doc']);
  });

  it('leaves a script that does not parse to the sandbox', () => {
    const script = "await keep('a', 1";

    expect(withKeptValueFunctions(script)).toEqual({ script, recalledNames: [] });
  });
});

describe('kept-value calls in the journal', () => {
  it('tells keep and recall from tool calls by their reserved names', () => {
    expect(isKeptValueCall('codecall:keep')).toBe(true);
    expect(isKeptValueCall('codecall:recall')).toBe(true);
    expect(isKeptValueCall('keep')).toBe(false);
    expect(isKeptValueCall('codecall:execute')).toBe(false);
  });

  it('marks a keep or recall entry with its kind and name, and a tool call with neither', () => {
    expect(keptValueCallOf('codecall:keep', { name: 'overdue', value: [1] })).toEqual({
      kind: 'keep',
      name: 'overdue',
    });
    expect(keptValueCallOf('codecall:recall', { name: 'n'.repeat(200) })).toEqual({
      kind: 'recall',
      name: 'n'.repeat(128),
    });
    expect(keptValueCallOf('codecall:recall', { name: 42 })).toEqual({ kind: 'recall' });
    expect(keptValueCallOf('users:list', { name: 'overdue' })).toEqual({});
  });

  it('lists the names a run kept, once each, without failed keeps or recalls', () => {
    const entry = (fields: Partial<CodeCallJournalEntry>): CodeCallJournalEntry => ({
      position: 1,
      tool: 'codecall:keep',
      argumentsHash: 'a'.repeat(64),
      outcome: 'success',
      durationMs: 1,
      ...fields,
    });

    const journal = [
      entry({ kind: 'keep', name: 'overdue' }),
      entry({ kind: 'keep', name: 'failed', outcome: 'failure' }),
      entry({ kind: 'recall', name: 'old', tool: 'codecall:recall' }),
      entry({ kind: 'keep', name: 'overdue' }),
      entry({ kind: 'keep', name: 'totals' }),
      entry({ tool: 'users:list' }),
    ];

    expect(keptNamesOf(journal)).toEqual(['overdue', 'totals']);
  });
});
