import { JobAdmissionTimeoutError } from '../errors';

/** How long an attempt waits, at most, between two checks for a slot (free memory is polled). */
const RECHECK_MS = 250;

const BYTES_PER_MB = 1024 * 1024;

/** When job attempts may start: `jobs.admission`. */
export interface JobAdmissionOptions {
  /** The most attempts of jobs (and workflow steps) running at once in this process. */
  concurrency?: number;
  /**
   * The memory each running attempt claims, in MB: an attempt starts once the system has that much free
   * beyond what the attempts already running claimed.
   */
  memoryMb?: number;
  /** How long an attempt waits to start before it is refused with `JobAdmissionTimeoutError`. @default 600000 */
  maxWaitMs?: number;
}

/** The free system memory in MB; replaceable for tests. */
export interface JobAdmissionProbes {
  freeMemoryMb?: () => number;
}

/** One attempt's place: `acquire()` waits for a slot, `release()` frees it; both are safe to call once only. */
export interface JobAdmissionSlot {
  acquire(jobName: string, signal?: AbortSignal): Promise<void>;
  release(): void;
}

/**
 * Admission for the job attempts of one scope (`jobs.admission`): at most `concurrency` run at once,
 * each claims `memoryMb` of free memory, and attempts that wait are admitted in the order they arrived.
 * One that waits past `maxWaitMs` is refused with `JobAdmissionTimeoutError`.
 */
export class JobAdmission {
  private running = 0;
  private claimedMb = 0;
  private readonly queue: object[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly maxWaitMs: number;
  private readonly freeMemoryMb: () => number;

  constructor(
    private readonly options: JobAdmissionOptions,
    probes: JobAdmissionProbes = {},
  ) {
    this.maxWaitMs = options.maxWaitMs ?? 600_000;
    this.freeMemoryMb = probes.freeMemoryMb ?? systemFreeMemoryMb;
  }

  slot(): JobAdmissionSlot {
    let release: (() => void) | undefined;
    return {
      acquire: async (jobName, signal) => {
        release = await this.admit(jobName, signal);
      },
      release: () => {
        release?.();
        release = undefined;
      },
    };
  }

  private async admit(jobName: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    const deadline = Date.now() + this.maxWaitMs;
    const ticket = {};
    this.queue.push(ticket);
    try {
      while (this.queue[0] !== ticket || !this.fits()) {
        const left = deadline - Date.now();
        if (left <= 0) throw new JobAdmissionTimeoutError(jobName, this.maxWaitMs, this.describeWait());
        await this.nextChange(Math.min(left, RECHECK_MS), signal);
      }
      return this.claim();
    } finally {
      this.queue.splice(this.queue.indexOf(ticket), 1);
      this.wake();
    }
  }

  private fits(): boolean {
    const { concurrency, memoryMb } = this.options;
    if (concurrency !== undefined && this.running >= concurrency) return false;
    return memoryMb === undefined || this.freeMemoryMb() - this.claimedMb >= memoryMb;
  }

  private claim(): () => void {
    const claimedMb = this.options.memoryMb ?? 0;
    this.running++;
    this.claimedMb += claimedMb;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.running--;
      this.claimedMb -= claimedMb;
      this.wake();
    };
  }

  private describeWait(): string {
    const { concurrency, memoryMb } = this.options;
    if (concurrency !== undefined && this.running >= concurrency) {
      return `${this.running} of ${concurrency} job runs are busy`;
    }
    const availableMb = Math.max(0, Math.floor(this.freeMemoryMb() - this.claimedMb));
    return `it needs ${memoryMb} MB free, and ${availableMb} MB is`;
  }

  /** Resolve when a slot is released or `ms` pass; reject with the abort reason when `signal` aborts. */
  private nextChange(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const stopListening = () => {
        clearTimeout(timer);
        this.listeners.delete(changed);
        signal?.removeEventListener('abort', aborted);
      };
      const changed = () => {
        stopListening();
        resolve();
      };
      const aborted = () => {
        stopListening();
        reject(signal?.reason);
      };
      const timer = setTimeout(changed, ms);
      this.listeners.add(changed);
      signal?.addEventListener('abort', aborted, { once: true });
    });
  }

  private wake(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function systemFreeMemoryMb(): number {
  const { freemem } = require('node:os') as typeof import('node:os');
  return freemem() / BYTES_PER_MB;
}
