import { compareCall, replayedAnswerOf, type RecordedCall } from '../replay-diff';

const toolCall = (fields: Partial<RecordedCall>): RecordedCall => ({ method: 'tools/call', name: 'quote', ...fields });

const answer = (structuredContent: Record<string, unknown>) => ({
  answer: { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent },
});

describe('replayedAnswerOf', () => {
  it('reads a JSON-RPC error as an error, without the MCP error prefix of its message', () => {
    expect(replayedAnswerOf({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'gone' } })).toEqual({
      error: { code: -32002, message: 'gone' },
    });
    const prefixed = { code: -32002, message: 'MCP error -32002: Resource not found: notes://gone' };
    expect(replayedAnswerOf({ jsonrpc: '2.0', id: 1, error: prefixed })).toEqual({
      error: { code: -32002, message: 'Resource not found: notes://gone' },
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

  it('does not compare what the recording redacted inside a text, such as a folded answer handle', () => {
    const folded = (handle: string) => ({
      answer: {
        content: [{ type: 'text', text: `Read the rest with result_query and handle "${handle}" in 600 seconds` }],
        structuredContent: { preview: [1], handle },
        _meta: { 'frontmcp/result-handle': { handle, bytes: 20000, ttlSeconds: 600 } },
      },
    });
    const recorded = toolCall(folded('[REDACTED]'));
    expect(compareCall(recorded, folded('9c1e-new'))).toEqual({ outcome: 'same', changes: [] });
    const reworded = folded('9c1e-new');
    reworded.answer.content[0].text = 'Read the rest with handle "9c1e-new" in 600 seconds';
    expect(compareCall(recorded, reworded).changes.map(({ path }) => path)).toEqual(['content.0.text']);
    const twice = toolCall({ answer: 'Bearer [REDACTED] then [REDACTED].' });
    expect(compareCall(twice, { answer: 'Bearer tok-1 then tok-2.' }).outcome).toBe('same');
    expect(compareCall(twice, { answer: 'Bearer tok-1 then tok-2!' }).outcome).toBe('changed');
    expect(compareCall(twice, { answer: 'Bearer' }).outcome).toBe('changed');
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
    expect(compareCall(toolCall(failed), { error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' } })).toEqual({
      outcome: 'same',
      changes: [],
      error: failed.error,
    });
    expect(compareCall(toolCall(failed), { error: { code: 'INTERNAL_ERROR', message: 'boom' } })).toEqual({
      outcome: 'changed',
      changes: [{ path: 'error.code', recorded: 'LEDGER_OFFLINE', replayed: 'INTERNAL_ERROR' }],
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
  });

  it("reports a public error's reworded message, unless told to ignore it", () => {
    const failed = toolCall({ error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' } });
    const reworded = { error: { code: 'LEDGER_OFFLINE', message: 'ledger closed for the night' } };
    expect(compareCall(failed, reworded)).toEqual({
      outcome: 'changed',
      changes: [{ path: 'error.message', recorded: 'ledger offline', replayed: 'ledger closed for the night' }],
      error: reworded.error,
    });
    expect(compareCall(failed, reworded, { ignore: ['error.message'] }).outcome).toBe('same');
    const redacted = toolCall({ error: { code: 'TOKEN_EXPIRED', message: 'token [REDACTED] has expired' } });
    expect(compareCall(redacted, { error: { code: 'TOKEN_EXPIRED', message: 'token eyJx has expired' } }).outcome).toBe(
      'same',
    );
  });

  it('compares only the code of an internal error, whose message the recording does not keep', () => {
    const internal = toolCall({ error: { code: 'TOOL_EXECUTION_ERROR' } });
    const replayed = { error: { code: 'TOOL_EXECUTION_ERROR', message: 'Internal FrontMCP error: err_1' } };
    expect(compareCall(internal, replayed).outcome).toBe('same');
  });
});
