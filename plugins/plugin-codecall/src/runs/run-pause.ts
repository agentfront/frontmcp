import { randomUUID } from '@frontmcp/utils';

import type { CodeCallRunsOptions } from '../codecall.types';
import { reachedTool, type RunJournal } from './run-journal';
import type { CodeCallRunInput } from './run-record.store';
import type { CodeCallJournalEntry, CodeCallRunPause, CodeCallRunStatus } from './run-record.types';
import { isReplayable, type RunReplay, type RunReplayPending, type RunReplaySource } from './run-replay';

/** What the agent is told about a paused run, besides its `runId`. */
export interface CodeCallPausedAnswer {
  /** The call the run stopped before: it did not run. */
  call: { position: number; tool: string };
  expiresAt: string;
}

/** A run record saved `paused`, and how long it is kept. */
export interface PausedRun {
  run: CodeCallRunInput;
  ttlSeconds: number;
}

/** The statuses of a call-phase decision that stops a run before its call: the review's, or a budget's. */
const DECISION_STATUSES: ReadonlySet<string> = new Set(['needs_approval', 'needs_changes', 'denied']);

/** The statuses of a run a failure it did not catch ended: the failure itself, or the failed `parallel()` it was in. */
const FAILURE_STATUSES: ReadonlySet<string> = new Set(['tool_error', 'runtime_error']);

/**
 * The call the run stopped at, before it ran: the first `needs_approval` (Enclave stops the run there); or the first
 * refusal the run ended with, uncaught: a call-phase `needs_changes` or `denied`, or a call the call flow refused before
 * its tool ran (its input, or a budget as it entered the tool), whose failure the script threw, alone or in a failed
 * `parallel()`. A refusal after which another call reached the host was caught: the run did not stop there.
 */
function stoppedAtOf(
  status: CodeCallRunStatus,
  journal: RunJournal,
  replay: RunReplay,
): CodeCallJournalEntry | undefined {
  const entries = journal.entriesSoFar();
  if (status === 'needs_approval') return entries.find((entry) => entry.decision?.decision === status);
  const refusedThere = (entry: CodeCallJournalEntry): boolean => {
    const callIndex = entry.position - 1;
    if (DECISION_STATUSES.has(status)) return entry.decision?.decision === status;
    if (!FAILURE_STATUSES.has(status) || entry.decision) return false;
    return replay.refusedBeforeToolAt(callIndex) && replay.endedWithCallAt(callIndex);
  };
  return entries.find((entry) => refusedThere(entry) && replay.releasedLast(entry.position - 1));
}

/**
 * Whether a call beside the paused one leaves the run pausable: it settled, and a resume can answer it from the
 * record or ask it again. One before the paused call is answered from the record, as the script got it, so it must be
 * replayable; one after it that ran is answered from the record, and one that did not run, or a moot one, is asked
 * again (the script never went on from its answer).
 */
function pausableBeside(entry: CodeCallJournalEntry, pending: CodeCallJournalEntry, journal: RunJournal): boolean {
  if (entry.outcome === 'unfinished') return false;
  if (journal.isMoot(entry.position)) return true;
  if (entry.position > pending.position) return !reachedTool(entry) || isReplayable(entry);
  return isReplayable(entry);
}

/** The calls beside `pending` a resume answers from the record: the others did not run, and are asked again. */
function keptBeside(journal: RunJournal, pending: CodeCallJournalEntry): CodeCallJournalEntry[] {
  return journal
    .entriesSoFar()
    .filter(
      (entry) =>
        entry !== pending &&
        !journal.isMoot(entry.position) &&
        (entry.position < pending.position || reachedTool(entry)),
    );
}

/** Where a resume of the run paused at `pending` replays: up to the call, or the last call after it the record keeps. */
interface ReplayExtent {
  kept: CodeCallJournalEntry[];
  /** The last call a resume answers from the record, or the paused call. */
  lastIndex: number;
  /** Whether the record is every call before the paused one and none after it, which Enclave judges by their times. */
  prefix: boolean;
}

function replayExtentOf(journal: RunJournal, pending: CodeCallJournalEntry): ReplayExtent {
  const kept = keptBeside(journal, pending);
  const lastIndex = Math.max(pending.position, ...kept.map((entry) => entry.position)) - 1;
  const prefix = kept.length === pending.position - 1 && kept.every((entry, index) => entry.position === index + 1);
  return { kept, lastIndex, prefix };
}

/**
 * The call a run stopped before, when the run can pause there (see {@link stoppedAtOf}): every call of the run settled
 * (a `parallel()`'s calls beside it too), the calls before it are answered again as the script got them (none of them
 * another `needs_approval`), and replaying the calls a resume answers from the record stays clear of Enclave's
 * detectors. Nothing the tool or its error says decides it.
 */
export function pendingCallOf(status: CodeCallRunStatus, journal: RunJournal): CodeCallJournalEntry | undefined {
  const { replay } = journal;
  if (!replay?.recordsReads) return undefined;
  const pending = stoppedAtOf(status, journal, replay);
  if (!pending) return undefined;
  const beside = journal.entriesSoFar().filter((entry) => entry !== pending);
  if (!beside.every((entry) => pausableBeside(entry, pending, journal))) return undefined;
  const { lastIndex, prefix } = replayExtentOf(journal, pending);
  return replay.replaysWithinDetectors(lastIndex, prefix) ? pending : undefined;
}

/**
 * Whether the run could still pause at the call its call-phase hooks are asked about now, or at the call at
 * `callIndex` stopped as it enters its tool: it keeps what a replay needs, and its calls so far stay clear of Enclave's
 * detectors. Calls still running count for it: the run waits for them before it stops (see `RunStops`), and only a
 * call that never settles keeps it from pausing.
 */
export function pausableSoFar(journal: RunJournal, callIndex?: number): boolean {
  const { replay } = journal;
  if (replay?.recordsReads !== true) return false;
  return replay.replaysWithinDetectors(Math.max(callIndex ?? -1, replay.lastCallIndex));
}

/**
 * What replays a run up to `pending`, the call it stopped before: the calls a resume answers from the record (those
 * before it, and those after it that ran, a `parallel()`'s), with their results, and what it read before the last of
 * them reached the host. The corrected arguments `previous` had for that same call stay with it.
 */
export function resumeSourceOf(
  journal: RunJournal,
  pending: CodeCallJournalEntry,
  previous?: RunReplaySource,
): RunReplaySource & { pending: RunReplayPending } {
  const arrivalOf = (position: number) => journal.replay?.arrivalOf(position - 1);
  const { position, tool, argumentsHash } = pending;
  const call = { position, tool, argumentsHash, arrivedAtMs: arrivalOf(position) };
  const sameCall = previous?.pending?.call.position === pending.position;
  const corrected = sameCall ? previous?.pending?.arguments : undefined;
  const { kept, lastIndex } = replayExtentOf(journal, pending);
  return {
    journal: kept.map((entry) => ({ ...entry, arrivedAtMs: arrivalOf(entry.position) })),
    ...journal.replay?.readsBefore(lastIndex),
    pending: { call, ...(corrected && { arguments: corrected }) },
  };
}

/**
 * What the attempt after a person approved the call `journal`'s attempt stopped at replays: that attempt up to the call,
 * when it can pause there, or `previous` when no call reached its tool live in it. Undefined when a call did that the
 * next attempt would run again: then it must not run.
 */
export function retrySourceOf(
  status: CodeCallRunStatus,
  journal: RunJournal,
  previous?: RunReplaySource,
): { source?: RunReplaySource } | undefined {
  const pending = pendingCallOf(status, journal);
  if (pending) return { source: resumeSourceOf(journal, pending, previous) };
  const { replay } = journal;
  const ranLive = journal.entriesSoFar().some((entry) => !replay?.replays(entry.position - 1) && reachedTool(entry));
  return ranLive ? undefined : { source: previous };
}

/**
 * The record of a run that stopped before a call that did not run, saved `paused` so `codecall:resume` can run it
 * again from its journal: undefined when it cannot pause, or its lifetime is over. It keeps the results and reads of
 * the calls before the paused one, which no other record keeps.
 */
export function pausedRunOf(
  run: CodeCallRunInput,
  answer: CodeCallRunStatus,
  journal: RunJournal,
  script: { script: string; allowedTools?: string[] },
  limits: CodeCallRunsOptions['pause'],
  previous?: RunReplaySource,
  now = Date.now(),
): PausedRun | undefined {
  const pending = pendingCallOf(answer, journal);
  if (!pending) return undefined;
  const expiresAt = Math.min(
    now + limits.waitSeconds * 1000,
    Date.parse(run.startedAt) + limits.lifetimeSeconds * 1000,
  );
  if (!(expiresAt > now)) return undefined;
  const { journal: entries, clock, random, outputs, pending: resumed } = resumeSourceOf(journal, pending, previous);
  const pause: CodeCallRunPause = {
    id: randomUUID(),
    call: resumed.call,
    answer,
    expiresAt: new Date(expiresAt).toISOString(),
    script: script.script,
    ...(script.allowedTools && { allowedTools: script.allowedTools }),
    ...(resumed.arguments && { arguments: resumed.arguments }),
    ...(needsReplayedCalls(journal, pending) && { needsReplayedCalls: true }),
  };
  return {
    run: { ...run, status: 'paused', journal: [...entries], clock, random, outputs, pause },
    ttlSeconds: Math.ceil((expiresAt - now) / 1000),
  };
}

/** Whether replaying the run up to its last recorded call needs a runtime that judges replayed calls by their times. */
function needsReplayedCalls(journal: RunJournal, pending: CodeCallJournalEntry): boolean {
  const { lastIndex, prefix } = replayExtentOf(journal, pending);
  return journal.replay?.needsCallTimes(lastIndex, prefix) === true;
}

/** What the agent is told about a paused run. */
export function pausedAnswerOf(pause: CodeCallRunPause): CodeCallPausedAnswer {
  return { call: { position: pause.call.position, tool: pause.call.tool }, expiresAt: pause.expiresAt };
}
