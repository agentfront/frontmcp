import type { CodeCallVmEnvironment } from '../codecall.symbol';
import type { CallToolOptions } from '../errors';
import type { ScriptToolCall } from './call-idempotency-key';
import { argumentsHashOf, journalToolNameOf } from './run-journal';
import type { CodeCallJournalEntry, CodeCallRunRecord } from './run-record.types';

/** What a run that is run again replays: the calls its journal recorded, and the clock and random values it read. */
export type RunReplaySource = Pick<CodeCallRunRecord, 'journal' | 'clock' | 'random'>;

/** What the runtime reads for a run that may be replayed. */
export interface RunReplayHooks {
  toolResultOrder: 'call';
  clock: () => number;
  random: () => number;
}

/** The code of a run that diverged from the journal it replays: it ends with that, whatever the review decided. */
export const RUN_DIVERGED = 'RUN_DIVERGED';

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
  private readonly randomReads: number[] = [];
  private callsReached = 0;
  private divergence?: RunDivergedError;
  private applied = false;

  constructor(private readonly source?: RunReplaySource) {}

  /** Whether this run replays another: a run that cannot apply the replay must not run. */
  get replaysRun(): boolean {
    return this.source !== undefined;
  }

  /** Whether the script has not yet passed the calls of the run it replays, whose output was already written. */
  get replaying(): boolean {
    return this.source !== undefined && this.callsReached <= this.source.journal.length;
  }

  /** The runtime options that make the run replayable: results in call order, and this replay's clock and random. */
  get hooks(): RunReplayHooks {
    return { toolResultOrder: 'call', clock: this.clock, random: this.random };
  }

  /** Records whether the runtime applied {@link hooks}: a runtime that did not leaves nothing to replay. */
  appliedByRuntime(applied: boolean): void {
    this.applied = applied;
  }

  readonly clock = (): number => this.read(this.clockReads, this.source?.clock, Date.now);

  readonly random = (): number => this.read(this.randomReads, this.source?.random, Math.random);

  /**
   * The answer the replayed run recorded for the call at `call.callIndex`, or undefined for a call past its journal,
   * which runs live. A call that differs from the recorded one in tool or arguments ends the run with a divergence.
   */
  answerOf(call: ScriptToolCall | undefined, toolName: string, args: unknown): Promise<unknown> | undefined {
    if (this.divergence) return Promise.reject(this.divergence);
    if (!call || !this.source) return undefined;
    this.callsReached = Math.max(this.callsReached, call.callIndex + 1);
    const entry = this.source.journal[call.callIndex];
    if (!entry) return undefined;
    const mismatch = mismatchOf(entry, toolName, args);
    if (mismatch) return Promise.reject(this.diverge(`call ${entry.position} ${mismatch}`));
    if (entry.outcome === 'success') return Promise.resolve(entry.result);
    return Promise.reject(Object.freeze({ ...entry.error, toolName: entry.tool }));
  }

  /** The divergence the run ends with, also when it ended, without timing out, before making every recorded call. */
  divergenceOf(timedOut: boolean): RunDivergedError | undefined {
    const recordedCalls = this.source?.journal.length ?? 0;
    if (this.divergence || timedOut || this.callsReached >= recordedCalls) return this.divergence;
    return this.diverge(`script ended before call ${recordedCalls}, which its run made`);
  }

  /** The clock and random values the script read, for its run record; none when the runtime did not apply the replay. */
  recordedReads(): Pick<CodeCallRunRecord, 'clock' | 'random'> {
    if (!this.applied) return {};
    return {
      ...(this.clockReads.length > 0 && { clock: [...this.clockReads] }),
      ...(this.randomReads.length > 0 && { random: [...this.randomReads] }),
    };
  }

  /** `write`, skipped while the script repeats what the run it replays already wrote. */
  quiet<Args extends unknown[]>(write: ((...args: Args) => void) | undefined): ((...args: Args) => void) | undefined {
    return write && ((...args: Args) => (this.replaying ? undefined : write(...args)));
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

/** How a call differs from the journal entry at its position, or undefined when it is the recorded call. */
function mismatchOf(entry: CodeCallJournalEntry, toolName: string, args: unknown): string | undefined {
  if (entry.tool !== journalToolNameOf(toolName)) return `was to "${entry.tool}", not "${journalToolNameOf(toolName)}"`;
  if (entry.argumentsHash !== argumentsHashOf(args)) return `to "${entry.tool}" had other arguments`;
  if (entry.outcome === 'unfinished' || (entry.outcome === 'failure' && !entry.error)) {
    return `to "${entry.tool}" has no recorded result`;
  }
  return undefined;
}

/** `environment` with the calls the replay recorded answered from it, and its host logs quiet while it replays. */
export function replayedEnvironment(environment: CodeCallVmEnvironment, replay: RunReplay): CodeCallVmEnvironment {
  const { callTool, mcpLog, mcpNotify } = environment;
  return {
    ...environment,
    callTool: <TInput, TResult>(name: string, input: TInput, options?: CallToolOptions, call?: ScriptToolCall) =>
      (replay.answerOf(call, name, input) as Promise<TResult> | undefined) ??
      callTool<TInput, TResult>(name, input, options, call),
    mcpLog: replay.quiet(mcpLog),
    mcpNotify: replay.quiet(mcpNotify),
  };
}
