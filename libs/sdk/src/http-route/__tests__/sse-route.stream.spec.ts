import { formatSseEvent, SseRouteStream } from '../sse-route.stream';

const HEARTBEAT = ': keep-alive\n\n';

async function read(stream: SseRouteStream): Promise<string | undefined> {
  const { value, done } = await stream.next();
  return done ? undefined : new TextDecoder().decode(value);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

function createStream(
  produce: () => Promise<unknown>,
  options: { onError?: (error: unknown) => void; authorized?: () => boolean } = {},
) {
  let publish: () => void = () => undefined;
  const unsubscribe = jest.fn();
  const onClose = jest.fn();
  const stream = new SseRouteStream({
    produce,
    subscribe: (listener) => {
      publish = listener;
      return unsubscribe;
    },
    coalesceMs: 50,
    heartbeatMs: 15_000,
    onError: options.onError ?? jest.fn(),
    onClose,
    authorized: options.authorized,
  });
  return { stream, publish: () => publish(), unsubscribe, onClose };
}

describe('SseRouteStream', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends the first view at once', async () => {
    const { stream } = createStream(async () => ({ count: 1 }));

    expect(await read(stream)).toBe('data: {"count":1}\n\n');
    stream.close();
  });

  it('sends one view for a burst of publishes', async () => {
    let count = 0;
    const produce = jest.fn(async () => ({ count: ++count }));
    const { stream, publish } = createStream(produce);
    await stream.next();

    for (let i = 0; i < 5; i++) publish();
    await jest.advanceTimersByTimeAsync(50);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(await read(stream)).toBe('data: {"count":2}\n\n');
    stream.close();
  });

  it('sends one more view for publishes that arrive while one is being made', async () => {
    const first = deferred<unknown>();
    const produce = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue('latest');
    const { stream, publish } = createStream(produce);

    publish();
    publish();
    await jest.advanceTimersByTimeAsync(50);
    expect(produce).toHaveBeenCalledTimes(1);

    first.resolve('first');
    await jest.advanceTimersByTimeAsync(50);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(await read(stream)).toBe('data: latest\n\n');
    stream.close();
  });

  it('keeps only the latest view for a reader that falls behind', async () => {
    let count = 0;
    const { stream, publish } = createStream(async () => ++count);
    await jest.advanceTimersByTimeAsync(0);

    publish();
    await jest.advanceTimersByTimeAsync(50);
    publish();
    await jest.advanceTimersByTimeAsync(50);

    expect(await read(stream)).toBe('data: 3\n\n');
    stream.close();
  });

  it('sends nothing for a view of undefined', async () => {
    const { stream } = createStream(async () => undefined);
    await jest.advanceTimersByTimeAsync(0);

    const next = read(stream);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(await next).toBe(HEARTBEAT);
    stream.close();
  });

  it('reports a view that fails, and keeps the stream open', async () => {
    const onError = jest.fn();
    const failure = new Error('board unavailable');
    const produce = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue({ ok: true });
    const { stream, publish } = createStream(produce, { onError });
    await jest.advanceTimersByTimeAsync(0);

    publish();
    await jest.advanceTimersByTimeAsync(50);

    expect(onError).toHaveBeenCalledWith(failure);
    expect(await read(stream)).toBe('data: {"ok":true}\n\n');
    stream.close();
  });

  it('sends a heartbeat when nothing changes, without displacing a waiting view', async () => {
    const { stream } = createStream(async () => 'view');
    await jest.advanceTimersByTimeAsync(15_000);

    expect(await read(stream)).toBe('data: view\n\n');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await read(stream)).toBe(HEARTBEAT);
    stream.close();
  });

  it('stops listening, ends a waiting read and calls onClose once when the client leaves', async () => {
    const produce = jest.fn(async () => 'view');
    const { stream, publish, unsubscribe, onClose } = createStream(produce);
    await stream.next();
    const waiting = read(stream);

    await expect(stream.return()).resolves.toEqual({ value: undefined, done: true });
    stream.close();
    publish();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(await waiting).toBeUndefined();
    expect(await read(stream)).toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('ends, instead of sending the next view, once the reader is no longer authorized', async () => {
    let authorized = true;
    const produce = jest.fn(async () => ({ count: 1 }));
    const { stream, publish, unsubscribe } = createStream(produce, { authorized: () => authorized });
    await stream.next();

    authorized = false;
    publish();
    await jest.advanceTimersByTimeAsync(50);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(await stream.next()).toEqual({ value: undefined, done: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ends at the next heartbeat once the reader is no longer authorized', async () => {
    let authorized = true;
    const { stream, onClose } = createStream(async () => ({ count: 1 }), { authorized: () => authorized });
    await stream.next();

    authorized = false;
    await jest.advanceTimersByTimeAsync(15_000);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await stream.next()).toEqual({ value: undefined, done: true });
  });

  it('is its own async iterator', () => {
    const { stream } = createStream(async () => undefined);

    expect(stream[Symbol.asyncIterator]()).toBe(stream);
    stream.close();
  });
});

describe('formatSseEvent', () => {
  it('sends an object as JSON', () => {
    expect(formatSseEvent({ a: [1, 2] })).toBe('data: {"a":[1,2]}\n\n');
  });

  it('sends each line of a string as a data line', () => {
    expect(formatSseEvent('one\ntwo\r\nthree')).toBe('data: one\ndata: two\ndata: three\n\n');
  });
});
