import type { ResultOwner } from '@frontmcp/plugin-result-handles';
import type { Reference } from '@frontmcp/sdk';

import type { CodeCallExecuteResult } from '../tools/execute.schema';
import type { CodeCallRunStore } from './run-record.store';

/** How a run ended: the `status` of its `codecall:execute` result. */
export type CodeCallRunStatus = CodeCallExecuteResult['status'];

/** How a tool call ended; `unfinished` when the run ended while the call was still running. */
export type CodeCallCallOutcome = 'success' | 'failure' | 'unfinished';

/** Where a failed call failed: `access` (policy or not found), `input`, `limit` (rate or quota) or `execute` (the tool). */
export type CodeCallCallPhase = 'access' | 'input' | 'limit' | 'execute';

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
  /** The call's place in the run, from 1: the order in which the host's tool handler was entered. */
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
}

/** What one `codecall:execute` did, kept for its owner until `runs.ttlSeconds` runs out. */
export interface CodeCallRunRecord {
  runId: string;
  /** Who may read it: the session and the authenticated caller it ran for, as result handles bind theirs. */
  owner: ResultOwner;
  /** SHA-256 (hex) of the script. */
  scriptHash: string;
  status: CodeCallRunStatus;
  /** ISO 8601. */
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
}

/** The store of run records: `this.get(CodeCallRunStoreToken)`, registered while `runs.enabled` is true. */
export const CodeCallRunStoreToken = Symbol('plugin:codecall:runs') as Reference<CodeCallRunStore>;
