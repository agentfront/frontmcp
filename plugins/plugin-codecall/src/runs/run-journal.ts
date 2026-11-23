import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import { TOOL_CALL_ERROR_CODES } from '../errors';
import { toPlainJson } from '../utils/plain-json';
import type { CodeCallCallPhase, CodeCallJournalEntry } from './run-record.types';

const PHASE_BY_ERROR_CODE: Partial<Record<string, CodeCallCallPhase>> = {
  [TOOL_CALL_ERROR_CODES.SELF_REFERENCE]: 'access',
  [TOOL_CALL_ERROR_CODES.ACCESS_DENIED]: 'access',
  [TOOL_CALL_ERROR_CODES.NOT_FOUND]: 'access',
  [TOOL_CALL_ERROR_CODES.VALIDATION]: 'input',
  [TOOL_CALL_ERROR_CODES.RATE_LIMITED]: 'limit',
  [TOOL_CALL_ERROR_CODES.RESULT_TOO_LARGE]: 'limit',
};

/** The longest tool name a journal entry keeps: a script can pass any string as one. */
const MAX_TOOL_NAME_CHARS = 128;

const encoder = new TextEncoder();

/** The size of a value: UTF-8 bytes of its JSON. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? '').byteLength;
}

/** SHA-256 (hex) of the arguments' canonical JSON. */
export function argumentsHashOf(args: unknown): string {
  try {
    return sha256Hex(canonicalJson(args ?? null));
  } catch {
    return sha256Hex(JSON.stringify(args) ?? '');
  }
}

/** The phase of a failed call, from the code of the error CodeCall's tool handler threw. */
function phaseOf(error: unknown): CodeCallCallPhase {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return (typeof code === 'string' ? PHASE_BY_ERROR_CODE[code] : undefined) ?? 'execute';
}

/** How a call recorded by {@link RunJournal.begin} ends. */
export interface RunJournalCall {
  succeed(result: unknown): void;
  fail(error: unknown): void;
}

/** A call's arguments and result, kept in memory only for `trace.values`. */
export interface RunCallValues {
  arguments: unknown;
  result?: unknown;
}

/** Told when a call starts and when it ends, with its values when they are kept. */
export interface RunJournalObserver {
  callStarted(entry: CodeCallJournalEntry): void;
  callEnded(entry: CodeCallJournalEntry, values?: RunCallValues): void;
}

export interface RunJournalOptions {
  /** Keep each call's result in its entry (`runs.resume`). */
  keepResults?: boolean;
  /** Keep each call's arguments and result beside its entry, never in it (`trace.values`). */
  keepValues?: boolean;
  observer?: RunJournalObserver;
}

/** The journal of one run: an entry per tool call, in the order the host's tool handler was entered. */
export class RunJournal {
  private readonly entries: CodeCallJournalEntry[] = [];
  private readonly unsettledStartTimes = new Map<CodeCallJournalEntry, number>();
  private readonly values = new Map<CodeCallJournalEntry, RunCallValues>();
  private closed = false;

  constructor(private readonly options: RunJournalOptions = {}) {}

  /** Records a call as the tool handler is entered. */
  begin(tool: string, args: unknown): RunJournalCall {
    const entry: CodeCallJournalEntry = {
      position: this.entries.length + 1,
      tool: String(tool).slice(0, MAX_TOOL_NAME_CHARS),
      argumentsHash: argumentsHashOf(args),
      outcome: 'unfinished',
      durationMs: 0,
    };
    this.entries.push(entry);
    this.unsettledStartTimes.set(entry, Date.now());
    if (this.options.keepValues) this.values.set(entry, { arguments: args });
    this.options.observer?.callStarted(entry);
    return {
      succeed: (result) => {
        if (!this.settle(entry)) return;
        const snapshot = toPlainJson(result);
        entry.outcome = 'success';
        entry.resultBytes = jsonBytes(snapshot);
        if (this.options.keepResults) entry.result = snapshot;
        const values = this.values.get(entry);
        if (values) values.result = snapshot;
        this.ended(entry);
      },
      fail: (error) => {
        if (!this.settle(entry)) return;
        entry.outcome = 'failure';
        entry.phase = phaseOf(error);
        this.ended(entry);
      },
    };
  }

  /** The arguments and result of a call, when `keepValues` is on. */
  valuesOf(entry: CodeCallJournalEntry): RunCallValues | undefined {
    return this.values.get(entry);
  }

  /** Ends the journal: a call still running stays `unfinished`, and nothing changes an entry after. */
  close(): readonly CodeCallJournalEntry[] {
    for (const entry of [...this.unsettledStartTimes.keys()]) {
      this.settle(entry);
      this.ended(entry);
    }
    this.closed = true;
    return this.entries;
  }

  private ended(entry: CodeCallJournalEntry): void {
    this.options.observer?.callEnded(entry, this.values.get(entry));
  }

  private settle(entry: CodeCallJournalEntry): boolean {
    const startedAt = this.unsettledStartTimes.get(entry);
    if (this.closed || startedAt === undefined) return false;
    entry.durationMs = Date.now() - startedAt;
    this.unsettledStartTimes.delete(entry);
    return true;
  }
}
