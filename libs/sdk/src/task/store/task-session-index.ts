// file: libs/sdk/src/task/store/task-session-index.ts
import { expiresAtToTTL, type NamespacedStorage, type TypedStorage } from '@frontmcp/utils';

import { TASK_DEFAULTS, type TaskRecord } from '../task.types';

const INDEX_NAMESPACE = 'index';
const INDEX_COUNT_NAMESPACE = 'index-count';
/** How long the index of a session that has no task is kept, so its next lists do not scan for its tasks again. */
const EMPTY_INDEX_TTL_SECONDS = TASK_DEFAULTS.defaultTtlMs / 1000;

function indexKey(sessionId: string, position: number): string {
  return `${sessionId}:${position}`;
}

/** What the index reads from the task store: a session's stored task ids by scan, its records, and one live task. */
export interface TaskSessionIndexSource {
  records: TypedStorage<TaskRecord>;
  recordKey(sessionId: string, taskId: string): string;
  scanSessionTaskIds(sessionId: string): Promise<string[]>;
  readTask(taskId: string, sessionId: string): Promise<TaskRecord | null>;
}

/**
 * Each session's tasks numbered in the order they were created, beside the task records: `index:{sessionId}:{n}` holds
 * the id of the `n`th task and expires with it, `index-count:{sessionId}` the positions used, kept as long as the
 * session's longest-lived task.
 */
export class TaskSessionIndex {
  private readonly index: NamespacedStorage;
  private readonly counts: NamespacedStorage;

  constructor(
    storage: NamespacedStorage,
    private readonly source: TaskSessionIndexSource,
  ) {
    this.index = storage.namespace(INDEX_NAMESPACE);
    this.counts = storage.namespace(INDEX_COUNT_NAMESPACE);
  }

  /** Give the task the session's next position, after indexing the tasks it had before it had an index. */
  async add(record: TaskRecord, ttlSeconds: number): Promise<void> {
    const { sessionId } = record;
    if (!(await this.counts.exists(sessionId))) await this.backfill(sessionId);
    const position = await this.counts.incr(sessionId);
    await this.index.set(indexKey(sessionId, position), record.taskId, { ttlSeconds });
    await this.keepFor(sessionId, ttlSeconds);
  }

  /** The live tasks of a page from `position` on, skipping the positions of tasks gone, and the position it ended at. */
  async page(
    sessionId: string,
    startPosition: number,
    pageSize: number,
  ): Promise<{ tasks: TaskRecord[]; endPosition: number; positionsUsed: number }> {
    if (!(await this.counts.exists(sessionId))) await this.backfill(sessionId);
    const positionsUsed = Number((await this.counts.get(sessionId)) ?? 0);
    let position = startPosition;
    const tasks: TaskRecord[] = [];
    const listedTaskIds = new Set<string>();
    while (tasks.length < pageSize && position < positionsUsed) {
      const batchEnd = Math.min(positionsUsed, position + pageSize - tasks.length);
      const positions = Array.from({ length: batchEnd - position }, (_, offset) => position + offset + 1);
      const taskIds = await this.index.mget(positions.map((indexed) => indexKey(sessionId, indexed)));
      position = batchEnd;
      for (const taskId of taskIds) {
        if (taskId === null || listedTaskIds.has(taskId)) continue;
        listedTaskIds.add(taskId);
        const record = await this.source.readTask(taskId, sessionId);
        if (record) tasks.push(record);
      }
    }
    return { tasks, endPosition: position, positionsUsed };
  }

  /**
   * Index the tasks a session has that no index lists, written before the store kept one: a scan of every task key,
   * once per session. Racing backfills index a task twice; a page shows it once.
   */
  private async backfill(sessionId: string): Promise<void> {
    const { records, recordKey, scanSessionTaskIds } = this.source;
    const taskIds = await scanSessionTaskIds(sessionId);
    const stored = await records.mget(taskIds.map((taskId) => recordKey(sessionId, taskId)));
    const live = stored.filter(
      (record): record is TaskRecord =>
        record !== null && record.sessionId === sessionId && expiresAtToTTL(record.expiresAt) > 0,
    );
    const lastPosition = await this.counts.incrBy(sessionId, live.length);
    const firstPosition = lastPosition - live.length + 1;
    await Promise.all(
      live.map((record, offset) =>
        this.index.set(indexKey(sessionId, firstPosition + offset), record.taskId, {
          ttlSeconds: expiresAtToTTL(record.expiresAt),
        }),
      ),
    );
    const longestTtl = Math.max(EMPTY_INDEX_TTL_SECONDS, ...live.map((record) => expiresAtToTTL(record.expiresAt)));
    await this.keepFor(sessionId, longestTtl);
  }

  /** Keep the session's count at least `ttlSeconds` longer, so it outlives every position it numbered. */
  private async keepFor(sessionId: string, ttlSeconds: number): Promise<void> {
    const remaining = await this.counts.ttl(sessionId);
    if (remaining === null || remaining < ttlSeconds) await this.counts.expire(sessionId, ttlSeconds);
  }
}
