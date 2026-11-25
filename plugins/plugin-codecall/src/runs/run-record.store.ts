import { resultOwnerOf, type ResultHandleStore, type ResultOwner } from '@frontmcp/plugin-result-handles';
import type { OnShutdown } from '@frontmcp/sdk';
import { canonicalJson, randomUUID, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import { jsonBytes } from './run-journal';
import type { CodeCallJournalEntry, CodeCallRunPause, CodeCallRunRecord } from './run-record.types';

/** The tool context a run ran in, which names its owner. */
export type CodeCallRunCaller = Parameters<typeof resultOwnerOf>[0];

/** A run record before the store gives it an owner, and an id unless the run has one already. */
export type CodeCallRunInput = Omit<CodeCallRunRecord, 'runId' | 'owner' | 'omittedEntries'> & { runId?: string };

export interface CodeCallRunStoreOptions {
  maxRecordBytes: number;
  /** Whether journal entries keep each call's result (`runs.resume`). */
  resume: boolean;
  /** Where resumes claim a paused run, on the records' storage: a claim is set only where none is. */
  claims?: NamespacedStorage;
}

/** The record of a run that is paused and can be resumed. */
export type CodeCallPausedRunRecord = CodeCallRunRecord & { pause: CodeCallRunPause };

/** The storage key of the claim on one pause of a run, which says nothing about the run or its owner. */
function claimKeyOf(runId: string, owner: ResultOwner, pauseId: string): string {
  return sha256Hex(canonicalJson(['codecall-run-claim', runId, owner.session ?? null, owner.caller ?? null, pauseId]));
}

function hasOwner(owner: ResultOwner): boolean {
  return owner.session !== undefined || owner.caller !== undefined;
}

/** `record` with as many of its first journal entries as fit in `maxBytes`, counting the ones left out. */
function fittedRecord(record: CodeCallRunRecord, maxBytes: number): CodeCallRunRecord {
  const { journal } = record;
  let bytes = jsonBytes({ ...record, journal: [], omittedEntries: journal.length });
  if (bytes > maxBytes) {
    throw new RangeError(`The run record's metadata takes ${bytes} bytes, over runs.maxRecordBytes (${maxBytes})`);
  }
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

  /** Whether the caller's runs are kept with their calls' results, which needs `runs.resume` and an owner. */
  keepsResultsOf(caller: CodeCallRunCaller): boolean {
    return this.options.resume && hasOwner(resultOwnerOf(caller));
  }

  /** Whether `run` fits in `runs.maxRecordBytes` with every journal entry, as a paused run must. */
  fitsWhole(caller: CodeCallRunCaller, run: CodeCallRunInput): boolean {
    const record = { runId: run.runId ?? this.handles.newHandle(), owner: resultOwnerOf(caller), ...run };
    return jsonBytes(record) <= this.options.maxRecordBytes;
  }

  /**
   * Claims one pause of a run for the caller, once: the first claim wins, on this instance or another one sharing the
   * storage, and every later one is refused. A storage that cannot set a key only where none is cannot claim, and fails.
   */
  async claim(runId: string, caller: CodeCallRunCaller, pauseId: string, ttlSeconds: number): Promise<boolean> {
    const { claims } = this.options;
    if (!claims) return false;
    const key = claimKeyOf(runId, resultOwnerOf(caller), pauseId);
    const token = randomUUID();
    await claims.set(key, token, { ifNotExists: true, ttlSeconds });
    return (await claims.get(key)) === token;
  }

  /** Whether a resume claimed this pause of the run. */
  async isClaimed(runId: string, caller: CodeCallRunCaller, pauseId: string): Promise<boolean> {
    return (await this.options.claims?.exists(claimKeyOf(runId, resultOwnerOf(caller), pauseId))) === true;
  }

  /**
   * Keeps `run` for the caller, for `ttlSeconds` (`runs.ttlSeconds` by default), and returns its id; none without an
   * owner, and a RangeError for metadata over the limit.
   */
  async keep(
    caller: CodeCallRunCaller,
    { runId = this.handles.newHandle(), ...run }: CodeCallRunInput,
    ttlSeconds?: number,
  ): Promise<string | undefined> {
    const owner = resultOwnerOf(caller);
    if (!hasOwner(owner)) return undefined;
    const record = fittedRecord({ runId, owner, ...run }, this.options.maxRecordBytes);
    await this.handles.save(runId, record, owner, ttlSeconds);
    return runId;
  }

  /** The record of `runId`, or undefined when it expired, never existed, or the caller is not its owner. */
  async read(runId: string, caller: CodeCallRunCaller): Promise<CodeCallRunRecord | undefined> {
    const stored = await this.handles.read(runId, resultOwnerOf(caller));
    return stored?.value as CodeCallRunRecord | undefined;
  }

  /**
   * The paused run `runId` of the caller; undefined when it expired, never existed, is not the caller's, is no longer
   * paused, or its script is not the one its record names.
   */
  async readPaused(
    runId: string,
    caller: CodeCallRunCaller,
    now = Date.now(),
  ): Promise<CodeCallPausedRunRecord | undefined> {
    const record = await this.read(runId, caller);
    const pause = record?.status === 'paused' ? record.pause : undefined;
    if (!record || !pause || !(Date.parse(pause.expiresAt) > now)) return undefined;
    return sha256Hex(pause.script) === record.scriptHash ? { ...record, pause } : undefined;
  }

  async onShutdown(): Promise<void> {
    await this.handles.onShutdown();
  }
}
