import { InFlightCalls, type CallIdentity, type CallRecord } from './in-flight-calls';

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
  /** Feeds GC pauses to `record`, and returns how to stop; none where the runtime has no `perf_hooks`, so no sampling. */
  observeGc?: (record: (pause: GcPause) => void) => (() => void) | undefined;
}

interface DetectedStall {
  from: number;
  to: number;
  stallMs: number;
  calls: CallRecord[];
}

/** How often the loop is sampled; a stall is the time between two samples, so it is measured to within this. */
const SAMPLE_INTERVAL_MS = 10;

function observeGcPauses(record: (pause: GcPause) => void): (() => void) | undefined {
  let perfHooks: typeof import('node:perf_hooks');
  try {
    perfHooks = require('node:perf_hooks') as typeof import('node:perf_hooks');
  } catch {
    return undefined;
  }
  try {
    const observer = new perfHooks.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record({ startTime: entry.startTime, duration: entry.duration });
    });
    observer.observe({ entryTypes: ['gc'] });
    return () => observer.disconnect();
  } catch {
    // A runtime that does not report GC entries: stalls are still measured, none of them as GC.
    return () => undefined;
  }
}

function overlapMs(pause: GcPause, stall: DetectedStall): number {
  return Math.max(0, Math.min(pause.startTime + pause.duration, stall.to) - Math.max(pause.startTime, stall.from));
}

/**
 * Samples the event loop every 10 ms and reports each gap of `thresholdMs` or more between two samples as a stall,
 * with the calls in flight during it. A stall is reported on the sample after the one that measured it, once its
 * GC pauses have been delivered.
 */
export class StallDetector {
  readonly calls: InFlightCalls;
  readonly onStall: (report: StallReport) => void;
  private readonly thresholdMs: number;
  private readonly now: () => number;
  private readonly observeGc: (record: (pause: GcPause) => void) => (() => void) | undefined;
  private stopObservingGc?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private pending: DetectedStall[] = [];
  private gcPauses: GcPause[] = [];
  private previousSampleAt = 0;

  constructor(options: StallDetectorOptions) {
    this.thresholdMs = options.thresholdMs;
    this.onStall = options.onStall;
    this.now = options.now ?? (() => performance.now());
    this.observeGc = options.observeGc ?? observeGcPauses;
    this.calls = new InFlightCalls(this.now);
  }

  /** Whether it samples: started, on a runtime with `perf_hooks`, and not stopped. */
  get running(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer) return;
    this.stopObservingGc = this.observeGc((pause) => this.gcPauses.push(pause));
    if (!this.stopObservingGc) return;
    this.previousSampleAt = this.now();
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Stops sampling, and reports the stall measured last if there is one. */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.reportPending();
    this.stopObservingGc?.();
    this.stopObservingGc = undefined;
  }

  sample(): void {
    if (!this.timer) return;
    const now = this.now();
    this.reportPending();
    const from = this.previousSampleAt;
    const stallMs = now - from;
    if (stallMs >= this.thresholdMs) this.pending.push({ from, to: now, stallMs, calls: this.calls.during(from, now) });
    this.calls.prune(now);
    const keepFrom = Math.min(now, ...this.pending.map((stall) => stall.from));
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
