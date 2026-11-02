import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, readFile, rm } from '@frontmcp/utils';

import {
  DevEventStream,
  IpcDevEventSink,
  JsonlFileSink,
  type DevEvent,
  type DevEventSink,
} from '../dev-events/dev-event-stream';

const event = (entry: string): DevEvent => ({
  type: 'call',
  at: '2026-11-02T10:00:00.000Z',
  method: 'tools/call',
  entry,
  durationMs: 3,
  outcome: 'ok',
});

function recordingSink(): DevEventSink & { batches: DevEvent[][] } {
  const batches: DevEvent[][] = [];
  return { name: 'recording', batches, write: (events) => void batches.push([...events]) };
}

function stream(sinks: DevEventSink[], maxQueue = 100) {
  const logger = { warn: jest.fn() };
  return { stream: new DevEventStream(sinks, { maxQueue, logger }), logger };
}

describe('DevEventStream', () => {
  it('returns from emit at once and writes the events of one turn in one batch', async () => {
    const sink = recordingSink();
    const { stream: events } = stream([sink]);

    events.emit(event('a'));
    events.emit(event('b'));
    expect(sink.batches).toEqual([]);

    await events.flush();
    expect(sink.batches).toEqual([[event('a'), event('b')]]);
  });

  it('never makes emit wait for a slow sink, and drops events past the queue bound with one warning', async () => {
    let release: () => void = () => undefined;
    const written: DevEvent[] = [];
    const slow: DevEventSink = {
      name: 'slow',
      write: (batch) =>
        new Promise<void>((resolve) => {
          written.push(...batch);
          release = resolve;
        }),
    };
    const { stream: events, logger } = stream([slow], 2);

    events.emit(event('first'));
    await new Promise((resolve) => setImmediate(resolve));
    for (const entry of ['second', 'third', 'dropped', 'dropped-too']) events.emit(event(entry));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('queue of 2 events is full');
    release();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await events.flush();

    expect(written.map((written) => (written as { entry: string }).entry)).toEqual(['first', 'second', 'third']);
  });

  it('logs a failing sink once and keeps writing to the others', async () => {
    const good = recordingSink();
    const failing: DevEventSink = {
      name: 'broken',
      write: () => {
        throw new Error('disk full');
      },
    };
    const { stream: events, logger } = stream([failing, good]);

    events.emit(event('a'));
    await events.flush();
    events.emit(event('b'));
    await events.flush();

    expect(good.batches).toEqual([[event('a')], [event('b')]]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toBe(
      'Dev events: the broken sink failed (disk full); its later failures are not logged',
    );
  });

  it('writes what is queued and closes its sinks at shutdown, then ignores new events', async () => {
    const sink = { ...recordingSink(), close: jest.fn() };
    const { stream: events } = stream([sink]);

    events.emit(event('last'));
    await events.onShutdown();
    events.emit(event('after'));
    await events.flush();

    expect(sink.batches).toEqual([[event('last')]]);
    expect(sink.close).toHaveBeenCalledTimes(1);
  });
});

describe('JsonlFileSink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-events-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per event, creating the folder', async () => {
    const file = path.join(dir, '.frontmcp', 'dev-events.jsonl');
    const sink = new JsonlFileSink(file);

    await sink.write([event('a')]);
    await sink.write([event('b'), event('c')]);

    const lines = (await readFile(file)).trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line).entry)).toEqual(['a', 'b', 'c']);
  });
});

describe('IpcDevEventSink', () => {
  const original = { send: process.send, connected: process.connected };

  afterEach(() => {
    process.send = original.send;
    Object.defineProperty(process, 'connected', { value: original.connected, configurable: true, writable: true });
  });

  it('sends the batch to the dev parent as a frontmcp control message', async () => {
    const send = jest.fn((_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    });
    process.send = send as unknown as typeof process.send;
    Object.defineProperty(process, 'connected', { value: true, configurable: true, writable: true });

    await new IpcDevEventSink().write([event('a')]);

    expect(send).toHaveBeenCalledWith({ __frontmcp: 'dev-events', events: [event('a')] }, expect.any(Function));
  });

  it('fails when the process has no IPC channel', () => {
    process.send = undefined;

    expect(() => new IpcDevEventSink().write([event('a')])).toThrow('no IPC channel to the dev parent');
  });

  it('fails when the channel refuses the message', async () => {
    process.send = ((_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(new Error('channel closed'));
      return false;
    }) as unknown as typeof process.send;
    Object.defineProperty(process, 'connected', { value: true, configurable: true, writable: true });

    await expect(new IpcDevEventSink().write([event('a')])).rejects.toThrow('channel closed');
  });
});
