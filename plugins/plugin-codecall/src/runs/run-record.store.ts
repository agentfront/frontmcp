import { resultOwnerOf, type ResultHandleStore } from '@frontmcp/plugin-result-handles';
import type { OnShutdown } from '@frontmcp/sdk';

import { jsonBytes } from './run-journal';
import type { CodeCallJournalEntry, CodeCallRunRecord } from './run-record.types';

/** The tool context a run ran in, which names its owner. */
export type CodeCallRunCaller = Parameters<typeof resultOwnerOf>[0];

/** A run record before the store gives it an id and an owner. */
export type CodeCallRunInput = Omit<CodeCallRunRecord, 'runId' | 'owner' | 'omittedEntries'>;

export interface CodeCallRunStoreOptions {
  maxRecordBytes: number;
  /** Whether journal entries keep each call's result (`runs.resume`). */
  resume: boolean;
}

/** `record` with as many of its first journal entries as fit in `maxBytes`, counting the ones left out. */
function fittedRecord(record: CodeCallRunRecord, maxBytes: number): CodeCallRunRecord {
  const { journal } = record;
  let bytes = jsonBytes({ ...record, journal: [], omittedEntries: journal.length });
  const kept: CodeCallJournalEntry[] = [];
  for (const entry of journal) {
    bytes += jsonBytes(entry) + 1;
    if (bytes > maxBytes) break;
    kept.push(entry);
  }
  const omittedEntries = journal.length - kept.length;
  return omittedEntries === 0 ? record : { ...record, journal: kept, omittedEntries };
}

/** Run records in a {@link ResultHandleStore}: encrypted under keys of the run id and owner, readable by that owner. */
export class CodeCallRunStore implements OnShutdown {
  constructor(
    private readonly handles: ResultHandleStore,
    private readonly options: CodeCallRunStoreOptions,
  ) {}

  get keepsResults(): boolean {
    return this.options.resume;
  }

  /** Keeps `run` for the caller and returns its run id, or keeps nothing for a caller with no session and no subject. */
  async keep(caller: CodeCallRunCaller, run: CodeCallRunInput): Promise<string | undefined> {
    const owner = resultOwnerOf(caller);
    if (owner.session === undefined && owner.caller === undefined) return undefined;
    const runId = this.handles.newHandle();
    await this.handles.save(runId, fittedRecord({ runId, owner, ...run }, this.options.maxRecordBytes), owner);
    return runId;
  }

  /** The record of `runId`, or undefined when it expired, never existed, or the caller is not its owner. */
  async read(runId: string, caller: CodeCallRunCaller): Promise<CodeCallRunRecord | undefined> {
    const stored = await this.handles.read(runId, resultOwnerOf(caller));
    return stored?.value as CodeCallRunRecord | undefined;
  }

  async onShutdown(): Promise<void> {
    await this.handles.onShutdown();
  }
}
