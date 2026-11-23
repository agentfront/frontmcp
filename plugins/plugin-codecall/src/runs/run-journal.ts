import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import { TOOL_CALL_ERROR_CODES } from '../errors';
import type { CodeCallCallPhase, CodeCallJournalEntry } from './run-record.types';

const PHASE_BY_ERROR_CODE: Partial<Record<string, CodeCallCallPhase>> = {
  [TOOL_CALL_ERROR_CODES.SELF_REFERENCE]: 'access',
  [TOOL_CALL_ERROR_CODES.ACCESS_DENIED]: 'access',
  [TOOL_CALL_ERROR_CODES.NOT_FOUND]: 'access',
  [TOOL_CALL_ERROR_CODES.VALIDATION]: 'input',
  [TOOL_CALL_ERROR_CODES.RATE_LIMITED]: 'limit',
};

/** The longest tool name a journal entry keeps: a script can pass any string as one. */
const MAX_TOOL_NAME_CHARS = 128;

const encoder = new TextEncoder();

/** The size of a value: UTF-8 bytes of its JSON. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? '').byteLength;
}

function argumentsHashOf(args: unknown): string {
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

export interface RunJournalOptions {
  /** Keep each call's result in its entry (`runs.resume`). */
  keepResults?: boolean;
}

/** The journal of one run: an entry per tool call, in the order the host's tool handler was entered. */
export class RunJournal {
  private readonly entries: CodeCallJournalEntry[] = [];
  private readonly unsettledStartTimes = new Map<CodeCallJournalEntry, number>();
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
    return {
      succeed: (result) => {
        if (!this.settle(entry)) return;
        entry.outcome = 'success';
        entry.resultBytes = jsonBytes(result);
        if (this.options.keepResults) entry.result = result;
      },
      fail: (error) => {
        if (!this.settle(entry)) return;
        entry.outcome = 'failure';
        entry.phase = phaseOf(error);
      },
    };
  }

  /** Ends the journal: a call still running stays `unfinished`, and nothing changes an entry after. */
  close(): readonly CodeCallJournalEntry[] {
    for (const entry of [...this.unsettledStartTimes.keys()]) this.settle(entry);
    this.closed = true;
    return this.entries;
  }

  private settle(entry: CodeCallJournalEntry): boolean {
    const startedAt = this.unsettledStartTimes.get(entry);
    if (this.closed || startedAt === undefined) return false;
    entry.durationMs = Date.now() - startedAt;
    this.unsettledStartTimes.delete(entry);
    return true;
  }
}
