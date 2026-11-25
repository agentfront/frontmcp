import type { PostReviewAction, ReviewDecision, ReviewOptions } from '@enclave-vm/core/worker';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import type { ScriptToolCall } from './call-idempotency-key';
import { isInputRefusal } from './call-stage';
import { argumentsHashOf, journalToolNameOf, type RunJournal } from './run-journal';
import type { CodeCallJournalEntry, CodeCallPendingCall, CodeCallRunRecord } from './run-record.types';

/** The call a resumed run stopped before, which runs live, with the corrected arguments the agent sent for it. */
export interface RunReplayPending {
  call: CodeCallPendingCall;
  arguments?: Record<string, unknown>;
}

/** What a run that is run again replays: the calls its journal recorded, and the clock and random values it read. */
export type RunReplaySource = Pick<CodeCallRunRecord, 'journal' | 'clock' | 'random' | 'outputs'> & {
  pending?: RunReplayPending;
};

/** What the runtime reads for a run that may be replayed. */
export interface RunReplayHooks {
  toolResultOrder: 'call';
  clock: () => number;
  random: () => number;
}

/** The code of a run that diverged from the journal it replays: it ends with that, whatever the review decided. */
export const RUN_DIVERGED = 'RUN_DIVERGED';

/** The clock and random values a run read. */
type RunReads = Pick<CodeCallRunRecord, 'clock' | 'random' | 'outputs'>;

/** Where the run was when a call first reached the host: what it had read and written, its operations, and when. */
interface RunPoint {
  clock: number;
  random: number;
  outputs: number;
  operations: number;
  at: number;
}

/**
 * Enclave's sequence detectors and operation rate limit read the real clock, and a replay answers its recorded calls at
 * once: a run is replayed safely only when all it did before its paused call took less than the shortest detector
 * window (5 s), in fewer operations than the rate limit allows a second (Enclave's default, which CodeCall keeps).
 */
const DETECTOR_WINDOW_MS = 5000;
const MAX_OPERATIONS_PER_SECOND = 100;

/** The calls to one tool Enclave allows within its window (`vm.rapidEnumerationThreshold` and its overrides). */
export interface RunReplayToolLimits {
  threshold: number;
  overrides?: Record<string, number>;
}

const ENCLAVE_RAPID_ENUMERATION_THRESHOLD = 30;

const ALLOW: ReviewDecision = { decision: 'allow' };
const PASS: PostReviewAction = { action: 'pass' };

/** The error a run ends with when its script does not make the call its journal recorded at a position. */
export class RunDivergedError extends Error {
  readonly code = RUN_DIVERGED;

  constructor(message: string) {
    super(message);
    this.name = 'RunDivergedError';
  }
}

/**
 * The replay of one run: the calls of the run it replays answered from that run's journal, matched by position, tool
 * and arguments; the clock and random values it read returned again in order, then live ones; and every value read
 * recorded, so this run can be replayed in turn.
 */
export class RunReplay {
  private readonly clockReads: number[] = [];
  private outputsWritten = 0;
  private readonly randomReads: number[] = [];
  private readonly recorded = new Map<number, CodeCallJournalEntry>();
  private readonly pointAtCall = new Map<number, RunPoint>();
  private readonly toolAtCall = new Map<number, string>();
  private startedAt = Date.now();
  private firstOperationAt?: number;
  private operations = 0;
  private readonly inputRefusals = new Set<number>();
  private callsReached = 0;
  private divergence?: RunDivergedError;
  private applied = false;

  constructor(
    private readonly source?: RunReplaySource,
    private readonly toolLimits: RunReplayToolLimits = { threshold: ENCLAVE_RAPID_ENUMERATION_THRESHOLD },
  ) {
    for (const entry of source?.journal ?? []) this.recorded.set(entry.position - 1, entry);
  }

  /** Whether this run replays another: a run that cannot apply the replay must not run. */
  get replaysRun(): boolean {
    return this.source !== undefined;
  }

  /** Whether the runtime applied {@link hooks}, so this run can be replayed in turn. */
  get recordsReads(): boolean {
    return this.applied;
  }

  /** The runtime options that make the run replayable: results in call order, and this replay's clock and random. */
  get hooks(): RunReplayHooks {
    return { toolResultOrder: 'call', clock: this.clock, random: this.random };
  }

  /** Records whether the runtime applied {@link hooks}: a runtime that did not leaves nothing to replay. */
  appliedByRuntime(applied: boolean): void {
    this.applied = applied;
    this.startedAt = Date.now();
  }

  readonly clock = (): number => this.read(this.clockReads, this.source?.clock, Date.now);

  readonly random = (): number => this.read(this.randomReads, this.source?.random, Math.random);

  /** Whether the call at `callIndex` is one of the calls the replayed run recorded. */
  replays(callIndex: number): boolean {
    return this.recorded.has(callIndex);
  }

  /**
   * The decision the call-phase hooks would give the call at `callIndex`, without asking them: the recorded refusal the
   * script caught (`needs_changes` or `denied`), `allow` for a call that reached its tool, or for one that does not match
   * the record (its tool handler then ends the run), or undefined for a call they must decide live.
   */
  decisionOf(callIndex: number, toolName: string, args: unknown): ReviewDecision | undefined {
    this.reached(callIndex, toolName);
    const entry = this.recorded.get(callIndex);
    if (entry) return (!mismatchOf(entry, toolName, args) && entry.decision) || ALLOW;
    return this.pendingAt(callIndex) && this.pendingMismatchOf(toolName, args) ? ALLOW : undefined;
  }

  /** Counts a call into a host function, which Enclave's rate limit counts with tool calls. */
  hostFunctionCalled(): void {
    this.operated();
  }

  /**
   * Whether replaying the run up to the call at `callIndex` stays clear of Enclave's sequence detectors and rate limits,
   * which read the real clock: its operations before that call, from its first, took less than the shortest detector
   * window, were fewer than the rate limit allows a second, and called no tool more often than it allows in its window.
   */
  replaysWithinDetectors(callIndex: number): boolean {
    const point = this.pointAtCall.get(callIndex) ?? this.pointNow();
    const span = point.at - (this.firstOperationAt ?? point.at);
    return (
      span < DETECTOR_WINDOW_MS && point.operations < MAX_OPERATIONS_PER_SECOND && this.withinToolLimits(callIndex)
    );
  }

  /** Whether the calls up to the one at `callIndex` make no more calls to one tool than Enclave allows in its window. */
  private withinToolLimits(callIndex: number): boolean {
    const calls = new Map<string, number>();
    for (const [index, tool] of this.toolAtCall) {
      if (index <= callIndex) calls.set(tool, (calls.get(tool) ?? 0) + 1);
    }
    const { threshold, overrides = {} } = this.toolLimits;
    return [...calls].every(([tool, count]) => count <= (Object.hasOwn(overrides, tool) ? overrides[tool] : threshold));
  }

  /**
   * When the call at `callIndex` reached the host, in ms after the run started, on the run's timeline without its
   * pauses: a replayed call keeps the time its record has, and a call after the paused one follows on from the time the
   * paused call first reached the host.
   */
  arrivalOf(callIndex: number): number | undefined {
    const recorded = this.recorded.get(callIndex)?.arrivedAtMs;
    if (recorded !== undefined) return recorded;
    const point = this.pointAtCall.get(callIndex);
    if (!point) return undefined;
    const pending = this.source?.pending?.call;
    const resumedAt = pending && this.pointAtCall.get(pending.position - 1)?.at;
    if (pending?.arrivedAtMs !== undefined && resumedAt !== undefined)
      return pending.arrivedAtMs + point.at - resumedAt;
    return point.at - this.startedAt;
  }

  /** The arguments the call at `callIndex` runs with: the agent's corrected ones for the pending call. */
  argumentsFor<T>(callIndex: number, args: T): T | Record<string, unknown> {
    return (this.pendingAt(callIndex) && this.source?.pending?.arguments) || args;
  }

  /**
   * The answer the replayed run recorded for the call at `call.callIndex`, or undefined for a call that runs live. A
   * call that differs from the recorded one, or from the pending one, in tool or arguments ends the run.
   */
  answerOf(call: ScriptToolCall | undefined, toolName: string, args: unknown): Promise<unknown> | undefined {
    if (this.divergence) return Promise.reject(this.divergence);
    if (!call) return undefined;
    this.reached(call.callIndex, toolName);
    if (!this.source) return undefined;
    const entry = this.recorded.get(call.callIndex);
    const mismatch = entry
      ? mismatchOf(entry, toolName, args)
      : this.pendingAt(call.callIndex) && this.pendingMismatchOf(toolName, args);
    if (mismatch) return Promise.reject(this.diverge(`call ${call.callIndex + 1} ${mismatch}`));
    if (!entry) return undefined;
    if (entry.outcome === 'success') return Promise.resolve(entry.result);
    return Promise.reject(Object.freeze({ ...entry.error, toolName: entry.tool }));
  }

  /** Records that the live call at `callIndex` failed with `error`, and whether it was refused before its tool ran. */
  failedLive(callIndex: number, error: unknown): void {
    if (isInputRefusal(error)) this.inputRefusals.add(callIndex);
  }

  /** Whether the call at `callIndex` failed input validation, which the call flow reported before the tool ran. */
  refusedInputAt(callIndex: number): boolean {
    return this.inputRefusals.has(callIndex);
  }

  /** The divergence the run ends with, also when it ended, without timing out, before making every recorded call. */
  divergenceOf(timedOut: boolean): RunDivergedError | undefined {
    const recordedCalls = (this.source?.journal.length ?? 0) + (this.source?.pending ? 1 : 0);
    if (this.divergence || timedOut || this.callsReached >= recordedCalls) return this.divergence;
    return this.diverge(`script ended before call ${recordedCalls}, which its run made`);
  }

  /**
   * The clock and random values the script read, and how many lines of output it wrote, for replaying it; none when the
   * runtime did not apply the replay.
   */
  recordedReads(): RunReads {
    return this.readsUpTo(this.clockReads.length, this.randomReads.length, this.outputsWritten);
  }

  /** The clock and random values the script read, and the output it wrote, before the call at `callIndex` reached the host, each kind always set. */
  readsBefore(callIndex: number): RunReads {
    const point = this.pointAtCall.get(callIndex) ?? this.pointNow();
    return {
      clock: undefined,
      random: undefined,
      outputs: undefined,
      ...this.readsUpTo(point.clock, point.random, point.outputs),
    };
  }

  /** `write`, skipped for the lines of output the run it replays already wrote: as many as it wrote, in order. */
  quiet<Args extends unknown[]>(write: ((...args: Args) => void) | undefined): ((...args: Args) => void) | undefined {
    return (
      write &&
      ((...args: Args) => {
        this.outputsWritten++;
        if (this.outputsWritten > (this.source?.outputs ?? 0)) write(...args);
      })
    );
  }

  private reached(callIndex: number, toolName: string): void {
    this.callsReached = Math.max(this.callsReached, callIndex + 1);
    if (this.pointAtCall.has(callIndex)) return;
    this.toolAtCall.set(callIndex, journalToolNameOf(toolName));
    this.pointAtCall.set(callIndex, this.pointNow());
    this.operated();
  }

  private operated(): void {
    this.firstOperationAt ??= Date.now();
    this.operations++;
  }

  private pointNow(): RunPoint {
    return {
      clock: this.clockReads.length,
      random: this.randomReads.length,
      outputs: this.outputsWritten,
      operations: this.operations,
      at: Date.now(),
    };
  }

  private pendingAt(callIndex: number): boolean {
    return this.source?.pending?.call.position === callIndex + 1;
  }

  private pendingMismatchOf(toolName: string, args: unknown): string | undefined {
    const pending = this.source?.pending?.call;
    return pending && callMismatchOf(pending, toolName, args);
  }

  private readsUpTo(clock: number, random: number, outputs: number): RunReads {
    if (!this.applied) return {};
    return {
      ...(clock > 0 && { clock: this.clockReads.slice(0, clock) }),
      ...(random > 0 && { random: this.randomReads.slice(0, random) }),
      ...(outputs > 0 && { outputs }),
    };
  }

  private read(reads: number[], recorded: readonly number[] | undefined, live: () => number): number {
    const value = recorded?.[reads.length] ?? live();
    reads.push(value);
    return value;
  }

  private diverge(what: string): RunDivergedError {
    this.divergence ??= new RunDivergedError(`The run diverged from its journal: ${what}`);
    return this.divergence;
  }
}

/** How a call differs in tool or arguments from the one recorded at its position, or undefined when it is that call. */
function callMismatchOf(recorded: CodeCallPendingCall, toolName: string, args: unknown): string | undefined {
  const tool = journalToolNameOf(toolName);
  if (recorded.tool !== tool) return `was to "${recorded.tool}", not "${tool}"`;
  return recorded.argumentsHash === argumentsHashOf(args) ? undefined : `to "${recorded.tool}" had other arguments`;
}

/**
 * Whether a recorded call can be answered again: its result, the error the script got, or a refusal the script caught.
 * A `needs_approval` stopped its run, so it is never answered from a record: its call is always asked again.
 */
export function isReplayable(entry: CodeCallJournalEntry): boolean {
  if (entry.decision) return entry.decision.decision !== 'needs_approval';
  return entry.outcome === 'success' || entry.error !== undefined;
}

/** How a call differs from the journal entry at its position, or undefined when it is the recorded call. */
function mismatchOf(entry: CodeCallJournalEntry, toolName: string, args: unknown): string | undefined {
  return (
    callMismatchOf(entry, toolName, args) ??
    (isReplayable(entry) ? undefined : `to "${entry.tool}" has no recorded result`)
  );
}

/** A host function that counts its calls for the replay. */
function counted<Args extends unknown[], Result>(
  replay: RunReplay,
  fn: ((...args: Args) => Result) | undefined,
): ((...args: Args) => Result) | undefined {
  return (
    fn &&
    ((...args: Args) => {
      replay.hostFunctionCalled();
      return fn(...args);
    })
  );
}

/** `environment` with its host functions counted, and its host logs quiet while the script repeats what was written. */
export function replayedEnvironment(environment: CodeCallVmEnvironment, replay: RunReplay): CodeCallVmEnvironment {
  const getTool = counted(replay, environment.getTool) ?? environment.getTool;
  const mcpLog = counted(replay, replay.quiet(environment.mcpLog));
  const mcpNotify = counted(replay, replay.quiet(environment.mcpNotify));
  return { ...environment, getTool, mcpLog, mcpNotify };
}

/**
 * What the tool handler gets for a call of the script: the recorded answer of a call the replayed run made, without
 * calling it, else the `live` call with the arguments it runs with (the agent's corrected ones for the pending call).
 */
export async function callOrReplay(
  replay: RunReplay | undefined,
  call: ScriptToolCall | undefined,
  toolName: string,
  args: Record<string, unknown>,
  live: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  const recorded = replay?.answerOf(call, toolName, args);
  if (recorded) return recorded;
  if (!replay || !call) return live(args);
  try {
    return await live(replay.argumentsFor(call.callIndex, args));
  } catch (error: unknown) {
    replay.failedLive(call.callIndex, error);
    throw error;
  }
}

/**
 * The run's call-phase hooks (the review's and the budgets'): a call the replayed run recorded is not asked again but
 * gets its recorded decision, the pending call is asked with its corrected arguments, and a call refused, live or from
 * the record, is recorded in the journal, which it never reaches otherwise.
 */
export function journaledReviewHooks({ pre, post, ...options }: ReviewOptions, journal: RunJournal): ReviewOptions {
  const { replay } = journal;
  return {
    ...options,
    ...(pre && {
      pre: async (input) => {
        if (input.phase !== 'call') return pre(input);
        const recorded = replay?.decisionOf(input.callIndex, input.toolName, input.args);
        if (recorded && recorded.decision !== 'allow')
          journal.refuse(input.toolName, input.args, input.callIndex, recorded);
        if (recorded) return recorded;
        const args = replay ? replay.argumentsFor(input.callIndex, input.args) : input.args;
        const decision = await pre({ ...input, args });
        if (decision.decision !== 'allow') journal.refuse(input.toolName, input.args, input.callIndex, decision);
        return decision;
      },
    }),
    ...(post && {
      post: (input) => (input.phase === 'call-result' && replay?.replays(input.callIndex) ? PASS : post(input)),
    }),
  };
}
