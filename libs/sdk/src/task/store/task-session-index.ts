// file: libs/sdk/src/task/store/task-session-index.ts
import { expiresAtToTTL, randomUUID, type NamespacedStorage, type TypedStorage } from '@frontmcp/utils';

import { type TaskRecord } from '../task.types';

/** How much longer a position outlives its task, so a list can tell a task gone for good from one being written. */
const POSITION_GRACE_SECONDS = 3600;
/** How long one request holds a session's backfill, renewed as it goes; a request that dies holding it frees it then. */
const BACKFILL_CLAIM_TTL_SECONDS = 60;
/** How long a numbered position takes at most to be written: an empty one numbered before that is never written. */
const POSITION_WRITE_SECONDS = 60;
/** Keys read in one `mget`, so a session with many tasks never sends one oversized command. */
const READ_BATCH_SIZE = 500;
const BACKFILLED = 'done';

function sessionTaskKey(sessionId: string, suffix: string | number): string {
  return `${sessionId}:${suffix}`;
}

async function mgetInBatches<T>(read: (keys: string[]) => Promise<T[]>, keys: readonly string[]): Promise<T[]> {
  const values: T[] = [];
  for (let start = 0; start < keys.length; start += READ_BATCH_SIZE) {
    values.push(...(await read(keys.slice(start, start + READ_BATCH_SIZE))));
  }
  return values;
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
 * the id of the `n`th task (kept an hour past it), `index-of:{session}:{taskId}` its number (gone with the task, so a
 * position whose task has none is gone for good), `index-count:{session}` the numbers used, `index-start:{session}`
 * the leading numbers whose tasks are gone, `index-skip:{session}:{n}` the last of the numbers after `n` whose tasks
 * are gone, `index-settled:{session}` a number every position up to which had been
 * written by a time (`{number}:{epoch ms}`), and `index-ready:{session}` that the session's earlier tasks were indexed.
 */
export class TaskSessionIndex {
  private readonly positions: NamespacedStorage;
  private readonly positionOf: NamespacedStorage;
  private readonly counts: NamespacedStorage;
  private readonly starts: NamespacedStorage;
  private readonly skips: NamespacedStorage;
  private readonly settled: NamespacedStorage;
  private readonly readiness: NamespacedStorage;
  /** The longest a task lives, plus the grace: the count outlives every position it numbered. */
  private readonly countTtlSeconds: number;

  constructor(
    storage: NamespacedStorage,
    private readonly source: TaskSessionIndexSource,
    maxTaskTtlSeconds: number,
  ) {
    this.positions = storage.namespace('index');
    this.positionOf = storage.namespace('index-of');
    this.counts = storage.namespace('index-count');
    this.starts = storage.namespace('index-start');
    this.skips = storage.namespace('index-skip');
    this.settled = storage.namespace('index-settled');
    this.readiness = storage.namespace('index-ready');
    this.countTtlSeconds = Math.ceil(maxTaskTtlSeconds) + POSITION_GRACE_SECONDS;
  }

  /** Give a task written now the session's next number; the session's earlier tasks are indexed when it is listed. */
  async add(record: TaskRecord, ttlSeconds: number): Promise<void> {
    const position = await this.counts.incr(record.sessionId);
    await this.keepCountAlive(record.sessionId, Math.max(this.countTtlSeconds, ttlSeconds + POSITION_GRACE_SECONDS));
    await this.number(record, position, ttlSeconds);
  }

  /**
   * Keep a task's index entry as long as its record lives, `ttlSeconds` from now, never shortening it, so the same
   * call can be repeated after one that failed halfway.
   */
  async extend(record: TaskRecord, ttlSeconds: number): Promise<void> {
    const { sessionId, taskId } = record;
    const position = await this.positionOf.get(sessionTaskKey(sessionId, taskId));
    if (position === null) return;
    await this.positionOf.extendTtl(sessionTaskKey(sessionId, taskId), ttlSeconds);
    await this.positions.extendTtl(sessionTaskKey(sessionId, position), ttlSeconds + POSITION_GRACE_SECONDS);
    await this.keepCountAlive(sessionId, ttlSeconds + POSITION_GRACE_SECONDS);
  }

  /** Keep the session's count at least `ttlSeconds` longer, never shorter: it outlives every position it numbered. */
  private async keepCountAlive(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.counts.extendTtl(sessionId, ttlSeconds);
  }

  /** Mark a deleted task gone for good, so a first page may start after its position. */
  async remove(record: TaskRecord): Promise<void> {
    await this.positionOf.delete(sessionTaskKey(record.sessionId, record.taskId));
  }

  /**
   * The live tasks of a page from `startPosition` on (after the leading gone ones for a first page). Only a first page
   * waits for the session's earlier tasks to be indexed; a continuation reads the positions its first page numbered.
   */
  async page(sessionId: string, startPosition: number, pageSize: number): Promise<TaskIndexPage> {
    if (startPosition === 0 && !(await this.ensureBackfilled(sessionId))) return undefined;
    const positionsUsed = Number((await this.counts.get(sessionId)) ?? 0);
    const writtenUpTo = await this.writtenUpTo(sessionId, positionsUsed);
    const tasks: TaskRecord[] = [];
    const listedTaskIds = new Set<string>();
    // A run of positions gone for good after the head or a live task is remembered, and later lists jump it
    let anchor = startPosition;
    let skippedTo = await this.skippedTo(sessionId, anchor);
    let goneUpTo = skippedTo;
    let runOpen = true;
    let position = skippedTo;
    while (tasks.length < pageSize && position < positionsUsed) {
      const batchEnd = Math.min(positionsUsed, position + pageSize - tasks.length);
      const batch = Array.from({ length: batchEnd - position }, (_, offset) => position + offset + 1);
      const taskIds = await this.positions.mget(batch.map((indexed) => sessionTaskKey(sessionId, indexed)));
      position = batchEnd;
      for (const [offset, taskId] of taskIds.entries()) {
        const at = batch[offset];
        const record = taskId === null ? null : await this.source.readTask(taskId, sessionId);
        if (record === null || listedTaskIds.has(record.taskId)) {
          const gone = record === null && (await this.isGoneForGood(sessionId, taskId, at, writtenUpTo));
          runOpen = runOpen && gone;
          if (runOpen) goneUpTo = at;
          continue;
        }
        if (goneUpTo > skippedTo) await this.rememberSkip(sessionId, anchor, goneUpTo);
        listedTaskIds.add(record.taskId);
        tasks.push(record);
        anchor = at;
        skippedTo = await this.skippedTo(sessionId, at);
        goneUpTo = skippedTo;
        runOpen = true;
        if (skippedTo > at && tasks.length < pageSize) {
          position = Math.min(skippedTo, positionsUsed);
          break;
        }
      }
    }
    if (goneUpTo > skippedTo) await this.rememberSkip(sessionId, anchor, goneUpTo);
    return { tasks, endPosition: position, positionsUsed };
  }

  /** Where a list goes on after `anchor`: past the run of positions gone for good it remembered there, if any. */
  private async skippedTo(sessionId: string, anchor: number): Promise<number> {
    const stored =
      anchor === 0 ? await this.starts.get(sessionId) : await this.skips.get(sessionTaskKey(sessionId, anchor));
    return Math.max(anchor, Number(stored ?? 0));
  }

  /** The positions after `anchor` up to `goneUpTo` hold tasks gone for good: a list jumps them from now on. */
  private async rememberSkip(sessionId: string, anchor: number, goneUpTo: number): Promise<void> {
    const remaining = await this.counts.ttl(sessionId);
    if (remaining === null || remaining <= 0) return;
    if (anchor === 0) {
      await this.starts.set(sessionId, String(goneUpTo), { ttlSeconds: remaining });
    } else {
      await this.skips.set(sessionTaskKey(sessionId, anchor), String(goneUpTo), { ttlSeconds: remaining });
    }
  }

  /**
   * A position whose task has no `index-of` key was deleted or expired. An empty one is a write in progress, unless it
   * was numbered before `writtenUpTo` was settled: its key then expired, or the request numbering it died.
   */
  private async isGoneForGood(
    sessionId: string,
    taskId: string | null,
    position: number,
    writtenUpTo: number,
  ): Promise<boolean> {
    if (taskId === null) return position <= writtenUpTo;
    return !(await this.positionOf.exists(sessionTaskKey(sessionId, taskId)));
  }

  /**
   * The last position every write had finished by: the count a list saw at least {@link POSITION_WRITE_SECONDS} ago.
   * A first page notes the count it sees when the noted one is that old, so an expired prefix is skipped from then on.
   */
  private async writtenUpTo(sessionId: string, positionsUsed: number): Promise<number> {
    const [notedPosition, notedAt] = ((await this.settled.get(sessionId)) ?? '0:0').split(':').map(Number);
    const settledFor = (Date.now() - notedAt) / 1000;
    if (settledFor < POSITION_WRITE_SECONDS) return 0;
    const remaining = await this.counts.ttl(sessionId);
    if (remaining !== null && remaining > 0 && positionsUsed > notedPosition) {
      await this.settled.set(sessionId, `${positionsUsed}:${Date.now()}`, { ttlSeconds: remaining });
    }
    return notedPosition;
  }

  /** Record the task's number: its `index-of` key first, so a position a list can see always has one while it lives. */
  private async number(record: TaskRecord, position: number, ttlSeconds: number): Promise<void> {
    const { sessionId, taskId } = record;
    await this.positionOf.set(sessionTaskKey(sessionId, taskId), String(position), { ttlSeconds });
    await this.positions.set(sessionTaskKey(sessionId, position), taskId, {
      ttlSeconds: ttlSeconds + POSITION_GRACE_SECONDS,
    });
  }

  /**
   * Index the session's tasks no number lists yet, written before the store kept an index, once: one request claims it,
   * numbers what is missing and marks the session ready. False while another request does.
   */
  private async ensureBackfilled(sessionId: string): Promise<boolean> {
    const state = await this.readiness.get(sessionId);
    if (state === BACKFILLED) return true;
    if (state !== null) return false;
    const claim = `running:${randomUUID()}`;
    await this.readiness.set(sessionId, claim, { ifNotExists: true, ttlSeconds: BACKFILL_CLAIM_TTL_SECONDS });
    if ((await this.readiness.get(sessionId)) !== claim) return false;
    await this.backfill(sessionId, () => this.renewClaim(sessionId, claim));
    await this.readiness.set(sessionId, BACKFILLED, { ttlSeconds: this.countTtlSeconds });
    return true;
  }

  /** Hold the backfill claim for another {@link BACKFILL_CLAIM_TTL_SECONDS} while it is still this request's. */
  private async renewClaim(sessionId: string, claim: string): Promise<void> {
    if ((await this.readiness.get(sessionId)) === claim) {
      await this.readiness.expire(sessionId, BACKFILL_CLAIM_TTL_SECONDS);
    }
  }

  /**
   * Number the session's live tasks that no position lists: those with no `index-of` key, or one whose position does
   * not hold the task (a request that died between the two). The records are scanned before those are read, and the
   * claim is renewed between batches.
   */
  private async backfill(sessionId: string, renewClaim: () => Promise<void>): Promise<void> {
    const { records, recordKey, scanSessionTaskIds } = this.source;
    const taskIds = await scanSessionTaskIds(sessionId);
    await renewClaim();
    const stored = await mgetInBatches(
      (keys) => records.mget(keys),
      taskIds.map((taskId) => recordKey(sessionId, taskId)),
    );
    const live = stored.filter(
      (record): record is TaskRecord =>
        record !== null && record.sessionId === sessionId && expiresAtToTTL(record.expiresAt) > 0,
    );
    const numbered = await mgetInBatches(
      (keys) => this.positionOf.mget(keys),
      live.map((record) => sessionTaskKey(sessionId, record.taskId)),
    );
    const listedAt = await mgetInBatches(
      (keys) => this.positions.mget(keys),
      numbered.map((position) => sessionTaskKey(sessionId, position ?? 0)),
    );
    const missing = live.filter((record, index) => numbered[index] === null || listedAt[index] !== record.taskId);
    await renewClaim();
    const lastPosition = await this.counts.incrBy(sessionId, missing.length);
    // An earlier task can live longer than tasks.maxTtlMs allows now: the count outlives its position too
    const longestTtl = Math.max(0, ...missing.map((record) => expiresAtToTTL(record.expiresAt)));
    await this.keepCountAlive(sessionId, Math.max(this.countTtlSeconds, longestTtl + POSITION_GRACE_SECONDS));
    const firstPosition = lastPosition - missing.length + 1;
    for (const [offset, record] of missing.entries()) {
      // A task that expired since it was read keeps its number unused; an empty position is skipped
      const ttlSeconds = expiresAtToTTL(record.expiresAt);
      if (ttlSeconds > 0) await this.numberAsItIsNow(record, firstPosition + offset, ttlSeconds);
      if ((offset + 1) % READ_BATCH_SIZE === 0) await renewClaim();
    }
  }

  /**
   * Number an earlier task, then read it again: an update that moved its expiry later before its `index-of` key existed
   * found nothing to extend, so the position takes the record's expiry as it is now.
   */
  private async numberAsItIsNow(record: TaskRecord, position: number, ttlSeconds: number): Promise<void> {
    await this.number(record, position, ttlSeconds);
    const current = await this.source.readTask(record.taskId, record.sessionId);
    const currentTtl = current ? expiresAtToTTL(current.expiresAt) : 0;
    if (current && currentTtl > ttlSeconds) await this.extend(current, currentTtl);
  }
}
