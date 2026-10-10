/**
 * Storage-backed TaskStore implementation.
 *
 * Uses `@frontmcp/utils` storage abstractions (memory / Redis / Upstash) with
 * automatic TTL, key namespacing, and pub/sub for cross-node signalling.
 *
 * Key layout (under the store's NamespacedStorage):
 *  - `records:{sessionId}:{taskId}` — the TaskRecord JSON
 *  - `slots:{sessionId}:{n}` — the taskId holding the owner's concurrency slot `n`; expires with its record
 *  - Pub/sub channels:
 *      - `terminal:{taskId}` — fires when a task reaches terminal status
 *      - `cancel:{taskId}`   — fires when a task is asked to cancel
 *
 * @module task/store/storage-task.store
 */

import {
  base64urlDecode,
  base64urlEncode,
  expiresAtToTTL,
  TypedStorage,
  type NamespacedStorage,
  type Unsubscribe,
} from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { isAlive } from '../helpers/process-liveness';
import { isTerminal, type TaskRecord } from '../task.types';
import type { TaskCancelCallback, TaskListPage, TaskStore, TaskTerminalCallback, TaskUnsubscribe } from './task.store';

const TERMINAL_CHANNEL_PREFIX = 'terminal:';
const CANCEL_CHANNEL_PREFIX = 'cancel:';
const RECORDS_NAMESPACE = 'records';
const SLOTS_NAMESPACE = 'slots';

const DEFAULT_PAGE_SIZE = 50;

function recordKey(sessionId: string, taskId: string): string {
  return `${sessionId}:${taskId}`;
}

function slotKey(sessionId: string, slot: number): string {
  return `${sessionId}:${slot}`;
}

export class StorageTaskStore implements TaskStore {
  private readonly storage: NamespacedStorage;
  private readonly records: TypedStorage<TaskRecord>;
  private readonly slots: NamespacedStorage;
  private readonly logger?: FrontMcpLogger;

  private readonly terminalCallbacks = new Map<string, Set<TaskTerminalCallback>>();
  private readonly terminalSubs = new Map<string, Unsubscribe>();
  private readonly cancelCallbacks = new Map<string, Set<TaskCancelCallback>>();
  private readonly cancelSubs = new Map<string, Unsubscribe>();

  constructor(storage: NamespacedStorage, logger?: FrontMcpLogger) {
    this.storage = storage;
    this.logger = logger;
    this.records = new TypedStorage(storage.namespace(RECORDS_NAMESPACE));
    this.slots = storage.namespace(SLOTS_NAMESPACE);
  }

  async create(record: TaskRecord): Promise<void> {
    const ttlSeconds = expiresAtToTTL(record.expiresAt);
    if (ttlSeconds <= 0) {
      this.logger?.warn('[StorageTaskStore] create: record already expired, skipping', {
        taskId: record.taskId,
      });
      return;
    }
    const key = recordKey(record.sessionId, record.taskId);
    await this.records.set(key, record, { ttlSeconds });
    this.logger?.debug('[StorageTaskStore] created', { taskId: record.taskId, ttlSeconds });
  }

  /** A task holds one of its owner's `maxActive` slot keys, claimed by a write-if-absent, until it finishes. */
  async createWithinLimit(record: TaskRecord, maxActive: number): Promise<boolean> {
    const ttlSeconds = expiresAtToTTL(record.expiresAt);
    if (ttlSeconds <= 0) {
      await this.create(record);
      return true;
    }
    const slot = await this.acquireSlot(record, maxActive, ttlSeconds);
    if (slot === undefined) return false;
    const slotted: TaskRecord = { ...record, concurrencySlot: slot };
    try {
      await this.create(slotted);
    } catch (err) {
      await this.releaseSlot(slotted);
      throw err;
    }
    return true;
  }

  async get(taskId: string, sessionId: string): Promise<TaskRecord | null> {
    const record = await this.records.get(recordKey(sessionId, taskId));
    if (!record) return null;
    // Hard session binding: even if key lookup succeeded (shouldn't, since we
    // scope by sessionId), verify the record's own sessionId.
    if (record.sessionId !== sessionId) return null;
    if (record.expiresAt && Date.now() > record.expiresAt) {
      await this.delete(taskId, sessionId);
      return null;
    }
    return record;
  }

  async update(taskId: string, sessionId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const existing = await this.get(taskId, sessionId);
    if (!existing) return null;
    const merged: TaskRecord = {
      ...existing,
      ...patch,
      // Identity fields are never overwritten via patch.
      taskId: existing.taskId,
      sessionId: existing.sessionId,
      createdAt: existing.createdAt,
      lastUpdatedAt: new Date().toISOString(),
    };
    const ttlSeconds = expiresAtToTTL(merged.expiresAt);
    if (ttlSeconds <= 0) {
      await this.delete(taskId, sessionId);
      return null;
    }
    await this.records.set(recordKey(sessionId, taskId), merged, { ttlSeconds });
    if (isTerminal(merged.status)) await this.releaseSlot(merged);
    return merged;
  }

  async delete(taskId: string, sessionId: string): Promise<void> {
    const existing = await this.records.get(recordKey(sessionId, taskId));
    await this.records.delete(recordKey(sessionId, taskId));
    if (existing) await this.releaseSlot(existing);
  }

  private async acquireSlot(record: TaskRecord, maxActive: number, ttlSeconds: number): Promise<number | undefined> {
    const owner = record.sessionId;
    const slotKeys = Array.from({ length: maxActive }, (_, slot) => slotKey(owner, slot));
    const holders = await this.slots.mget(slotKeys);
    const claimed = await this.claimFreeSlot(owner, holders, record.taskId, ttlSeconds);
    if (claimed !== undefined || !(await this.reclaimSlots(owner, holders))) return claimed;
    return this.claimFreeSlot(owner, await this.slots.mget(slotKeys), record.taskId, ttlSeconds);
  }

  private async claimFreeSlot(
    owner: string,
    holders: ReadonlyArray<string | null>,
    taskId: string,
    ttlSeconds: number,
  ): Promise<number | undefined> {
    for (const [slot, holder] of holders.entries()) {
      if (holder !== null) continue;
      const key = slotKey(owner, slot);
      await this.slots.set(key, taskId, { ttlSeconds, ifNotExists: true });
      if ((await this.slots.get(key)) === taskId) return slot;
    }
    return undefined;
  }

  /** Free slots held by finished tasks or by tasks whose CLI worker died (marked failed); others are left alone. */
  private async reclaimSlots(owner: string, holders: ReadonlyArray<string | null>): Promise<boolean> {
    let reclaimed = false;
    for (const holderTaskId of holders) {
      if (holderTaskId === null) continue;
      const holder = await this.records.get(recordKey(owner, holderTaskId));
      if (!holder) continue;
      if (isTerminal(holder.status)) {
        await this.releaseSlot(holder);
        reclaimed = true;
        continue;
      }
      const workerPid = holder.executor?.host === 'cli' ? holder.executor.pid : undefined;
      if (workerPid === undefined || isAlive(workerPid)) continue;
      const failed = await this.update(holderTaskId, owner, {
        status: 'failed',
        statusMessage: 'Task runner exited before completing the task',
      });
      if (failed) await this.publishTerminal(failed);
      reclaimed = true;
    }
    return reclaimed;
  }

  /** Best-effort: a slot left behind is reclaimed the next time its owner reaches the cap. */
  private async releaseSlot(record: TaskRecord): Promise<void> {
    if (record.concurrencySlot === undefined) return;
    try {
      await this.slots.deleteIfEquals(slotKey(record.sessionId, record.concurrencySlot), record.taskId);
    } catch (err) {
      this.logger?.warn('[StorageTaskStore] failed to release a concurrency slot', {
        taskId: record.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async list(sessionId: string, opts: { cursor?: string; pageSize?: number } = {}): Promise<TaskListPage> {
    const pageSize = Math.max(1, Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, 500));

    // TypedStorage wraps a namespaced store; `.keys()` on the adapter returns
    // the namespaced keys with the `records:` prefix already present. We scan
    // for keys starting with `{sessionId}:` and return stable-sorted page.
    const namespaced = this.storage.namespace(RECORDS_NAMESPACE);
    const allKeys = await namespaced.keys();
    const sessionPrefix = `${sessionId}:`;
    const matching = allKeys
      .filter((k) => k.startsWith(sessionPrefix))
      .map((k) => k.slice(sessionPrefix.length))
      .sort();

    const offset = opts.cursor ? decodeCursor(opts.cursor) : 0;
    const slice = matching.slice(offset, offset + pageSize);
    const records: TaskRecord[] = [];
    for (const taskId of slice) {
      const rec = await this.get(taskId, sessionId);
      if (rec) records.push(rec);
    }

    const nextOffset = offset + slice.length;
    const page: TaskListPage = { tasks: records };
    if (nextOffset < matching.length) {
      page.nextCursor = encodeCursor(nextOffset);
    }
    return page;
  }

  async subscribeTerminal(taskId: string, _sessionId: string, cb: TaskTerminalCallback): Promise<TaskUnsubscribe> {
    const channel = TERMINAL_CHANNEL_PREFIX + taskId;
    let set = this.terminalCallbacks.get(taskId);
    if (!set) {
      set = new Set();
      this.terminalCallbacks.set(taskId, set);
    }
    set.add(cb);

    if (!this.terminalSubs.has(taskId) && this.storage.supportsPubSub()) {
      const unsubscribe = await this.storage.subscribe(channel, (message) => {
        try {
          const record = JSON.parse(message) as TaskRecord;
          const subs = this.terminalCallbacks.get(taskId);
          if (subs) {
            for (const fn of subs) {
              try {
                fn(record);
              } catch (err) {
                this.logger?.error('[StorageTaskStore] terminal callback threw', {
                  taskId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        } catch (err) {
          this.logger?.error('[StorageTaskStore] failed to parse terminal message', {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      this.terminalSubs.set(taskId, unsubscribe);
    }

    const callbackSet = set;
    return async () => {
      callbackSet.delete(cb);
      if (callbackSet.size === 0) {
        this.terminalCallbacks.delete(taskId);
        const unsubscribe = this.terminalSubs.get(taskId);
        if (unsubscribe) {
          this.terminalSubs.delete(taskId);
          try {
            await unsubscribe();
          } catch {
            // best effort
          }
        }
      }
    };
  }

  async publishTerminal(record: TaskRecord): Promise<void> {
    const channel = TERMINAL_CHANNEL_PREFIX + record.taskId;
    const fanOutLocal = () => {
      const subs = this.terminalCallbacks.get(record.taskId);
      if (!subs) return;
      for (const cb of subs) {
        try {
          cb(record);
        } catch {
          // best effort — one failing subscriber mustn't starve the others
        }
      }
    };
    if (this.storage.supportsPubSub()) {
      try {
        await this.storage.publish(channel, JSON.stringify(record));
      } catch (err) {
        this.logger?.error('[StorageTaskStore] failed to publish terminal; falling back to local callbacks', {
          taskId: record.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Same-process waiters must still be unblocked even if pub/sub fails.
        fanOutLocal();
      }
    } else {
      fanOutLocal();
    }
  }

  async subscribeCancel(taskId: string, _sessionId: string, cb: TaskCancelCallback): Promise<TaskUnsubscribe> {
    const channel = CANCEL_CHANNEL_PREFIX + taskId;
    let set = this.cancelCallbacks.get(taskId);
    if (!set) {
      set = new Set();
      this.cancelCallbacks.set(taskId, set);
    }
    set.add(cb);

    if (!this.cancelSubs.has(taskId) && this.storage.supportsPubSub()) {
      const unsubscribe = await this.storage.subscribe(channel, () => {
        const subs = this.cancelCallbacks.get(taskId);
        if (subs) {
          for (const fn of subs) {
            try {
              fn();
            } catch {
              // best effort
            }
          }
        }
      });
      this.cancelSubs.set(taskId, unsubscribe);
    }

    const callbackSet = set;
    return async () => {
      callbackSet.delete(cb);
      if (callbackSet.size === 0) {
        this.cancelCallbacks.delete(taskId);
        const unsubscribe = this.cancelSubs.get(taskId);
        if (unsubscribe) {
          this.cancelSubs.delete(taskId);
          try {
            await unsubscribe();
          } catch {
            // best effort
          }
        }
      }
    };
  }

  async publishCancel(taskId: string, _sessionId: string): Promise<void> {
    const channel = CANCEL_CHANNEL_PREFIX + taskId;
    const fanOutLocal = () => {
      const subs = this.cancelCallbacks.get(taskId);
      if (!subs) return;
      for (const fn of subs) {
        try {
          fn();
        } catch {
          // best effort
        }
      }
    };
    if (this.storage.supportsPubSub()) {
      try {
        await this.storage.publish(channel, '1');
      } catch (err) {
        this.logger?.error('[StorageTaskStore] failed to publish cancel; falling back to local callbacks', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Same-process cancel subscribers still need to fire when pub/sub fails.
        fanOutLocal();
        return;
      }
    } else {
      const subs = this.cancelCallbacks.get(taskId);
      if (subs) {
        for (const fn of subs) {
          try {
            fn();
          } catch {
            // best effort
          }
        }
      }
    }
  }

  async destroy(): Promise<void> {
    for (const unsubscribe of this.terminalSubs.values()) {
      try {
        await unsubscribe();
      } catch {
        // best effort
      }
    }
    for (const unsubscribe of this.cancelSubs.values()) {
      try {
        await unsubscribe();
      } catch {
        // best effort
      }
    }
    this.terminalSubs.clear();
    this.cancelSubs.clear();
    this.terminalCallbacks.clear();
    this.cancelCallbacks.clear();
  }
}

// Cursor encoding uses cross-platform base64url so the task store works under
// Node, browser, Deno, Bun, and edge runtimes (Buffer is not available everywhere).
function encodeCursor(offset: number): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify({ offset })));
}

function decodeCursor(cursor: string): number {
  try {
    const bytes = base64urlDecode(cursor);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed?.offset === 'number' && parsed.offset >= 0 && Number.isInteger(parsed.offset)) {
      return parsed.offset;
    }
  } catch {
    // fall through
  }
  return 0;
}
