import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import { createToolCallError, SelfReferenceError, TOOL_CALL_ERROR_CODES } from '../errors';
import { jsonBytes, RunJournal } from '../runs/run-journal';

describe('RunJournal', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('numbers calls in the order the tool handler was entered, whatever order they settle in', () => {
    const journal = new RunJournal();
    const first = journal.begin('users.get', { id: 1 });
    const second = journal.begin('users.list', {});
    second.succeed({ users: [] });
    first.fail(createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, 'users.get'));

    expect(journal.close().map(({ position, tool, outcome }) => ({ position, tool, outcome }))).toEqual([
      { position: 1, tool: 'users.get', outcome: 'failure' },
      { position: 2, tool: 'users.list', outcome: 'success' },
    ]);
  });

  it('hashes the canonical JSON of the arguments, so key order does not change the hash', () => {
    const journal = new RunJournal();
    journal.begin('users.find', { name: 'Ada', limit: 2 });
    journal.begin('users.find', { limit: 2, name: 'Ada' });

    const [first, second] = journal.close();
    expect(first.argumentsHash).toBe(sha256Hex(canonicalJson({ limit: 2, name: 'Ada' })));
    expect(second.argumentsHash).toBe(first.argumentsHash);
  });

  it('hashes arguments canonical JSON refuses by their JSON text', () => {
    const journal = new RunJournal();
    journal.begin('users.tag', [undefined]);
    journal.begin('users.list', undefined);

    const [array, none] = journal.close();
    expect(array.argumentsHash).toBe(sha256Hex('[null]'));
    expect(none.argumentsHash).toBe(sha256Hex('null'));
  });

  it.each([
    [TOOL_CALL_ERROR_CODES.ACCESS_DENIED, 'access'],
    [TOOL_CALL_ERROR_CODES.NOT_FOUND, 'access'],
    [TOOL_CALL_ERROR_CODES.VALIDATION, 'input'],
    [TOOL_CALL_ERROR_CODES.RATE_LIMITED, 'limit'],
    [TOOL_CALL_ERROR_CODES.EXECUTION, 'execute'],
    [TOOL_CALL_ERROR_CODES.TIMEOUT, 'execute'],
  ])('records a call that failed with %s in the %s phase', (code, phase) => {
    const journal = new RunJournal();
    journal.begin('users.get', {}).fail(createToolCallError(code, 'users.get'));

    expect(journal.close()[0]).toMatchObject({ outcome: 'failure', phase });
  });

  it('records a self-reference in the access phase, and an error without a code in the execute phase', () => {
    const journal = new RunJournal();
    journal.begin('codecall:execute', {}).fail(new SelfReferenceError('codecall:execute'));
    journal.begin('users.get', {}).fail(new Error('boom'));
    journal.begin('users.get', {}).fail(null);

    expect(journal.close().map((entry) => entry.phase)).toEqual(['access', 'execute', 'execute']);
  });

  it("records a result's size and duration, and the result itself only with keepResults", () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const result = { id: 1, name: 'Zoë' };
    const without = new RunJournal();
    const withResults = new RunJournal({ keepResults: true });
    const plain = without.begin('users.get', { id: 1 });
    const kept = withResults.begin('users.get', { id: 1 });
    now.mockReturnValue(1_025);
    plain.succeed(result);
    kept.succeed(result);

    const [plainEntry] = without.close();
    expect(plainEntry).toEqual({
      position: 1,
      tool: 'users.get',
      argumentsHash: sha256Hex('{"id":1}'),
      outcome: 'success',
      durationMs: 25,
      resultBytes: jsonBytes(result),
    });
    expect(withResults.close()[0]).toMatchObject({ resultBytes: jsonBytes(result), result });
  });

  it('keeps and measures a detached copy of a result, which the script changing it later does not reach', () => {
    const journal = new RunJournal({ keepResults: true });
    const result = { items: [1] };
    journal.begin('items.list', {}).succeed(result);
    result.items.push(2);

    const [entry] = journal.close();
    expect(entry.result).toEqual({ items: [1] });
    expect(entry.resultBytes).toBe(jsonBytes({ items: [1] }));
  });

  it('leaves a call still running at close unfinished, and changes nothing after', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(5_000);
    const journal = new RunJournal({ keepResults: true });
    const running = journal.begin('users.slow', {});
    now.mockReturnValue(5_300);

    const entries = journal.close();
    running.succeed({ late: true });
    running.fail(new Error('late'));

    expect(entries).toEqual([expect.objectContaining({ position: 1, outcome: 'unfinished', durationMs: 300 })]);
    expect(entries[0]).not.toHaveProperty('result');
    expect(journal.close()).toBe(entries);
  });

  it('keeps the first 128 characters of a tool name', () => {
    const journal = new RunJournal();
    journal.begin('x'.repeat(5000), {});

    expect(journal.close()[0].tool).toBe('x'.repeat(128));
  });

  it('tells its observer when each call starts and ends, with the values only when it keeps them', () => {
    const started: number[] = [];
    const ended: Array<[number, string, unknown]> = [];
    const observer = {
      callStarted: (entry: { position: number }) => started.push(entry.position),
      callEnded: (entry: { position: number; outcome: string }, values?: unknown) =>
        ended.push([entry.position, entry.outcome, values]),
    };
    const journal = new RunJournal({ keepValues: true, observer });
    journal.begin('users.get', { id: 1 }).succeed({ id: 1 });
    journal.begin('users.get', { id: 2 }).fail(new Error('no'));
    journal.begin('users.slow', {});
    journal.close();

    expect(started).toEqual([1, 2, 3]);
    expect(ended).toEqual([
      [1, 'success', { arguments: { id: 1 }, result: { id: 1 } }],
      [2, 'failure', { arguments: { id: 2 } }],
      [3, 'unfinished', { arguments: {} }],
    ]);
    expect(journal.close()[0]).not.toHaveProperty('result');
  });

  it('keeps no values without keepValues', () => {
    const journal = new RunJournal();
    journal.begin('users.get', { id: 1 }).succeed({ id: 1 });

    expect(journal.valuesOf(journal.close()[0])).toBeUndefined();
  });

  it('settles a call once', () => {
    const journal = new RunJournal();
    const call = journal.begin('users.get', {});
    call.succeed({ id: 1 });
    call.fail(new Error('after success'));

    expect(journal.close()[0]).toMatchObject({ outcome: 'success' });
    expect(journal.close()[0]).not.toHaveProperty('phase');
  });
});

describe('jsonBytes', () => {
  it('counts UTF-8 bytes of the JSON, and nothing for undefined', () => {
    expect(jsonBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').byteLength);
    expect(jsonBytes(undefined)).toBe(0);
  });
});
