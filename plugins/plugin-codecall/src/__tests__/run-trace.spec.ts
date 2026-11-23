import { createToolCallError, TOOL_CALL_ERROR_CODES } from '../errors';
import { RunJournal } from '../runs/run-journal';
import { traceOf, valuePreviewOf } from '../runs/run-trace';

const failure = { level: 'failure', maxLines: 20, values: false } as const;

function journalOf(calls: number, options: { keepValues?: boolean } = {}): RunJournal {
  jest.spyOn(Date, 'now').mockReturnValue(1_000);
  const journal = new RunJournal(options);
  for (let position = 1; position <= calls; position += 1) {
    journal.begin('users.get', { id: position }).succeed({ id: position });
  }
  return journal;
}

describe('traceOf', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists a failed run's calls at the failure level: position, tool, outcome, duration and size", () => {
    const journal = journalOf(1);
    journal
      .begin('users.update', { id: 1, name: 'Ada' })
      .fail(createToolCallError(TOOL_CALL_ERROR_CODES.VALIDATION, 'users.update'));

    expect(traceOf('tool_error', journal, failure)).toEqual([
      '1. users.get: success, 0 ms, 8 bytes',
      '2. users.update: failure (input), 0 ms',
    ]);
  });

  it('lists nothing for a run that returned at the failure level, nor for any run when off', () => {
    expect(traceOf('ok', journalOf(2), failure)).toBeUndefined();
    expect(traceOf('runtime_error', journalOf(2), { ...failure, level: 'off' })).toBeUndefined();
  });

  it("lists every run's calls at the calls level, and nothing for a run without calls", () => {
    expect(traceOf('ok', journalOf(2), { ...failure, level: 'calls' })).toHaveLength(2);
    expect(traceOf('syntax_error', journalOf(0), failure)).toBeUndefined();
  });

  it('keeps the last calls within maxLines, counting the earlier ones in its first line', () => {
    expect(traceOf('timeout', journalOf(5), { ...failure, maxLines: 3 })).toEqual([
      '3 earlier calls not shown',
      '4. users.get: success, 0 ms, 8 bytes',
      '5. users.get: success, 0 ms, 8 bytes',
    ]);
    expect(traceOf('timeout', journalOf(5), { ...failure, maxLines: 1 })).toEqual(['5 earlier calls not shown']);
  });

  it("shows a call's arguments, and a successful call's result, only with values", () => {
    const journal = journalOf(1, { keepValues: true });
    journal.begin('users.delete', { id: 2 }).fail(createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, 'users.delete'));

    expect(traceOf('tool_error', journal, { ...failure, values: true })).toEqual([
      '1. users.get: success, 0 ms, 8 bytes, arguments {"id":1}, result {"id":1}',
      '2. users.delete: failure (execute), 0 ms, arguments {"id":2}',
    ]);
  });
});

describe('valuePreviewOf', () => {
  it('cuts JSON to 200 characters, and names undefined', () => {
    expect(valuePreviewOf('x'.repeat(300))).toBe(`"${'x'.repeat(199)}...`);
    expect(valuePreviewOf(undefined)).toBe('undefined');
  });
});
