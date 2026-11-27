import {
  DEFAULT_STREAM_HEARTBEAT_MS,
  KEEP_ALIVE_COMMENT,
  streamHeartbeatMs,
  withKeepAlive,
} from '../stream-keep-alive';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A frame source whose next frame arrives when the test pushes it. */
function controlledFrames() {
  const queued: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  const returned = jest.fn();
  async function* frames(): AsyncGenerator<Uint8Array> {
    try {
      for (;;) {
        while (queued.length > 0) yield queued.shift() as Uint8Array;
        if (finished) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      returned();
    }
  }
  return {
    frames: frames(),
    returned,
    push(text: string) {
      queued.push(encoder.encode(text));
      wake?.();
    },
    end() {
      finished = true;
      wake?.();
    },
  };
}

describe('streamHeartbeatMs', () => {
  it('is 15 seconds when transport.sse.heartbeatMs is not set', () => {
    expect(streamHeartbeatMs(undefined)).toBe(DEFAULT_STREAM_HEARTBEAT_MS);
    expect(streamHeartbeatMs({ sse: {} })).toBe(15_000);
  });

  it('is the configured interval, and 0 when it is 0 or false', () => {
    expect(streamHeartbeatMs({ sse: { heartbeatMs: 2_000 } })).toBe(2_000);
    expect(streamHeartbeatMs({ sse: { heartbeatMs: 0 } })).toBe(0);
    expect(streamHeartbeatMs({ sse: { heartbeatMs: false } })).toBe(0);
  });
});

describe('withKeepAlive', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends a keep-alive comment after each quiet interval, then the event that comes', async () => {
    const source = controlledFrames();
    const iterator = withKeepAlive(source.frames, 1_000)[Symbol.asyncIterator]();

    const first = iterator.next();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await first).value)).toBe(KEEP_ALIVE_COMMENT);

    const second = iterator.next();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await second).value)).toBe(KEEP_ALIVE_COMMENT);

    const third = iterator.next();
    source.push('event: message\ndata: {"id":1}\n\n');
    expect(decoder.decode((await third).value)).toBe('event: message\ndata: {"id":1}\n\n');

    source.end();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sends nothing extra while events keep coming', async () => {
    const source = controlledFrames();
    const iterator = withKeepAlive(source.frames, 1_000)[Symbol.asyncIterator]();

    const sent: string[] = [];
    for (let index = 0; index < 3; index++) {
      const next = iterator.next();
      await jest.advanceTimersByTimeAsync(900);
      source.push(`data: ${index}\n\n`);
      sent.push(decoder.decode((await next).value));
    }

    expect(sent).toEqual(['data: 0\n\n', 'data: 1\n\n', 'data: 2\n\n']);
  });

  it('yields nothing once the reader returned, and stops its timer and the source', async () => {
    const source = controlledFrames();
    const iterator = withKeepAlive(source.frames, 1_000)[Symbol.asyncIterator]();
    source.push('data: first\n\n');
    await iterator.next();

    const waiting = iterator.next();
    const returning = iterator.return?.();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await waiting).toEqual({ value: undefined, done: true });
    expect(jest.getTimerCount()).toBe(0);

    source.end();
    await returning;
    expect(source.returned).toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('passes a failing source on and leaves no timer behind', async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      throw new Error('dispatch failed');
    }
    const iterator = withKeepAlive(failing(), 1_000)[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow('dispatch failed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps no reaction per frame or per keep-alive on a promise that stays pending', async () => {
    const source = controlledFrames();
    const iterator = withKeepAlive(source.frames, 1_000)[Symbol.asyncIterator]();
    // Every reaction a promise gets goes through its `then` (Promise.race calls it too), so count them per promise.
    const reactions = new Map<object, number>();
    const then = Promise.prototype.then;
    Promise.prototype.then = function (this: Promise<unknown>, ...args: Parameters<typeof then>) {
      reactions.set(this, (reactions.get(this) ?? 0) + 1);
      return then.apply(this, args);
    } as typeof then;
    try {
      for (let index = 0; index < 50; index++) {
        const next = iterator.next();
        source.push(`data: ${index}\n\n`);
        await next;
      }
      // One source read, awaited across 50 quiet intervals.
      for (let index = 0; index < 50; index++) {
        const next = iterator.next();
        await jest.advanceTimersByTimeAsync(1_000);
        expect(decoder.decode((await next).value)).toBe(KEEP_ALIVE_COMMENT);
      }
    } finally {
      Promise.prototype.then = then;
    }

    expect(Math.max(...reactions.values())).toBeLessThanOrEqual(2);
    source.push('data: last\n\n');
    expect(decoder.decode((await iterator.next()).value)).toBe('data: last\n\n');
  });

  it('leaves the frames as they are when keep-alives are off', () => {
    const source = controlledFrames();

    expect(withKeepAlive(source.frames, 0)).toBe(source.frames);
  });
});
