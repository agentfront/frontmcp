/**
 * A detached run keeps what it reports in memory and writes the latest of it to the store every 500 ms at most,
 * and every runner renews its heartbeat in the store while it holds runs.
 */
import { MemoryJobStateStore } from '../../store/memory-job-state.store';
import { LatestValueFlusher, RunnerHeartbeat } from '../run-flusher';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('LatestValueFlusher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes nothing until the first tick, then only the latest value, once per interval', async () => {
    const writes: number[] = [];
    const flusher = new LatestValueFlusher<number>(async (value) => {
      writes.push(value);
    }, 500);

    for (let value = 1; value <= 50; value++) flusher.push(value);
    expect(writes).toEqual([]);

    await jest.advanceTimersByTimeAsync(499);
    expect(writes).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([50]);

    await jest.advanceTimersByTimeAsync(2_000);
    expect(writes).toEqual([50]);

    flusher.push(51);
    flusher.push(52);
    await jest.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([50, 52]);
    flusher.stop();
  });

  it('starts no write while the last one is still in flight, and writes what came meanwhile after it', async () => {
    const writes: number[] = [];
    let slow = deferred();
    const flusher = new LatestValueFlusher<number>(async (value) => {
      writes.push(value);
      await slow.promise;
    }, 500);

    flusher.push(1);
    await jest.advanceTimersByTimeAsync(500);
    flusher.push(2);
    flusher.push(3);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(writes).toEqual([1]);

    const first = slow;
    slow = deferred();
    first.resolve();
    await jest.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([1, 3]);
    slow.resolve();
    flusher.stop();
  });

  it('writes what is pending on flush(), and nothing after stop()', async () => {
    const writes: string[] = [];
    const flusher = new LatestValueFlusher<string>(async (value) => {
      writes.push(value);
    }, 500);

    flusher.push('a');
    await flusher.flush();
    expect(writes).toEqual(['a']);
    await flusher.flush();
    expect(writes).toEqual(['a']);

    flusher.push('b');
    flusher.stop();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(writes).toEqual(['a']);
  });

  it('keeps the value of a write that failed for the next tick', async () => {
    const writes: number[] = [];
    let fail = true;
    const flusher = new LatestValueFlusher<number>(
      async (value) => {
        if (fail) throw new Error('store busy');
        writes.push(value);
      },
      500,
      () => undefined,
    );

    flusher.push(7);
    await jest.advanceTimersByTimeAsync(500);
    fail = false;
    await jest.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([7]);
    flusher.stop();
  });
});

describe('RunnerHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes the heartbeat before hold() resolves and renews it every second while it is held', async () => {
    const store = new MemoryJobStateStore();
    const touch = jest.spyOn(store, 'touchRunner');
    const heartbeat = new RunnerHeartbeat(store, 'runner-1');

    const release = await heartbeat.hold();
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenLastCalledWith('runner-1', 5);
    expect(await store.isRunnerAlive('runner-1')).toBe(true);

    await jest.advanceTimersByTimeAsync(3_000);
    expect(touch).toHaveBeenCalledTimes(4);

    release();
    release();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(touch).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(await store.isRunnerAlive('runner-1')).toBe(false);
  });

  it('beats once for every holder, until the last one lets go', async () => {
    const store = new MemoryJobStateStore();
    const touch = jest.spyOn(store, 'touchRunner');
    const heartbeat = new RunnerHeartbeat(store, 'runner-1');

    const first = await heartbeat.hold();
    const second = await heartbeat.hold();
    expect(touch).toHaveBeenCalledTimes(1);

    first();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(touch).toHaveBeenCalledTimes(2);
    second();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a store that keeps no heartbeats', async () => {
    const heartbeat = new RunnerHeartbeat({}, 'runner-1');

    const release = await heartbeat.hold();
    release();
    await jest.advanceTimersByTimeAsync(5_000);
  });
});
