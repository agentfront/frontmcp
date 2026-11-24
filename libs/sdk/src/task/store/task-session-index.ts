// file: libs/sdk/src/task/store/task-session-index.ts
import { expiresAtToTTL, randomUUID, type NamespacedStorage, type TypedStorage } from '@frontmcp/utils';

import { TASK_DEFAULTS, type TaskRecord } from '../task.types';

/** How long the backfill marker of a session that has no task is kept, so its next lists do not scan again. */
const EMPTY_INDEX_TTL_SECONDS = TASK_DEFAULTS.defaultTtlMs / 1000;
/** How long one request holds a session's backfill; a request that dies holding it frees it then. */
const BACKFILL_CLAIM_TTL_SECONDS = 60;
const BACKFILLED = 'done';

function sessionTaskKey(sessionId: string, suffix: string | number): string {
  return `${sessionId}:${suffix}`;
}

/** What the index reads from the task store: a session's stored task ids by scan, its records, and one live task. */
export interface TaskSessionIndexSource {
  records: TypedStorage<TaskRecord>;
  recordKey(sessionId: string, taskId: string): string;
  scanSessionTaskIds(sessionId: string): Promise<string[]>;
  readTask(taskId: string, sessionId: string): Promise<TaskRecord | null>;
}

/** One page of the index, or none while another request backfills the session (the caller then scans). */
export type TaskIndexPage = { tasks: TaskRecord[]; endPosition: number; positionsUsed: number } | undefined;

/**
 * Each session's tasks numbered in the order they were written, beside the task records: `index:{session}:{n}` holds
 * the id of the `n`th task and `index-of:{session}:{taskId}` its number, both expiring with the task;
 * `index-count:{session}` counts the numbers used, `index-start:{session}` the leading ones whose tasks are gone, and
 * `index-ready:{session}` says the session's earlier tasks were indexed.
 */
export class TaskSessionIndex {
  private readonly positions: NamespacedStorage;
  private readonly positionOf: NamespacedStorage;
  private readonly counts: NamespacedStorage;
  private readonly starts: NamespacedStorage;
  private readonly readiness: NamespacedStorage;

  constructor(
    storage: NamespacedStorage,
    private readonly source: TaskSessionIndexSource,
  ) {
    this.positions = storage.namespace('index');
    this.positionOf = storage.namespace('index-of');
    this.counts = storage.namespace('index-count');
    this.starts = storage.namespace('index-start');
    this.readiness = storage.namespace('index-ready');
  }

  /** Give a task written now the session's next number; the session's earlier tasks are indexed when it is listed. */
  async add(record: TaskRecord, ttlSeconds: number): Promise<void> {
    const { sessionId, taskId } = record;
    const position = await this.counts.incr(sessionId);
    await this.positions.set(sessionTaskKey(sessionId, position), taskId, { ttlSeconds });
    await this.positionOf.set(sessionTaskKey(sessionId, taskId), String(position), { ttlSeconds });
    await this.keepCountFor(sessionId, ttlSeconds);
  }

  /** Keep a task's index entry as long as its record, whose expiry an update moved later. */
  async extend(record: TaskRecord, ttlSeconds: number): Promise<void> {
    const { sessionId, taskId } = record;
    const position = await this.positionOf.get(sessionTaskKey(sessionId, taskId));
    if (position === null) return;
    await this.positions.expire(sessionTaskKey(sessionId, position), ttlSeconds);
    await this.positionOf.expire(sessionTaskKey(sessionId, taskId), ttlSeconds);
    await this.keepCountFor(sessionId, ttlSeconds);
  }

  /** The live tasks of a page from `startPosition` on (from the first live one for a first page), skipping tasks gone. */
  async page(sessionId: string, startPosition: number, pageSize: number): Promise<TaskIndexPage> {
    if (!(await this.ensureBackfilled(sessionId))) return undefined;
    const positionsUsed = Number((await this.counts.get(sessionId)) ?? 0);
    const firstPage = startPosition === 0;
    const leadingGone = firstPage ? Number((await this.starts.get(sessionId)) ?? 0) : 0;
    let position = Math.max(startPosition, leadingGone);
    let lastLeadingGone = position;
    const tasks: TaskRecord[] = [];
    const listedTaskIds = new Set<string>();
    while (tasks.length < pageSize && position < positionsUsed) {
      const batchEnd = Math.min(positionsUsed, position + pageSize - tasks.length);
      const batch = Array.from({ length: batchEnd - position }, (_, offset) => position + offset + 1);
      const taskIds = await this.positions.mget(batch.map((indexed) => sessionTaskKey(sessionId, indexed)));
      for (const [offset, taskId] of taskIds.entries()) {
        const record = taskId === null ? null : await this.source.readTask(taskId, sessionId);
        if (record === null && tasks.length === 0) lastLeadingGone = batch[offset];
        if (record === null || listedTaskIds.has(record.taskId)) continue;
        listedTaskIds.add(record.taskId);
        tasks.push(record);
      }
      position = batchEnd;
    }
    if (firstPage && lastLeadingGone > leadingGone) await this.rememberLeadingGone(sessionId, lastLeadingGone);
    return { tasks, endPosition: position, positionsUsed };
  }

  /**
   * Index the session's tasks no number lists yet, written before the store kept an index, once: one request claims it,
   * scans the task keys and numbers what is missing, then marks the session ready. False while another request does.
   */
  private async ensureBackfilled(sessionId: string): Promise<boolean> {
    const state = await this.readiness.get(sessionId);
    if (state === BACKFILLED) return true;
    if (state !== null) return false;
    const claim = `running:${randomUUID()}`;
    await this.readiness.set(sessionId, claim, { ifNotExists: true, ttlSeconds: BACKFILL_CLAIM_TTL_SECONDS });
    if ((await this.readiness.get(sessionId)) !== claim) return false;
    const longestTtl = await this.backfill(sessionId);
    await this.readiness.set(sessionId, BACKFILLED, { ttlSeconds: longestTtl });
    return true;
  }

  /** Number the session's live tasks no position holds; the records are scanned before the positions are read. */
  private async backfill(sessionId: string): Promise<number> {
    const { records, recordKey, scanSessionTaskIds } = this.source;
    const taskIds = await scanSessionTaskIds(sessionId);
    const stored = await records.mget(taskIds.map((taskId) => recordKey(sessionId, taskId)));
    const live = stored.filter(
      (record): record is TaskRecord =>
        record !== null && record.sessionId === sessionId && expiresAtToTTL(record.expiresAt) > 0,
    );
    const positionsUsed = Number((await this.counts.get(sessionId)) ?? 0);
    const usedPositions = Array.from({ length: positionsUsed }, (_, offset) => sessionTaskKey(sessionId, offset + 1));
    const indexed = new Set(positionsUsed > 0 ? await this.positions.mget(usedPositions) : []);
    const missing = live.filter((record) => !indexed.has(record.taskId));
    const lastPosition = await this.counts.incrBy(sessionId, missing.length);
    const firstPosition = lastPosition - missing.length + 1;
    await Promise.all(
      missing.map(async (record, offset) => {
        const ttlSeconds = expiresAtToTTL(record.expiresAt);
        const position = firstPosition + offset;
        await this.positions.set(sessionTaskKey(sessionId, position), record.taskId, { ttlSeconds });
        await this.positionOf.set(sessionTaskKey(sessionId, record.taskId), String(position), { ttlSeconds });
      }),
    );
    const longestTtl = Math.max(EMPTY_INDEX_TTL_SECONDS, ...live.map((record) => expiresAtToTTL(record.expiresAt)));
    await this.keepCountFor(sessionId, longestTtl);
    return longestTtl;
  }

  /** The positions up to `position` hold tasks gone for good: a first page starts after them from now on. */
  private async rememberLeadingGone(sessionId: string, position: number): Promise<void> {
    const remaining = await this.counts.ttl(sessionId);
    if (remaining === null || remaining <= 0) return;
    await this.starts.set(sessionId, String(position), { ttlSeconds: remaining });
  }

  /** Keep the session's count at least `ttlSeconds` longer, so it outlives every position it numbered. */
  private async keepCountFor(sessionId: string, ttlSeconds: number): Promise<void> {
    const remaining = await this.counts.ttl(sessionId);
    if (remaining === null || remaining < ttlSeconds) await this.counts.expire(sessionId, ttlSeconds);
  }
}
