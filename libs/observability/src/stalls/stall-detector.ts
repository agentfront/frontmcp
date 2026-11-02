import { InFlightCalls, type CallIdentity, type CallRecord } from './in-flight-calls';

/** The part of `perf_hooks.monitorEventLoopDelay()`'s histogram the detector reads. */
export interface LoopDelayHistogram {
  /** The longest delay since the last reset, in nanoseconds. */
  readonly max: number;
  reset(): void;
  disable?(): void;
}

/** A garbage-collection pause, on the `performance.now()` clock. */
export interface GcPause {
  startTime: number;
  duration: number;
}

export interface StalledCall extends CallIdentity {
  /** How long the call had been running when the stall ended. */
  runningMs: number;
}

export interface StallReport {
  stallMs: number;
  /** How much of the stall garbage collection took. */
  gcMs: number;
  /** `gc` when the stall less its GC time is under the threshold; else `calls`, or `unknown` with no call in flight. */
  cause: 'calls' | 'gc' | 'unknown';
  /** The calls in flight during the stall. */
  calls: StalledCall[];
}

export interface StallDetectorOptions {
  thresholdMs: number;
  onStall: (report: StallReport) => void;
  now?: () => number;
  histogram?: () => LoopDelayHistogram | undefined;
  /** Feeds GC pauses to `record`, and returns how to stop. */
  observeGc?: (record: (pause: GcPause) => void) => (() => void) | undefined;
}

interface DetectedStall {
  from: number;
  to: number;
  stallMs: number;
  calls: CallRecord[];
}

const NS_PER_MS = 1e6;
const MAX_SAMPLE_INTERVAL_MS = 100;

/** A loop-delay histogram at 10 ms resolution, or none where `perf_hooks` is missing (edge runtimes). */
export function monitorLoopDelay(): import('node:perf_hooks').IntervalHistogram | undefined {
  try {
    const { monitorEventLoopDelay } = require('node:perf_hooks') as typeof import('node:perf_hooks');
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    return histogram;
  } catch {
    return undefined;
  }
}

function observeGcPauses(record: (pause: GcPause) => void): (() => void) | undefined {
  try {
    const { PerformanceObserver } = require('node:perf_hooks') as typeof import('node:perf_hooks');
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record({ startTime: entry.startTime, duration: entry.duration });
    });
    observer.observe({ entryTypes: ['gc'] });
    return () => observer.disconnect();
  } catch {
    return undefined;
  }
}

function overlapMs(pause: GcPause, stall: DetectedStall): number {
  return Math.max(0, Math.min(pause.startTime + pause.duration, stall.to) - Math.max(pause.startTime, stall.from));
}

/**
 * Samples the event-loop delay and reports each stall of `thresholdMs` or more with the calls in flight during it.
 * A stall is reported on the sample after the one that measured it, once its GC pauses have been delivered.
 */
export class StallDetector {
  readonly calls: InFlightCalls;
  readonly onStall: (report: StallReport) => void;
  private readonly thresholdMs: number;
  private readonly now: () => number;
  private readonly createHistogram: () => LoopDelayHistogram | undefined;
  private readonly observeGc: (record: (pause: GcPause) => void) => (() => void) | undefined;
  private histogram?: LoopDelayHistogram;
  private stopObservingGc?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private pending: DetectedStall[] = [];
  private gcPauses: GcPause[] = [];
  private previousSampleAt = 0;

  constructor(options: StallDetectorOptions) {
    this.thresholdMs = options.thresholdMs;
    this.onStall = options.onStall;
    this.now = options.now ?? (() => performance.now());
    this.createHistogram = options.histogram ?? monitorLoopDelay;
    this.observeGc = options.observeGc ?? observeGcPauses;
    this.calls = new InFlightCalls(this.now);
  }

  start(): void {
    if (this.histogram) return;
    this.histogram = this.createHistogram();
    if (!this.histogram) return;
    this.stopObservingGc = this.observeGc((pause) => this.gcPauses.push(pause));
    this.previousSampleAt = this.now();
    this.timer = setInterval(() => this.sample(), Math.min(this.thresholdMs, MAX_SAMPLE_INTERVAL_MS));
    this.timer.unref?.();
  }

  /** Stops sampling, and reports the stall measured last if there is one. */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.reportPending();
    this.histogram?.disable?.();
    this.histogram = undefined;
    this.stopObservingGc?.();
    this.stopObservingGc = undefined;
  }

  sample(): void {
    const histogram = this.histogram;
    if (!histogram) return;
    const now = this.now();
    this.reportPending();
    const stallMs = histogram.max / NS_PER_MS;
    histogram.reset();
    if (stallMs >= this.thresholdMs) {
      const from = now - stallMs;
      this.pending.push({ from, to: now, stallMs, calls: this.calls.during(from, now) });
    }
    // A delay measured one sample late can belong to a call that ended before this sample.
    this.calls.prune(this.previousSampleAt);
    const keepFrom = Math.min(this.previousSampleAt, ...this.pending.map((stall) => stall.from));
    this.gcPauses = this.gcPauses.filter((pause) => pause.startTime + pause.duration >= keepFrom);
    this.previousSampleAt = now;
  }

  private reportPending(): void {
    for (const stall of this.pending.splice(0)) {
      try {
        this.onStall(this.reportOf(stall));
      } catch {
        // A failing listener must not stop the sampler.
      }
    }
  }

  private reportOf(stall: DetectedStall): StallReport {
    const gcTotal = this.gcPauses.reduce((sum, pause) => sum + overlapMs(pause, stall), 0);
    const gcMs = Math.min(stall.stallMs, gcTotal);
    const cause = stall.stallMs - gcMs < this.thresholdMs ? 'gc' : stall.calls.length > 0 ? 'calls' : 'unknown';
    return {
      stallMs: Math.round(stall.stallMs),
      gcMs: Math.round(gcMs),
      cause,
      calls: stall.calls.map(({ method, entry, session, startedAt, endedAt }) => ({
        method,
        entry,
        ...(session ? { session } : {}),
        runningMs: Math.round(Math.min(endedAt ?? stall.to, stall.to) - startedAt),
      })),
    };
  }
}
