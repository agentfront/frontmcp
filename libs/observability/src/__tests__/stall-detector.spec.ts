import { StallDetector, type GcPause, type StallReport } from '../stalls/stall-detector';

function harness(thresholdMs = 200) {
  let now = 10_000;
  let recordGc: (pause: GcPause) => void = () => undefined;
  const stopGc = jest.fn();
  const reports: StallReport[] = [];
  const detector = new StallDetector({
    thresholdMs,
    onStall: (report) => reports.push(report),
    now: () => now,
    observeGc: (record) => {
      recordGc = record;
      return stopGc;
    },
  });
  detector.start();
  return {
    detector,
    reports,
    stopGc,
    advance: (ms: number) => (now += ms),
    /** The loop was free and the sampler ran `ms` after the previous sample. */
    tick: (ms = 10) => {
      now += ms;
      detector.sample();
    },
    /** The loop was blocked for `ms`: the sampler runs that late. */
    block: (ms: number) => (now += ms),
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

  it('reports nothing while the gap between samples stays under the threshold', () => {
    const h = harness();
    h.tick();
    h.tick(150);
    h.tick();

    expect(h.reports).toEqual([]);
  });

  it('names the call that was running through the stall, on the sample after it', async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    const running = h.detector.calls.track(tool('reports:export'), () => new Promise<void>((r) => (finish = r)));
    h.tick();

    h.block(600);
    h.detector.sample();
    expect(h.reports).toEqual([]);

    h.tick();
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
    h.tick();

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      stallMs: 700,
      cause: 'calls',
      calls: [{ entry: 'busy-wait', runningMs: 700 }],
    });
  });

  it('does not name a call that finished before the stall began, nor one that started after it', async () => {
    const h = harness();
    await h.detector.calls.track(tool('quick'), async () => {
      h.advance(5);
    });
    h.tick();
    h.tick();

    h.block(400);
    h.detector.sample();
    let finish: () => void = () => undefined;
    const queued = h.detector.calls.track(tool('queued'), () => new Promise<void>((r) => (finish = r)));
    h.tick();
    finish();
    await queued;

    expect(h.reports).toEqual([{ stallMs: 400, gcMs: 0, cause: 'unknown', calls: [] }]);
  });

  it('blames garbage collection, not the call in flight, when a GC pause takes up the stall', async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    const running = h.detector.calls.track(tool('reports:export'), () => new Promise<void>((r) => (finish = r)));
    const stallStart = h.now;

    h.block(300);
    h.detector.sample();
    h.gc({ startTime: stallStart + 20, duration: 250 });
    h.tick();
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
    h.tick();

    expect(h.reports[0]).toMatchObject({ stallMs: 600, gcMs: 50, cause: 'calls' });
  });

  it('samples every 10 ms on an unref-ed interval, and stops cleanly', () => {
    const h = harness(50);
    const sample = jest.spyOn(h.detector, 'sample');
    expect(h.detector.running).toBe(true);

    h.block(80);
    jest.advanceTimersByTime(9);
    expect(sample).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sample).toHaveBeenCalledTimes(1);

    h.detector.stop();
    expect(h.detector.running).toBe(false);
    expect(h.reports).toEqual([expect.objectContaining({ stallMs: 80 })]);
    expect(h.stopGc).toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the runtime has no perf_hooks', () => {
    const onStall = jest.fn();
    const detector = new StallDetector({ thresholdMs: 200, onStall, observeGc: () => undefined });
    detector.start();
    expect(detector.running).toBe(false);
    jest.advanceTimersByTime(1_000);
    detector.sample();
    detector.stop();

    expect(onStall).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('observes GC with perf_hooks by default, and releases the observer on stop', () => {
    jest.useRealTimers();
    const detector = new StallDetector({ thresholdMs: 60_000, onStall: jest.fn() });

    detector.start();
    detector.start();
    expect(detector.running).toBe(true);
    detector.sample();
    detector.stop();

    expect(detector.running).toBe(false);
  });

  it('reports a stall that the sampler is the first to see after it ends', async () => {
    jest.useRealTimers();
    const reports: StallReport[] = [];
    const detector = new StallDetector({ thresholdMs: 100, onStall: (report) => reports.push(report) });
    detector.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const end = performance.now() + 300;
    while (performance.now() < end) {
      // Blocks the event loop on purpose.
    }
    detector.sample();
    await new Promise((resolve) => setTimeout(resolve, 50));
    detector.stop();

    expect(reports.map((report) => report.stallMs)).toContainEqual(expect.any(Number));
    expect(Math.max(...reports.map((report) => report.stallMs))).toBeGreaterThanOrEqual(300);
  });

  it('keeps sampling when a stall listener throws', () => {
    let now = 0;
    const detector = new StallDetector({
      thresholdMs: 100,
      onStall: () => {
        throw new Error('listener failed');
      },
      now: () => now,
      observeGc: () => () => undefined,
    });
    detector.start();
    now += 300;
    detector.sample();

    expect(() => detector.sample()).not.toThrow();
    expect(detector.running).toBe(true);
    detector.stop();
  });
});
