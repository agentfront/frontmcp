import { getHostname, randomUUID } from '@frontmcp/utils';

import { JobAdmissionTimeoutError, JobStoreNotSupportedError } from '../errors';
import type { JobStateStore } from './store/job-state.interface';

/** How long an attempt waits, at most, between two checks for a slot (free memory is polled). */
const RECHECK_MS = 250;

const BYTES_PER_MB = 1024 * 1024;

/** Which attempts `jobs.admission` counts: this process's, or those of every process on the machine. */
export type JobAdmissionScope = 'process' | 'machine';

/** When job attempts may start: `jobs.admission`. */
export interface JobAdmissionOptions {
  /** The most attempts of jobs (and workflow steps) running at once, in this process or on the machine (`scope`). */
  concurrency?: number;
  /**
   * The memory each running attempt claims, in MB: an attempt starts once the system has that much free
   * beyond what the attempts already running claimed.
   */
  memoryMb?: number;
  /** How long an attempt waits to start before it is refused with `JobAdmissionTimeoutError`. @default 600000 */
  maxWaitMs?: number;
  /**
   * `'process'` counts the attempts of this process. `'machine'` counts those of every process on this machine that
   * shares the job store, the servers and their detached runners: each running attempt holds a lease in the store,
   * which its process renews, so the leases of a process that died end within 30 s. @default 'process'
   */
  scope?: JobAdmissionScope;
}

/** What hands an attempt its admission slot: {@link JobAdmission}, or {@link MachineJobAdmission}. */
export interface JobAdmissionGate {
  slot(): JobAdmissionSlot;
}

/** The memory the process may still use, in MB; replaceable for tests. */
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
export class JobAdmission implements JobAdmissionGate {
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

/** What the process may still allocate: a container's memory limit counts, beside the free system memory. */
function systemFreeMemoryMb(): number {
  if (typeof process !== 'undefined' && typeof process.availableMemory === 'function') {
    return process.availableMemory() / BYTES_PER_MB;
  }
  const { freemem } = require('node:os') as typeof import('node:os');
  return freemem() / BYTES_PER_MB;
}

/** The store operations machine-wide admission needs (see `JobStateStore.holdLease`). */
export type AdmissionLeaseStore = Required<
  Pick<JobStateStore, 'holdLease' | 'renewLease' | 'releaseLease' | 'listLeases'>
>;

/** Timings of {@link MachineJobAdmission}, replaceable for tests. */
export interface MachineAdmissionProbes extends JobAdmissionProbes {
  hostname?: () => string;
  /** How long a running attempt's lease lasts unless renewed; renewed every third of it. @default 30 */
  leaseSeconds?: number;
  /** How often a waiting attempt checks the store for a slot. @default 250 */
  recheckMs?: number;
}

/** How long the lock that checks and takes a slot is held, at most. */
const LOCK_SECONDS = 5;

/** A running attempt's lease: what it claims. */
interface HeldClaim {
  memoryMb: number;
  job: string;
  pid: number;
}

/**
 * Admission for the job attempts of every process on this machine that shares the job store (`jobs.admission` with
 * `scope: 'machine'`): the servers and their detached runners. Each running attempt holds a lease in the store under
 * this machine's name, renewed every third of its 30 s, so at most `concurrency` run at once on the machine, and each
 * claims `memoryMb` of free memory beyond what the running ones claimed. A process takes a slot under a short lock in
 * the store; its own attempts wait in the order they arrived, and a waiting one checks the store every 250 ms.
 */
export class MachineJobAdmission implements JobAdmissionGate {
  private readonly queue: object[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly maxWaitMs: number;
  private readonly freeMemoryMb: () => number;
  private readonly hostname: () => string;
  private readonly leaseSeconds: number;
  private readonly recheckMs: number;
  /** Why the last check found no slot. */
  private lastWait = 'no slot was free';

  constructor(
    private readonly options: JobAdmissionOptions,
    private readonly store: AdmissionLeaseStore,
    private readonly onStoreError: (message: string) => void = () => undefined,
    probes: MachineAdmissionProbes = {},
  ) {
    this.maxWaitMs = options.maxWaitMs ?? 600_000;
    this.freeMemoryMb = probes.freeMemoryMb ?? systemFreeMemoryMb;
    this.hostname = probes.hostname ?? (() => getHostname() ?? 'localhost');
    this.leaseSeconds = probes.leaseSeconds ?? 30;
    this.recheckMs = probes.recheckMs ?? RECHECK_MS;
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
      for (;;) {
        // The store is read between two checks of the signal: an abort meanwhile ends the wait here
        signal?.throwIfAborted();
        if (this.queue[0] === ticket) {
          const held = await this.tryHold(jobName);
          if (held && signal?.aborted) held();
          signal?.throwIfAborted();
          if (held) return held;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new JobAdmissionTimeoutError(jobName, this.maxWaitMs, this.lastWait);
        await this.nextChange(Math.min(left, this.recheckMs), signal);
      }
    } finally {
      this.queue.splice(this.queue.indexOf(ticket), 1);
      this.wake();
    }
  }

  /** Under the machine's lock in the store, take a slot when the running attempts leave room for one. */
  private async tryHold(jobName: string): Promise<(() => void) | undefined> {
    const prefix = `admission:${this.hostname()}:`;
    const lock = randomUUID();
    try {
      if (!(await this.store.holdLease(`${prefix}lock`, lock, LOCK_SECONDS))) {
        this.lastWait = 'another process is taking a slot';
        return undefined;
      }
    } catch (error) {
      this.reportStoreError(error);
      return undefined;
    }
    try {
      const claims = (await this.store.listLeases(`${prefix}slot:`)).map(parseClaim);
      const { concurrency, memoryMb } = this.options;
      if (concurrency !== undefined && claims.length >= concurrency) {
        this.lastWait = `${claims.length} of ${concurrency} job runs on this machine are busy`;
        return undefined;
      }
      const claimedMb = claims.reduce((sum, claim) => sum + claim.memoryMb, 0);
      if (memoryMb !== undefined && this.freeMemoryMb() - claimedMb < memoryMb) {
        const availableMb = Math.max(0, Math.floor(this.freeMemoryMb() - claimedMb));
        this.lastWait = `it needs ${memoryMb} MB free, and ${availableMb} MB is on this machine`;
        return undefined;
      }
      const key = `${prefix}slot:${randomUUID()}`;
      const claim: HeldClaim = { memoryMb: memoryMb ?? 0, job: jobName, pid: currentPid() };
      const value = JSON.stringify(claim);
      if (!(await this.store.holdLease(key, value, this.leaseSeconds))) return undefined;
      return this.keep(key, value);
    } catch (error) {
      this.reportStoreError(error);
      return undefined;
    } finally {
      await this.store.releaseLease(`${prefix}lock`, lock).catch(() => undefined);
    }
  }

  /** Renew a taken slot's lease every third of it until the attempt ends; the release frees it at once. */
  private keep(key: string, value: string): () => void {
    const renew = setInterval(
      () => {
        this.store.renewLease(key, value, this.leaseSeconds).catch((error: unknown) => this.reportStoreError(error));
      },
      (this.leaseSeconds * 1_000) / 3,
    );
    renew.unref?.();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      clearInterval(renew);
      this.store.releaseLease(key, value).catch((error: unknown) => this.reportStoreError(error));
      this.wake();
    };
  }

  private reportStoreError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastWait = `the job store could not be read (${message})`;
    this.onStoreError(`Job admission: the job store failed: ${message}`);
  }

  /** Resolve when a slot of this process is released or `ms` pass; reject with the abort reason when `signal` aborts. */
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

/** A lease's claim; one that can't be read claims no memory, and still counts as a running attempt. */
function parseClaim(value: string): HeldClaim {
  try {
    const parsed = JSON.parse(value) as Partial<HeldClaim>;
    return { memoryMb: Number(parsed.memoryMb) || 0, job: String(parsed.job ?? ''), pid: Number(parsed.pid) || 0 };
  } catch {
    return { memoryMb: 0, job: '', pid: 0 };
  }
}

function currentPid(): number {
  return typeof process === 'undefined' ? 0 : process.pid;
}

/**
 * The admission `jobs.admission` asks for: per process, or, with `scope: 'machine'`, through `store`, which must keep
 * leases (every job store FrontMCP opens does). Undefined without `jobs.admission`.
 */
export function createJobAdmission(
  options: JobAdmissionOptions | undefined,
  store: JobStateStore,
  onStoreError?: (message: string) => void,
): JobAdmissionGate | undefined {
  if (!options) return undefined;
  if (options.scope !== 'machine') return new JobAdmission(options);
  const { holdLease, renewLease, releaseLease, listLeases } = store;
  if (!holdLease || !renewLease || !releaseLease || !listLeases) {
    throw new JobStoreNotSupportedError(
      "jobs.admission.scope 'machine' needs a job store that keeps leases: jobs.store.sqlite, a top-level sqlite, or Redis",
    );
  }
  return new MachineJobAdmission(options, store as JobStateStore & AdmissionLeaseStore, onStoreError);
}
