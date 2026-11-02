import { monitorLoopDelay, StallDetector, type GcPause, type StallReport } from '../stalls/stall-detector';

const NS_PER_MS = 1e6;

function harness(thresholdMs = 200) {
  let now = 10_000;
  const histogram = {
    max: 0,
    reset: jest.fn(() => {
      histogram.max = 0;
    }),
    disable: jest.fn(),
  };
  let recordGc: (pause: GcPause) => void = () => undefined;
  const stopGc = jest.fn();
  const reports: StallReport[] = [];
  const detector = new StallDetector({
    thresholdMs,
    onStall: (report) => reports.push(report),
    now: () => now,
    histogram: () => histogram,
    observeGc: (record) => {
      recordGc = record;
      return stopGc;
    },
  });
  detector.start();
  return {
    detector,
    histogram,
    reports,
    stopGc,
    advance: (ms: number) => (now += ms),
    /** The loop was blocked for `ms` and the sampler ran right after. */
    block: (ms: number) => {
      now += ms;
      histogram.max = ms * NS_PER_MS;
    },
    gc: (pause: GcPause) => recordGc(pause),
    get now() {
      return now;
    },
  };
}

const tool = (entry: string) => ({ method: 'tools/call' as const, entry, session: 'a1b2c3d4e5f6' });

describe('StallDetector', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports nothing while the loop delay stays under the threshold', () => {
    const h = harness();
    h.advance(100);
    h.histogram.max = 150 * NS_PER_MS;
    h.detector.sample();
    h.advance(100);
    h.detector.sample();

    expect(h.reports).toEqual([]);
    expect(h.histogram.reset).toHaveBeenCalledTimes(2);
  });

  it('names the call that was running through the stall, on the sample after it', async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    const running = h.detector.calls.track(tool('reports:export'), () => new Promise<void>((r) => (finish = r)));
    h.advance(10);

    h.block(600);
    h.detector.sample();
    expect(h.reports).toEqual([]);

    h.advance(100);
    h.detector.sample();
    finish();
    await running;

    expect(h.reports).toEqual([
      {
        stallMs: 600,
        gcMs: 0,
        cause: 'calls',
        calls: [{ method: 'tools/call', entry: 'reports:export', session: 'a1b2c3d4e5f6', runningMs: 610 }],
      },
    ]);
  });

  it('names a call that blocked the loop and finished just before the sampler ran', async () => {
    const h = harness();
    await h.detector.calls.track(tool('busy-wait'), async () => {
      h.block(700);
    });

    h.detector.sample();
    h.advance(100);
    h.detector.sample();

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      stallMs: 700,
      cause: 'calls',
      calls: [{ entry: 'busy-wait', runningMs: 700 }],
    });
  });

  it('does not name a call that finished before the stall began', async () => {
    const h = harness();
    await h.detector.calls.track(tool('quick'), async () => {
      h.advance(5);
    });
    h.advance(50);

    h.block(400);
    h.detector.sample();
    h.advance(100);
    h.detector.sample();

    expect(h.reports).toEqual([{ stallMs: 400, gcMs: 0, cause: 'unknown', calls: [] }]);
  });

  it('still names the blocking call when the delay is only measured on the next sample', async () => {
    const h = harness();
    await h.detector.calls.track(tool('busy-wait'), async () => {
      h.advance(500);
    });
    h.detector.sample();

    h.advance(100);
    h.histogram.max = 500 * NS_PER_MS;
    h.detector.sample();
    h.advance(100);
    h.detector.sample();

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ cause: 'calls', calls: [{ entry: 'busy-wait' }] });
  });

  it('blames garbage collection, not the call in flight, when a GC pause takes up the stall', async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    const running = h.detector.calls.track(tool('reports:export'), () => new Promise<void>((r) => (finish = r)));
    const stallStart = h.now;

    h.block(300);
    h.detector.sample();
    h.gc({ startTime: stallStart + 20, duration: 250 });
    h.advance(100);
    h.detector.sample();
    finish();
    await running;

    expect(h.reports).toEqual([
      expect.objectContaining({
        stallMs: 300,
        gcMs: 250,
        cause: 'gc',
        calls: [expect.objectContaining({ entry: 'reports:export' })],
      }),
    ]);
  });

  it('counts only the part of a GC pause inside the stall, and still blames the call for the rest', async () => {
    const h = harness();
    const stallStart = h.now;
    h.gc({ startTime: stallStart - 1_000, duration: 50 });
    await h.detector.calls.track(tool('busy-wait'), async () => {
      h.block(600);
    });
    h.gc({ startTime: stallStart + 550, duration: 100 });

    h.detector.sample();
    h.advance(100);
    h.detector.sample();

    expect(h.reports[0]).toMatchObject({ stallMs: 600, gcMs: 50, cause: 'calls' });
  });

  it('samples on an unref-ed interval no longer than the threshold, and stops cleanly', () => {
    const h = harness(50);
    expect(h.detector.running).toBe(true);
    h.block(80);
    jest.advanceTimersByTime(50);
    expect(h.histogram.reset).toHaveBeenCalledTimes(1);

    h.detector.stop();
    expect(h.detector.running).toBe(false);
    expect(h.reports).toHaveLength(1);
    expect(h.histogram.disable).toHaveBeenCalled();
    expect(h.stopGc).toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(h.histogram.reset).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the runtime cannot measure the loop delay', () => {
    const onStall = jest.fn();
    const detector = new StallDetector({ thresholdMs: 200, onStall, histogram: () => undefined });
    detector.start();
    expect(detector.running).toBe(false);
    jest.advanceTimersByTime(1_000);
    detector.sample();
    detector.stop();

    expect(onStall).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('measures with perf_hooks by default, and releases the histogram and GC observer on stop', () => {
    jest.useRealTimers();
    const detector = new StallDetector({ thresholdMs: 60_000, onStall: jest.fn() });

    detector.start();
    detector.start();
    detector.sample();
    detector.stop();

    const histogram = monitorLoopDelay();
    expect(histogram?.max).toBeGreaterThanOrEqual(0);
    histogram?.disable();
  });

  it('keeps sampling when a stall listener throws', () => {
    const histogram = { max: 0, reset: () => (histogram.max = 0) };
    let now = 0;
    const detector = new StallDetector({
      thresholdMs: 100,
      onStall: () => {
        throw new Error('listener failed');
      },
      now: () => now,
      histogram: () => histogram,
      observeGc: () => undefined,
    });
    detector.start();
    now += 300;
    histogram.max = 300 * NS_PER_MS;
    detector.sample();

    expect(() => detector.sample()).not.toThrow();
    detector.stop();
  });
});
