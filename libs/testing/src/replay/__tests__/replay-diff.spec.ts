import { compareCall, replayedAnswerOf, type RecordedCall } from '../replay-diff';

const toolCall = (fields: Partial<RecordedCall>): RecordedCall => ({ method: 'tools/call', name: 'quote', ...fields });

const answer = (structuredContent: Record<string, unknown>) => ({
  answer: { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent },
});

describe('replayedAnswerOf', () => {
  it('reads a JSON-RPC error as an error', () => {
    expect(replayedAnswerOf({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'gone' } })).toEqual({
      error: { code: -32002, message: 'gone' },
    });
  });

  it('reads a tool error answer the server formatted as an error with its code', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'ledger offline' }],
      _meta: { errorId: 'e1', code: 'LEDGER_OFFLINE' },
    };
    expect(replayedAnswerOf({ jsonrpc: '2.0', id: 1, result })).toEqual({
      error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' },
    });
  });

  it('reads an isError answer the tool returned itself as an answer', () => {
    const result = { isError: true, content: [{ type: 'text', text: 'no stock' }] };
    expect(replayedAnswerOf({ jsonrpc: '2.0', id: 1, result })).toEqual({ answer: result });
  });
});

describe('compareCall', () => {
  it('finds the same answer the same, though its JSON text is formatted differently', () => {
    const recorded = toolCall({
      answer: { ...answer({ price: 12 }).answer, content: [{ type: 'text', text: '{"price":12}' }] },
    });
    expect(compareCall(recorded, answer({ price: 12 }))).toEqual({ outcome: 'same', changes: [] });
  });

  it('names each path of a changed answer, also inside its JSON text', () => {
    const result = compareCall(toolCall(answer({ price: 12, city: 'Paris' })), answer({ price: 15, city: 'Paris' }));
    expect(result.outcome).toBe('changed');
    expect(result.changes).toEqual([
      { path: 'content.0.text.price', recorded: 12, replayed: 15 },
      { path: 'structuredContent.price', recorded: 12, replayed: 15 },
    ]);
  });

  it('reports keys that were added or removed, and lists of another length', () => {
    const result = compareCall(toolCall({ answer: { rows: [1, 2], old: true } }), {
      answer: { rows: [1], extra: 'x' },
    });
    expect(result.changes).toEqual([
      { path: 'rows.1', recorded: 2, replayed: undefined },
      { path: 'old', recorded: true, replayed: undefined },
      { path: 'extra', recorded: undefined, replayed: 'x' },
    ]);
  });

  it('skips the paths and globs it is told to ignore', () => {
    const recorded = toolCall(answer({ price: 12, quotedAt: '2026-01-01', meta: { id: 'a', nested: { id: 'b' } } }));
    const replayed = answer({ price: 12, quotedAt: '2026-11-02', meta: { id: 'c', nested: { id: 'd' } } });
    expect(compareCall(recorded, replayed, { ignore: ['**.quotedAt', '**.id'] })).toEqual({
      outcome: 'same',
      changes: [],
    });
    expect(
      compareCall(recorded, replayed, { ignore: ['*.quotedAt', 'content', 'structuredContent.meta'] }).outcome,
    ).toBe('same');
    expect(compareCall(recorded, replayed, { ignore: ['structuredContent.quotedAt'] }).outcome).toBe('changed');
  });

  it('does not compare a value the recording redacted', () => {
    const recorded = toolCall(answer({ token: '[REDACTED]', price: 12 }));
    expect(compareCall(recorded, answer({ token: 'tok-live', price: 12 })).outcome).toBe('same');
  });

  it('ignores the id of a folded answer handle unless told to compare it', () => {
    const folded = (handle: string) => ({
      answer: {
        content: [{ type: 'text', text: `Read the rest with result_query and handle "${handle}"` }],
        structuredContent: { preview: [1], handle },
        _meta: { 'frontmcp/result-handle': { handle, bytes: 20000, ttlSeconds: 600 } },
      },
    });
    const recorded = toolCall(folded('2b4f-old'));
    expect(compareCall(recorded, folded('9c1e-new'))).toEqual({ outcome: 'same', changes: [] });
    expect(compareCall(recorded, folded('9c1e-new'), { compareResultHandles: true }).changes).toHaveLength(3);
    expect(compareCall(toolCall(folded('')), folded('')).outcome).toBe('same');
  });

  it('tells a new error, a gone error and an error with another code apart', () => {
    const failed = { error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' } };
    expect(compareCall(toolCall(answer({ price: 12 })), failed)).toEqual({
      outcome: 'new-error',
      changes: [],
      error: failed.error,
    });
    expect(compareCall(toolCall(failed), answer({ price: 12 }))).toEqual({
      outcome: 'gone-error',
      changes: [],
      error: failed.error,
    });
    expect(compareCall(toolCall(failed), { error: { code: 'LEDGER_OFFLINE', message: 'reworded' } }).outcome).toBe(
      'same',
    );
    expect(compareCall(toolCall(failed), { error: { code: 'INTERNAL_ERROR', message: 'boom' } })).toEqual({
      outcome: 'changed',
      changes: [{ path: 'error.code', recorded: 'LEDGER_OFFLINE', replayed: 'INTERNAL_ERROR' }],
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
  });
});
