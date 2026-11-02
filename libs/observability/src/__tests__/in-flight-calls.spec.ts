import { FlowControl } from '@frontmcp/sdk';

import { InFlightCalls } from '../stalls/in-flight-calls';

const call = { method: 'tools/call' as const, entry: 'reports:export', session: 'a1b2c3d4e5f6' };

function registry() {
  let now = 1_000;
  const calls = new InFlightCalls(() => now);
  return { calls, advance: (ms: number) => (now += ms) };
}

describe('InFlightCalls', () => {
  it('holds a call while its body runs and finishes it when the body returns', async () => {
    const { calls, advance } = registry();
    let seenWhileRunning: unknown;

    await calls.track(call, async () => {
      advance(40);
      seenWhileRunning = calls.running().map((record) => ({ ...record }));
    });

    expect(seenWhileRunning).toEqual([{ ...call, startedAt: 1_000 }]);
    expect(calls.running()).toEqual([]);
    expect(calls.during(1_000, 1_040)).toEqual([{ ...call, startedAt: 1_000, endedAt: 1_040 }]);
  });

  it('finishes a call whose body throws, and rethrows', async () => {
    const { calls } = registry();
    const failure = new Error('boom');

    await expect(
      calls.track(call, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(calls.running()).toEqual([]);
  });

  it('finishes a call whose body aborts the flow', async () => {
    const { calls } = registry();

    await expect(
      calls.track(call, async () => {
        throw FlowControl.abort('cancelled');
      }),
    ).rejects.toBeInstanceOf(FlowControl);

    expect(calls.running()).toEqual([]);
  });

  it('keeps a timed-out call in flight until the execution it left behind settles', async () => {
    const { calls, advance } = registry();
    let settle: () => void = () => undefined;
    const abandoned = new Promise<void>((resolve) => (settle = resolve));

    await expect(
      calls.track(
        call,
        async () => {
          throw new Error('timed out');
        },
        () => abandoned,
      ),
    ).rejects.toThrow('timed out');
    expect(calls.running()).toHaveLength(1);

    advance(500);
    settle();
    await abandoned;
    await Promise.resolve();

    expect(calls.running()).toEqual([]);
    expect(calls.during(1_500, 1_500)).toEqual([{ ...call, startedAt: 1_000, endedAt: 1_500 }]);
  });

  it('finishes a timed-out call when the execution it left behind rejects', async () => {
    const { calls } = registry();
    const abandoned = Promise.reject(new Error('late failure'));

    await expect(
      calls.track(
        call,
        async () => {
          throw new Error('timed out');
        },
        () => abandoned,
      ),
    ).rejects.toThrow('timed out');
    await abandoned.catch(() => undefined);
    await Promise.resolve();

    expect(calls.running()).toEqual([]);
  });

  it('lists the calls that overlap a window and drops the ones that finished before a time', async () => {
    const { calls, advance } = registry();
    await calls.track({ ...call, entry: 'early' }, async () => {
      advance(10);
    });
    advance(100);
    let lateDuring: unknown;
    await calls.track({ ...call, entry: 'late' }, async () => {
      lateDuring = calls.during(1_100, 1_120).map((record) => record.entry);
    });

    expect(lateDuring).toEqual(['late']);
    calls.prune(1_050);
    expect(calls.during(0, Number.MAX_SAFE_INTEGER).map((record) => record.entry)).toEqual(['late']);
  });
});
