import type { ReviewDecision } from '@enclave-vm/core/worker';

import type { ResultOwner } from '@frontmcp/plugin-result-handles';
import type { Reference } from '@frontmcp/sdk';

import type { CodeCallExecuteResult } from '../tools/execute.schema';
import type { CodeCallRunStore } from './run-record.store';

/** How a run ended: the `status` of its `codecall:execute` result. */
export type CodeCallRunStatus = CodeCallExecuteResult['status'];

/**
 * A run record's status: how the run ended, or `paused` before a call that did not run, `resuming` once a resume
 * claimed it, or `cancelled` while paused.
 */
export type CodeCallRunRecordStatus = CodeCallRunStatus | 'paused' | 'resuming' | 'cancelled';

/** How a tool call ended; `unfinished` when the run ended while the call was still running. */
export type CodeCallCallOutcome = 'success' | 'failure' | 'unfinished';

/**
 * Where a failed call failed: `access` (policy or not found), `input`, `limit` (rate or quota), `execute` (the tool),
 * or `review` (a call-phase decision of the review or a budget, before the call reached the tool handler).
 */
export type CodeCallCallPhase = 'access' | 'input' | 'limit' | 'execute' | 'review';

/** A call-phase decision that refused a call: the review's, or a budget's, in the review's shape. */
export type CodeCallCallDecision = Exclude<ReviewDecision, { decision: 'allow' }>;

/** A call CodeCall answers itself under a reserved name: `keep(name, value)` or `recall(name)`, never a tool call. */
export type CodeCallKeptValueCallKind = 'keep' | 'recall';

/** A failed call's error as the script got it, kept to replay the call. */
export interface CodeCallScriptError {
  name?: string;
  code?: string;
  message: string;
}

/** One tool call of a run. */
export interface CodeCallJournalEntry {
  /** The call's place in the run, from 1: the order in which calls reached the host (Enclave's `callIndex` + 1). */
  position: number;
  tool: string;
  /** Set for `keep` and `recall`, which are not tool calls: no tool runs, and no budget counts them. */
  kind?: CodeCallKeptValueCallKind;
  /** The name a `keep` kept or a `recall` read. */
  name?: string;
  /** SHA-256 (hex) of the arguments' canonical JSON. */
  argumentsHash: string;
  outcome: CodeCallCallOutcome;
  /** Set for a failed call. */
  phase?: CodeCallCallPhase;
  durationMs: number;
  /** UTF-8 bytes of the result's JSON, for a call that succeeded. */
  resultBytes?: number;
  /** The result itself, kept only in the record of a run that can be replayed. */
  result?: unknown;
  /** The error the script got for a failed call, kept only in the record of a run that can be replayed. */
  error?: CodeCallScriptError;
  /** The call-phase decision that refused the call (`phase: 'review'`), only with `runs.resume`. */
  decision?: CodeCallCallDecision;
  /** When the call reached the host, in ms after the run started, on its timeline without pauses: in a paused record. */
  arrivedAtMs?: number;
}

/** The call a paused run stopped before: it did not reach its tool. */
export interface CodeCallPendingCall {
  position: number;
  tool: string;
  /** SHA-256 (hex) of the arguments the script passed. */
  argumentsHash: string;
  /** When the call first reached the host, in ms after the run started, on its timeline without pauses. */
  arrivedAtMs?: number;
}

/** What a paused run keeps to be resumed. */
export interface CodeCallRunPause {
  /** A random id of this pause: a resume claims it once. */
  id: string;
  call: CodeCallPendingCall;
  /** The status the run answered when it paused (`needs_approval`, `tool_error`, ...). */
  answer: CodeCallRunStatus;
  /** ISO 8601: when the paused run stops waiting and is forgotten. */
  expiresAt: string;
  /** The script, run again to resume; its SHA-256 is the record's `scriptHash`. */
  script: string;
  /** The script's own `allowedTools`, which narrow the resumed run too. */
  allowedTools?: string[];
}

/** What one `codecall:execute` did, kept for its owner until `runs.ttlSeconds` runs out. */
export interface CodeCallRunRecord {
  runId: string;
  /** Who may read it: the session and the authenticated caller it ran for, as result handles bind theirs. */
  owner: ResultOwner;
  /** SHA-256 (hex) of the script. */
  scriptHash: string;
  status: CodeCallRunRecordStatus;
  /** ISO 8601: when the run first started; a resumed run keeps it. */
  startedAt: string;
  /** ISO 8601. */
  endedAt: string;
  /** The review stage's decision; `null` while no review stage runs. */
  reviewDecision: string | null;
  /** UTF-8 bytes of the return value's JSON, for a run that returned. */
  resultBytes?: number;
  journal: CodeCallJournalEntry[];
  /** Journal entries left out because the record reached `runs.maxRecordBytes`. */
  omittedEntries?: number;
  /** What the script's `Date` read, in order, kept only in the record of a run that can be replayed. */
  clock?: number[];
  /** What the script's `Math.random()` returned, in order, kept only in the record of a run that can be replayed. */
  random?: number[];
  /** How many lines of output (console, `mcpLog`, `mcpNotify`) the script wrote, which a replay does not write again. */
  outputs?: number;
  /** Set while the run is `paused`: the journal holds the calls before `pause.call`. */
  pause?: CodeCallRunPause;
}

/** The store of run records: `this.get(CodeCallRunStoreToken)`, registered while `runs.enabled` is true. */
export const CodeCallRunStoreToken = Symbol('plugin:codecall:runs') as Reference<CodeCallRunStore>;
