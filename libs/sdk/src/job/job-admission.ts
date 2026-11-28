import { getHostname, randomUUID } from '@frontmcp/utils';

import { JobAdmissionLostError, JobAdmissionTimeoutError, JobStoreNotSupportedError } from '../errors';
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
  /** Aborted with `JobAdmissionLostError` once the slot ended while the attempt holds it: the attempt stops. */
  readonly lost?: AbortSignal;
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

/** The store operations machine-wide admission needs (see `JobStateStore.swapLeases`). */
export type AdmissionLeaseStore = Required<Pick<JobStateStore, 'readLeases' | 'swapLeases'>>;

/** Timings of {@link MachineJobAdmission}, replaceable for tests. */
export interface MachineAdmissionProbes extends JobAdmissionProbes {
  hostname?: () => string;
  /** How long a running attempt's lease lasts unless renewed; renewed every third of it. @default 30 */
  leaseSeconds?: number;
  /** How often a waiting attempt checks the store for a slot. @default 250 */
  recheckMs?: number;
}

/** How many times a change of a machine's leases is read again after another process swapped them first. */
const MAX_SWAPS = 20;

/** A running attempt's lease, in its machine's list. */
interface HeldClaim {
  id: string;
  memoryMb: number;
  job: string;
  pid: number;
  /** When the lease ends unless renewed, in ms since the epoch. */
  expiresAt: number;
}

/** A taken slot, which `release()` frees. */
interface HeldSlot {
  release(): void;
}

/**
 * Admission for the job attempts of every process on this machine that shares the job store (`jobs.admission` with
 * `scope: 'machine'`): the servers and their detached runners. The store keeps one list of leases per machine, which
 * each process changes in one atomic swap: an attempt takes a slot only when the unexpired leases leave room for it,
 * so at most `concurrency` run at once on the machine, and each claims `memoryMb` of free memory beyond what the
 * running ones claimed. Its process renews its lease every third of its 30 s; an attempt whose lease is gone, or would
 * end before the next renewal while the renewals fail, is stopped with `JobAdmissionLostError`. A process's own
 * attempts wait in the order they arrived, and a waiting one checks the store every 250 ms.
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
    const lost = new AbortController();
    let held: HeldSlot | undefined;
    return {
      lost: lost.signal,
      acquire: async (jobName, signal) => {
        held = await this.admit(jobName, signal, (reason) => lost.abort(reason));
      },
      release: () => {
        held?.release();
        held = undefined;
      },
    };
  }

  private async admit(jobName: string, signal: AbortSignal | undefined, onLost: LostListener): Promise<HeldSlot> {
    signal?.throwIfAborted();
    const deadline = Date.now() + this.maxWaitMs;
    const ticket = {};
    this.queue.push(ticket);
    try {
      for (;;) {
        if (this.queue[0] === ticket) {
          const held = await this.takeBefore(deadline, signal, jobName, onLost);
          if (held && signal?.aborted) held.release();
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

  /** {@link take}, waited for until the deadline or an abort; a slot it takes after that is released at once. */
  private async takeBefore(
    deadline: number,
    signal: AbortSignal | undefined,
    jobName: string,
    onLost: LostListener,
  ): Promise<HeldSlot | undefined> {
    const taking = this.take(jobName, onLost);
    let answered: { held: HeldSlot | undefined } | undefined;
    try {
      answered = await settledWithin(taking, deadline - Date.now(), signal);
    } finally {
      if (!answered) void taking.then((late) => late?.release());
    }
    if (!answered) this.lastWait = 'the job store did not answer in time';
    return answered?.held;
  }

  /** Add this attempt's lease to the machine's list when the unexpired ones leave room for it. */
  private async take(jobName: string, onLost: LostListener): Promise<HeldSlot | undefined> {
    const { concurrency, memoryMb } = this.options;
    const claim: HeldClaim = {
      id: randomUUID(),
      memoryMb: memoryMb ?? 0,
      job: jobName,
      pid: currentPid(),
      expiresAt: 0,
    };
    let taken = false;
    try {
      taken = await this.changeClaims((claims) => {
        if (concurrency !== undefined && claims.length >= concurrency) {
          this.lastWait = `${claims.length} of ${concurrency} job runs on this machine are busy`;
          return undefined;
        }
        const claimedMb = claims.reduce((sum, running) => sum + running.memoryMb, 0);
        const availableMb = this.freeMemoryMb() - claimedMb;
        if (memoryMb !== undefined && availableMb < memoryMb) {
          this.lastWait = `it needs ${memoryMb} MB free, and ${Math.max(0, Math.floor(availableMb))} MB is on this machine`;
          return undefined;
        }
        claim.expiresAt = Date.now() + this.leaseSeconds * 1_000;
        return [...claims, claim];
      });
      if (!taken) return undefined;
      // A write the store answered late leaves less than two renewals' time: renew the lease now, or give the slot up
      const renewEveryMs = (this.leaseSeconds * 1_000) / 3;
      if (claim.expiresAt - Date.now() < 2 * renewEveryMs && !(await this.renewClaim(claim))) {
        this.lastWait = 'its lease ended before the job store answered';
        return undefined;
      }
      return this.keep(claim, jobName, onLost);
    } catch (error) {
      this.reportStoreError(error);
      if (taken) void this.removeClaim(claim).catch(() => undefined);
      return undefined;
    }
  }

  /** Extend `claim`'s lease in the machine's list; resolves to false once the lease is gone from it. */
  private async renewClaim(claim: HeldClaim): Promise<boolean> {
    const expiresAt = Date.now() + this.leaseSeconds * 1_000;
    const renewed = await this.changeClaims((claims) => {
      const own = claims.find((running) => running.id === claim.id);
      return own && claims.map((running) => (running === own ? { ...own, expiresAt } : running));
    });
    if (renewed) claim.expiresAt = expiresAt;
    return renewed;
  }

  /** Take `claim`'s lease out of the machine's list. */
  private removeClaim(claim: HeldClaim): Promise<boolean> {
    return this.changeClaims((claims) =>
      claims.some((running) => running.id === claim.id)
        ? claims.filter((running) => running.id !== claim.id)
        : undefined,
    );
  }

  /**
   * Renew a taken slot's lease every third of it until the attempt ends; the release frees it. The attempt is told it
   * lost the slot once its lease is gone, or would end before the next renewal while the renewals fail.
   */
  private keep(claim: HeldClaim, jobName: string, onLost: LostListener): HeldSlot {
    const renewEveryMs = (this.leaseSeconds * 1_000) / 3;
    let heldUntil = claim.expiresAt;
    let renewing = false;
    let held = true;
    const lose = (why: string) => {
      clearInterval(renew);
      if (held) onLost(new JobAdmissionLostError(jobName, why));
    };
    // A renewal that failed, or has not answered, with less than a renewal's time left loses the slot
    const loseIfEnding = () => {
      if (Date.now() + renewEveryMs >= heldUntil) lose('its lease in the job store could not be renewed');
    };
    const renew = setInterval(() => {
      if (renewing) return loseIfEnding();
      renewing = true;
      this.renewClaim(claim)
        .then((renewed) => {
          if (renewed) heldUntil = claim.expiresAt;
          else lose('its lease in the job store ended');
        })
        .catch((error: unknown) => {
          this.reportStoreError(error);
          loseIfEnding();
        })
        .finally(() => (renewing = false));
    }, renewEveryMs);
    renew.unref?.();
    return {
      release: () => {
        if (!held) return;
        held = false;
        clearInterval(renew);
        this.removeClaim(claim)
          .catch((error: unknown) => this.reportStoreError(error))
          .finally(() => this.wake());
      },
    };
  }

  /**
   * Change the machine's unexpired leases in one atomic swap, reading them again when another process swapped
   * meanwhile; resolves to whether it changed them (`change` returns undefined to leave them).
   */
  private async changeClaims(change: (claims: HeldClaim[]) => HeldClaim[] | undefined): Promise<boolean> {
    const key = `admission:${this.hostname()}`;
    for (let swaps = 0; swaps < MAX_SWAPS; swaps++) {
      const current = await this.store.readLeases(key);
      const next = change(liveClaims(current, Date.now()));
      if (!next) return false;
      if (await this.store.swapLeases(key, current, JSON.stringify(next), this.leaseSeconds)) return true;
    }
    throw new Error(`the leases changed under each of ${MAX_SWAPS} swaps`);
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

type LostListener = (reason: JobAdmissionLostError) => void;

/** `work`'s result once it settles within `ms`, undefined past them; rejects with the abort reason when `signal` aborts. */
function settledWithin<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<{ held: T } | undefined> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      stop();
      reject(signal?.reason);
    };
    const timer = setTimeout(
      () => {
        stop();
        resolve(undefined);
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', aborted, { once: true });
    work.then(
      (held) => {
        stop();
        resolve({ held });
      },
      (error: unknown) => {
        stop();
        reject(error);
      },
    );
  });
}

/** The unexpired leases of a machine's list; one that can't be read claims no memory, and still counts until it ends. */
function liveClaims(raw: string, now: number): HeldClaim[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry: Partial<HeldClaim>) => ({
      id: String(entry.id ?? ''),
      memoryMb: Number(entry.memoryMb) || 0,
      job: String(entry.job ?? ''),
      pid: Number(entry.pid) || 0,
      expiresAt: Number(entry.expiresAt) || 0,
    }))
    .filter((claim) => claim.expiresAt > now);
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
  const { readLeases, swapLeases } = store;
  if (!readLeases || !swapLeases) {
    throw new JobStoreNotSupportedError(
      "jobs.admission.scope 'machine' needs a job store that keeps leases: jobs.store.sqlite, a top-level sqlite, or Redis",
    );
  }
  return new MachineJobAdmission(options, store as JobStateStore & AdmissionLeaseStore, onStoreError);
}
