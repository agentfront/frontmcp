/**
 * writeHttpResponse — an `sse` output on the Node host: it waits for a full socket to drain before taking the next
 * chunk, and ends the stream's iterator when the client leaves, including before the response was written.
 */
import 'reflect-metadata';

import { EventEmitter } from 'node:events';

import { writeHttpResponse } from '../server.validation';

class FakeResponse extends EventEmitter {
  destroyed = false;
  socketFull = false;
  readonly written: string[] = [];
  readonly setHeader = jest.fn();
  readonly flushHeaders = jest.fn();
  readonly end = jest.fn();

  status(): this {
    return this;
  }

  write(chunk: string): boolean {
    this.written.push(chunk);
    return !this.socketFull;
  }
}

/** An endless stream that counts how often the writer asks it for a chunk. */
function endlessStream() {
  const calls = { next: 0, return: 0 };
  let ended = false;
  const iterator: AsyncIterableIterator<string> = {
    next: async () => {
      calls.next++;
      return ended ? { value: undefined, done: true } : { value: `data: ${calls.next}\n\n`, done: false };
    },
    return: async () => {
      calls.return++;
      ended = true;
      return { value: undefined, done: true };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return { iterator, calls };
}

function writeSse(res: FakeResponse, stream: AsyncIterableIterator<string>): Promise<void> {
  return writeHttpResponse(res as never, { kind: 'sse', status: 200, contentType: 'text/event-stream', stream });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('writeHttpResponse — an sse output', () => {
  it('waits for a full socket to drain before taking the next chunk', async () => {
    const res = new FakeResponse();
    res.socketFull = true;
    const { iterator, calls } = endlessStream();

    const writing = writeSse(res, iterator);
    await settle();

    expect(calls.next).toBe(1);
    expect(res.written).toEqual(['data: 1\n\n']);

    res.emit('drain');
    await settle();
    expect(calls.next).toBe(2);

    res.emit('close');
    await writing;
    expect(calls.return).toBe(1);
  });

  it('ends the stream when the client left before the response was written', async () => {
    const res = new FakeResponse();
    res.destroyed = true;
    const { iterator, calls } = endlessStream();

    await writeSse(res, iterator);

    expect(calls.return).toBe(1);
    expect(res.written).toEqual([]);
  });

  it('ends the stream when the client leaves while the socket is full', async () => {
    const res = new FakeResponse();
    res.socketFull = true;
    const { iterator, calls } = endlessStream();

    const writing = writeSse(res, iterator);
    await settle();
    res.emit('close');
    await writing;

    expect(calls.return).toBe(1);
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('drain')).toBe(0);
  });
});
