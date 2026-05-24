import { PassThrough } from 'node:stream';

import { createStdioFramer, type JsonRpcFrame } from '../stdio-framer';

function makeLog() {
  const lines: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
  return {
    lines,
    logger: {
      path: undefined,
      debug: (m: string, d?: Record<string, unknown>) => lines.push({ level: 'debug', message: m, data: d }),
      info: (m: string, d?: Record<string, unknown>) => lines.push({ level: 'info', message: m, data: d }),
      warn: (m: string, d?: Record<string, unknown>) => lines.push({ level: 'warn', message: m, data: d }),
      error: (m: string, d?: Record<string, unknown>) => lines.push({ level: 'error', message: m, data: d }),
      reloadEvent: () => undefined,
      close: async () => undefined,
    },
  };
}

describe('stdio-framer (issue #399)', () => {
  it('parses newline-delimited frames written one byte at a time', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { logger } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({
      input,
      output,
      log: logger,
      onFrame: (f) => {
        frames.push(f);
      },
    });
    framer.start();

    const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n';
    for (const ch of msg) input.write(ch);
    await new Promise((r) => setImmediate(r));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 1, method: 'ping' });
  });

  it('reassembles frames split across chunks', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { logger } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({ input, output, log: logger, onFrame: (f) => frames.push(f) });
    framer.start();

    input.write('{"jsonrpc":"2.0","id":1,"meth');
    input.write('od":"a"}\n{"jsonrpc":"2.0","id":2,');
    input.write('"method":"b"}\n');
    await new Promise((r) => setImmediate(r));

    expect(frames.map((f) => ({ id: f.id, method: f.method }))).toEqual([
      { id: 1, method: 'a' },
      { id: 2, method: 'b' },
    ]);
  });

  it('responds with -32700 parse error on garbage between frames but does not kill the bridge', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));
    const { logger } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({ input, output, log: logger, onFrame: (f) => frames.push(f) });
    framer.start();

    input.write('not json\n');
    input.write('{"jsonrpc":"2.0","id":7,"method":"good"}\n');
    await new Promise((r) => setImmediate(r));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 7, method: 'good' });
    const parseError = written.find((l) => l.includes('-32700'));
    expect(parseError).toBeDefined();
  });

  it('writes a frame as a single newline-terminated JSON line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));
    const { logger } = makeLog();
    const framer = createStdioFramer({ input, output, log: logger, onFrame: () => undefined });
    framer.start();

    await framer.write({ jsonrpc: '2.0', id: 5, result: { ok: true } });
    expect(written.join('')).toBe('{"jsonrpc":"2.0","id":5,"result":{"ok":true}}\n');
  });

  it('drops empty lines silently', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { logger } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({ input, output, log: logger, onFrame: (f) => frames.push(f) });
    framer.start();

    input.write('\n\n\n');
    input.write('{"jsonrpc":"2.0","id":1,"method":"a"}\n');
    await new Promise((r) => setImmediate(r));

    expect(frames).toHaveLength(1);
  });

  it('normalizes CRLF line endings (\\r\\n) just like LF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { logger } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({ input, output, log: logger, onFrame: (f) => frames.push(f) });
    framer.start();

    // Windows/CRLF-shipped JSON-RPC frames must parse the same as LF.
    input.write('{"jsonrpc":"2.0","id":1,"method":"crlf"}\r\n');
    await new Promise((r) => setImmediate(r));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 1, method: 'crlf' });
  });

  it('emits a -32700 parse error for non-object JSON (`42`, "string") and never invokes onFrame', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));
    const { logger, lines } = makeLog();
    const frames: JsonRpcFrame[] = [];
    const framer = createStdioFramer({ input, output, log: logger, onFrame: (f) => frames.push(f) });
    framer.start();

    input.write('42\n');
    input.write('"string"\n');
    await new Promise((r) => setImmediate(r));

    // Neither bare value reached onFrame — they're valid JSON but the
    // JSON-RPC envelope MUST be an object, so the framer rejects them
    // upstream of onFrame.
    expect(frames).toHaveLength(0);
    // Two `not_object` parse-error log entries (one per malformed line).
    const notObjectWarnings = lines.filter((l) => l.message === 'parse-error' && l.data?.['reason'] === 'not_object');
    expect(notObjectWarnings).toHaveLength(2);
    // The framer should also write two -32700 error responses on the wire.
    const parseErrorResponses = written.filter((l) => l.includes('-32700'));
    expect(parseErrorResponses).toHaveLength(2);
  });

  it('write() defers resolution until the output stream drains under backpressure', async () => {
    const input = new PassThrough();
    // Tiny highWaterMark forces `write()` to return false immediately.
    const output = new PassThrough({ highWaterMark: 1 });
    const { logger } = makeLog();
    const framer = createStdioFramer({ input, output, log: logger, onFrame: () => undefined });
    framer.start();

    let resolved = false;
    const writePromise = framer.write({ jsonrpc: '2.0', id: 1, result: { payload: 'x'.repeat(1024) } });
    void writePromise.then(() => {
      resolved = true;
    });

    // Give the event loop a tick — the write should still be queued
    // waiting for the consumer to drain the buffer.
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);

    // Drain the buffer; the framer's 'drain' handler resolves the queued
    // write promise.
    while (output.read() !== null) {
      // consume everything
    }
    await new Promise((r) => setImmediate(r));
    await writePromise;
    expect(resolved).toBe(true);
  });
});
