import type { PostReviewAction, ReviewDecision, ReviewOptions } from '@enclave-vm/core/worker';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import type { CodeCallReplayedCall } from '../services/runtime/runtime.types';
import type { ScriptToolCall } from './call-idempotency-key';
import { isRefusedBeforeTool } from './call-stage';
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
  /** The recorded calls, with when each first reached the host, when the record has every time. */
  replayedCalls?: readonly CodeCallReplayedCall[];
  /** When the paused call first reached the host, from the run's start, for a resume with {@link replayedCalls}. */
  replayedCallsResumeAtMs?: number;
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
  hostFunctionCalls: number;
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

/** How long Enclave waits for one review hook when `review.timeoutMs` is unset. */
const ENCLAVE_REVIEW_TIMEOUT_MS = 30_000;
/** The longest a held answer leaves before its review hook's timeout, so Enclave never takes it for a hook that hung. */
const MAX_HOLD_MARGIN_MS = 1000;

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
  private hostFunctionCalls = 0;
  private callTimesApplied = false;
  private readonly refusalsBeforeTool = new Set<number>();
  /** For each refused call the script got, how many calls had reached the host when it got it. */
  private readonly releases = new Map<number, number>();
  /** The calls whose failure the script ended with, uncaught. */
  private readonly endedWithCalls = new Set<number>();
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

  /**
   * The runtime options that make the run replayable: results in call order, this replay's clock and random, and the
   * calls it replays with when each first reached the host, for Enclave's detectors.
   */
  get hooks(): RunReplayHooks {
    const replayedCalls = this.replayedCalls();
    const pausedAt = this.source?.pending?.call.arrivedAtMs;
    return {
      toolResultOrder: 'call',
      clock: this.clock,
      random: this.random,
      ...(replayedCalls && { replayedCalls }),
      ...(replayedCalls &&
        pausedAt !== undefined && {
          replayedCallsResumeAtMs: Math.max(pausedAt, replayedCalls[replayedCalls.length - 1].elapsedMs),
        }),
    };
  }

  /**
   * Records whether the runtime applied {@link hooks}, without which there is nothing to replay, and whether its
   * detectors judge replayed calls by their recorded times (`callTimes`).
   */
  appliedByRuntime(applied: boolean, callTimes = false): void {
    this.applied = applied;
    this.callTimesApplied = callTimes && (this.source === undefined || this.replayedCalls() !== undefined);
    this.startedAt = Date.now();
  }

  readonly clock = (): number => this.read(this.clockReads, this.source?.clock, Date.now);

  readonly random = (): number => this.read(this.randomReads, this.source?.random, Math.random);

  /** How many recorded calls to `tool` the call-phase hooks let through, which count against an approval's calls. */
  recordedCallsTo(tool: string): number {
    return [...this.recorded.values()].filter((entry) => entry.tool === tool && !entry.decision).length;
  }

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

  /** Counts a call into a host function, which Enclave's rate limit counts with tool calls, also on replay. */
  hostFunctionCalled(): void {
    this.hostFunctionCalls++;
    this.operated();
  }

  /**
   * Whether replaying the run up to the call at `callIndex` stays clear of Enclave's sequence detectors and rate limits,
   * which read the real clock. Where the runtime judges replayed calls by their recorded times and the replay is the
   * run's calls before its paused call, every one of them (`prefix`), only its host function calls, which run again,
   * count against the rate limit; elsewhere its operations before that call, from its first, took less than the shortest
   * detector window, were fewer than the rate limit allows a second, and called no tool more often than it allows in its
   * window. Enclave judges by recorded times only the replayed calls before the first live one, so a record with calls
   * after the paused one, or a gap before it, is judged the second way.
   */
  replaysWithinDetectors(callIndex: number, prefix = true): boolean {
    const point = this.pointAtCall.get(callIndex) ?? this.pointNow();
    if (this.callTimesApplied && prefix) return point.hostFunctionCalls < MAX_OPERATIONS_PER_SECOND;
    return this.passesFallbackGuard(callIndex, point);
  }

  /**
   * Whether replaying the run up to the call at `callIndex` needs a runtime that judges replayed calls by their recorded
   * times: it may pause there only because this one does.
   */
  needsCallTimes(callIndex: number, prefix = true): boolean {
    return (
      this.callTimesApplied &&
      prefix &&
      !this.passesFallbackGuard(callIndex, this.pointAtCall.get(callIndex) ?? this.pointNow())
    );
  }

  /** The last call that reached the host so far, or -1 before any. */
  get lastCallIndex(): number {
    return this.callsReached - 1;
  }

  private passesFallbackGuard(callIndex: number, point: RunPoint): boolean {
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
    if (isRefusedBeforeTool(error)) this.refusalsBeforeTool.add(callIndex);
  }

  /** Whether the call at `callIndex` was refused before its tool ran: its input validation failed, or a budget. */
  refusedBeforeToolAt(callIndex: number): boolean {
    return this.refusalsBeforeTool.has(callIndex);
  }

  /** How many calls reached the host so far. */
  get callsSeen(): number {
    return this.pointAtCall.size;
  }

  /** Records that the script got the refusal of the call at `callIndex` now, after the calls that reached the host. */
  released(callIndex: number): void {
    this.releases.set(callIndex, Math.max(this.callsReached, callIndex + 1));
  }

  /**
   * Whether no call reached the host after the script got the refusal of the call at `callIndex`: a script that went
   * on to make another call caught it, and a run is never paused at a refusal its script caught.
   */
  releasedLast(callIndex: number): boolean {
    return this.callsReached <= (this.releases.get(callIndex) ?? callIndex + 1);
  }

  /** Records the calls whose failure the script ended with: the one it threw, or those a failed `parallel()` named. */
  endedWith(callIndexes: Iterable<number>): void {
    for (const callIndex of callIndexes) this.endedWithCalls.add(callIndex);
  }

  /** Whether the script ended with the failure of the call at `callIndex`. */
  endedWithCallAt(callIndex: number): boolean {
    return this.endedWithCalls.has(callIndex);
  }

  /**
   * The divergence the run ends with: a recorded call made with another tool or arguments, or a script that ended before
   * making every recorded call, unless the sandbox stopped it there (a timeout, or a refusal of its own).
   */
  divergenceOf(stoppedBySandbox: boolean): RunDivergedError | undefined {
    if (this.divergence || stoppedBySandbox || !this.endedEarly) return this.divergence;
    return this.diverge(`script ended before call ${this.recordedCalls}, which its run made`);
  }

  /** Whether the script ended before making every call its run recorded, the paused one included. */
  get endedEarly(): boolean {
    return this.callsReached < this.recordedCalls;
  }

  /** The calls the replayed run made up to its last recorded one, the paused call included. */
  private get recordedCalls(): number {
    const positions = (this.source?.journal ?? []).map((entry) => entry.position);
    return Math.max(0, this.source?.pending?.call.position ?? 0, ...positions);
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
      hostFunctionCalls: this.hostFunctionCalls,
      at: Date.now(),
    };
  }

  /**
   * The calls this run replays before its paused call, for Enclave's detectors, or undefined when its record lacks a
   * time. Enclave judges replayed calls by their recorded times only up to the first call that runs live; the recorded
   * calls of a `parallel()` after the paused one reach it at about the times they first did, as live calls.
   */
  private replayedCalls(): CodeCallReplayedCall[] | undefined {
    const pausedAt = this.source?.pending?.call.position ?? Number.POSITIVE_INFINITY;
    const entries = (this.source?.journal ?? []).filter((entry) => entry.position < pausedAt);
    if (entries.length === 0 || entries.some((entry) => entry.arrivedAtMs === undefined)) return undefined;
    let elapsedMs = 0;
    return entries.map((entry) => {
      elapsedMs = Math.max(elapsedMs, entry.arrivedAtMs ?? 0);
      return { callIndex: entry.position - 1, toolName: entry.tool, elapsedMs };
    });
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

/** When a held answer must go out at the latest: before Enclave's review hook, which started at `startedAt`, times out. */
function holdDeadlineOf(startedAt: number, timeoutMs = ENCLAVE_REVIEW_TIMEOUT_MS): number {
  return startedAt + timeoutMs - Math.min(MAX_HOLD_MARGIN_MS, Math.ceil(timeoutMs / 10));
}

/**
 * The run's call-phase hooks (the review's and the budgets'): a call the replayed run recorded is not asked again but
 * gets its recorded decision, the pending call is asked with its corrected arguments, and a call refused, live or from
 * the record, is recorded in the journal, which it never reaches otherwise.
 *
 * In a run that can pause, a live refusal is held while the run's other calls, a `parallel()`'s, settle (see
 * `RunStops`): a `needs_approval` then stops the run with each of them recorded. A refusal the script never got,
 * because another call's `needs_approval` stopped the run first, is not journaled: its call is asked again on resume.
 * A call allowed while a `needs_approval` stops the run gets its answer once the run stopped, and never runs.
 */
export function journaledReviewHooks({ pre, post, ...options }: ReviewOptions, journal: RunJournal): ReviewOptions {
  const { replay, stops } = journal;
  return {
    ...options,
    ...(pre && {
      pre: async (input) => {
        if (input.phase !== 'call') return pre(input);
        const startedAt = Date.now();
        const recorded = replay?.decisionOf(input.callIndex, input.toolName, input.args);
        if (recorded && recorded.decision !== 'allow')
          journal.refuse(input.toolName, input.args, input.callIndex, recorded);
        if (recorded) return recorded;
        const args = replay ? replay.argumentsFor(input.callIndex, input.args) : input.args;
        const asked = stops.asked();
        let decision: ReviewDecision;
        try {
          decision = await pre({ ...input, args });
        } finally {
          asked();
        }
        if (decision.decision === 'allow') {
          await stops.afterHalt();
          return decision;
        }
        if (journal.holdsStops) {
          const halts = decision.decision === 'needs_approval';
          const deadline = holdDeadlineOf(startedAt, options.timeoutMs);
          if ((await stops.hold(input.callIndex, halts, deadline)) === 'moot') return decision;
        }
        journal.refuse(input.toolName, input.args, input.callIndex, decision);
        return decision;
      },
    }),
    ...(post && {
      post: (input) => (input.phase === 'call-result' && replay?.replays(input.callIndex) ? PASS : post(input)),
    }),
  };
}
