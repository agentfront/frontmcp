import { randomUUID } from '@frontmcp/utils';

import type { CodeCallRunsOptions } from '../codecall.types';
import type { RunJournal } from './run-journal';
import type { CodeCallRunInput } from './run-record.store';
import type { CodeCallJournalEntry, CodeCallRunPause, CodeCallRunStatus } from './run-record.types';

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

/** Whether a recorded call can be answered again on replay: its result, the error the script got, or its refusal. */
function isReplayable(entry: CodeCallJournalEntry): boolean {
  return entry.outcome === 'success' || entry.error !== undefined || entry.decision !== undefined;
}

/**
 * The call a run stopped before, when the run can pause there: a call-phase decision (`needs_approval`, or an uncaught
 * `needs_changes` or `denied`) refused it, or the call flow refused its input, uncaught; it is the run's last call; and
 * every call before it is recorded and settled. Nothing the tool or its error says decides it.
 */
export function pendingCallOf(status: CodeCallRunStatus, journal: RunJournal): CodeCallJournalEntry | undefined {
  const { replay } = journal;
  const entries = journal.entriesSoFar();
  const last = entries.at(-1);
  if (!replay?.recordsReads || !last) return undefined;
  const refused = DECISION_STATUSES.has(status) && last.decision?.decision === status;
  const inputRefused = status === 'tool_error' && replay.refusedInputAt(last.position - 1);
  if (!refused && !inputRefused) return undefined;
  const settled = entries.every(
    (entry, index) => entry.position === index + 1 && (entry === last || isReplayable(entry)),
  );
  return settled ? last : undefined;
}

/**
 * The record of a run that stopped before a call that did not run, saved `paused` so `codecall:resume` can run it
 * again from its journal: undefined when it cannot pause, or its lifetime is over.
 */
export function pausedRunOf(
  run: CodeCallRunInput,
  answer: CodeCallRunStatus,
  journal: RunJournal,
  script: { script: string; allowedTools?: string[] },
  limits: CodeCallRunsOptions['pause'],
  now = Date.now(),
): PausedRun | undefined {
  const pending = pendingCallOf(answer, journal);
  if (!pending || !journal.replay) return undefined;
  const expiresAt = Math.min(
    now + limits.waitSeconds * 1000,
    Date.parse(run.startedAt) + limits.lifetimeSeconds * 1000,
  );
  if (!(expiresAt > now)) return undefined;
  const pause: CodeCallRunPause = {
    id: randomUUID(),
    call: { position: pending.position, tool: pending.tool, argumentsHash: pending.argumentsHash },
    answer,
    expiresAt: new Date(expiresAt).toISOString(),
    script: script.script,
    ...(script.allowedTools && { allowedTools: script.allowedTools }),
  };
  return {
    run: {
      ...run,
      status: 'paused',
      journal: run.journal.filter((entry) => entry.position < pending.position),
      ...journal.replay.readsBefore(pending.position - 1),
      pause,
    },
    ttlSeconds: Math.ceil((expiresAt - now) / 1000),
  };
}

/** What the agent is told about a paused run. */
export function pausedAnswerOf(pause: CodeCallRunPause): CodeCallPausedAnswer {
  return { call: { position: pause.call.position, tool: pause.call.tool }, expiresAt: pause.expiresAt };
}
