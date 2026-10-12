/**
 * Distributed Semaphore
 *
 * Provides concurrency control using the StorageAdapter interface.
 * Each concurrent execution holds one of `maxConcurrent` slot keys, claimed
 * with a conditional set and a TTL. The holder renews the TTL until it releases
 * the slot, so the TTL only frees the slots of holders that died.
 */

import { randomUUID, StorageNotSupportedError, type StorageAdapter } from '@frontmcp/utils';

import { GuardStorageUnsupportedError, QueueTimeoutError } from '../errors';
import type { SemaphoreTicket } from './types';

const DEFAULT_TICKET_TTL_SECONDS = 300;
const MIN_POLL_INTERVAL_MS = 100;
const MAX_POLL_INTERVAL_MS = 1000;
/** A held slot's TTL is renewed this many times per TTL, so one missed renewal doesn't free it. */
const RENEWALS_PER_TTL = 3;
const PROBE_KEY = '__frontmcp_semaphore_probe__';

export class DistributedSemaphore {
  private atomicSlotsVerified = false;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly ticketTtlSeconds: number = DEFAULT_TICKET_TTL_SECONDS,
  ) {}

  /**
   * Attempt to acquire a concurrency slot.
   *
   * @returns A SemaphoreTicket if acquired, or null if rejected
   * @throws QueueTimeoutError if queued and timeout expires
   */
  async acquire(
    key: string,
    maxConcurrent: number,
    queueTimeoutMs: number,
    entityName: string,
  ): Promise<SemaphoreTicket | null> {
    await this.verifyAtomicSlots();
    const ticket = await this.tryAcquire(key, maxConcurrent);
    if (ticket) return ticket;

    if (queueTimeoutMs <= 0) return null;

    return this.waitForSlot(key, maxConcurrent, queueTimeoutMs, entityName);
  }

  private async tryAcquire(key: string, maxConcurrent: number): Promise<SemaphoreTicket | null> {
    const slotKeys = Array.from({ length: maxConcurrent }, (_, slot) => `${key}:slot:${slot}`);
    const holders = await this.storage.mget(slotKeys);
    const ticketId = randomUUID();

    for (const [slot, slotKey] of slotKeys.entries()) {
      if (holders[slot] !== null) continue;
      await this.storage.set(slotKey, ticketId, { ttlSeconds: this.ticketTtlSeconds, ifNotExists: true });
      if ((await this.storage.get(slotKey)) !== ticketId) continue;
      return this.holdSlot(key, slotKey, ticketId);
    }

    return null;
  }

  /**
   * Checks once that the storage can compare-and-delete and compare-and-expire atomically, which releasing and
   * renewing a slot need. Without them a late release or renewal could free or extend another ticket's slot.
   *
   * @throws GuardStorageUnsupportedError when it can't
   */
  async verifyAtomicSlots(): Promise<void> {
    if (this.atomicSlotsVerified) return;
    try {
      await this.compareAndDelete(PROBE_KEY, '');
      await this.compareAndExpire(PROBE_KEY, '');
    } catch (error) {
      if (error instanceof StorageNotSupportedError) throw new GuardStorageUnsupportedError(error);
      throw error;
    }
    this.atomicSlotsVerified = true;
  }

  /** Renews the slot's TTL until it is released, or until the slot turns out to hold another ticket. */
  private holdSlot(key: string, slotKey: string, ticketId: string): SemaphoreTicket {
    const renew = async () => {
      try {
        if (!(await this.compareAndExpire(slotKey, ticketId))) clearInterval(heartbeat);
      } catch {
        // A storage error skips this renewal; the next one runs before the TTL can run out.
      }
    };
    const heartbeat = setInterval(() => void renew(), (this.ticketTtlSeconds * 1000) / RENEWALS_PER_TTL);
    heartbeat.unref?.();
    return {
      ticket: ticketId,
      release: () => {
        clearInterval(heartbeat);
        return this.release(key, slotKey, ticketId);
      },
    };
  }

  private compareAndDelete(slotKey: string, ticketId: string): Promise<boolean> {
    if (!this.storage.deleteIfEquals) throw new StorageNotSupportedError('deleteIfEquals', 'this storage adapter');
    return this.storage.deleteIfEquals(slotKey, ticketId);
  }

  private compareAndExpire(slotKey: string, ticketId: string): Promise<boolean> {
    if (!this.storage.expireIfEquals) throw new StorageNotSupportedError('expireIfEquals', 'this storage adapter');
    return this.storage.expireIfEquals(slotKey, ticketId, this.ticketTtlSeconds);
  }

  private async release(key: string, slotKey: string, ticketId: string): Promise<void> {
    // A slot whose ticket expired may hold another ticket by now; only free it while it is still ours.
    await this.compareAndDelete(slotKey, ticketId);

    if (this.storage.supportsPubSub()) {
      try {
        await this.storage.publish(`${key}:released`, ticketId);
      } catch {
        // pub/sub failure is non-fatal
      }
    }
  }

  private async waitForSlot(
    key: string,
    maxConcurrent: number,
    queueTimeoutMs: number,
    entityName: string,
  ): Promise<SemaphoreTicket> {
    const deadline = Date.now() + queueTimeoutMs;
    let pollInterval = MIN_POLL_INTERVAL_MS;
    let unsubscribe: (() => Promise<void>) | undefined;

    let notified = false;
    if (this.storage.supportsPubSub()) {
      try {
        unsubscribe = await this.storage.subscribe(`${key}:released`, () => {
          notified = true;
        });
      } catch {
        // fall back to polling
      }
    }

    try {
      while (Date.now() < deadline) {
        const ticket = await this.tryAcquire(key, maxConcurrent);
        if (ticket) return ticket;

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;

        const waitMs = Math.min(pollInterval, remainingMs);

        if (notified) {
          notified = false;
          continue;
        }

        await sleep(waitMs);
        pollInterval = Math.min(pollInterval * 2, MAX_POLL_INTERVAL_MS);
      }
    } finally {
      if (unsubscribe) {
        try {
          await unsubscribe();
        } catch {
          // cleanup failure is non-fatal
        }
      }
    }

    throw new QueueTimeoutError(entityName, queueTimeoutMs);
  }

  async getActiveCount(key: string): Promise<number> {
    return (await this.heldSlotKeys(key)).length;
  }

  async forceReset(key: string): Promise<void> {
    const slotKeys = await this.heldSlotKeys(key);
    if (slotKeys.length > 0) {
      await this.storage.mdelete(slotKeys);
    }
  }

  /** `<key>:slot:<n>` only: the pattern also matches the slots of a key such as `<key>:slot:0`. */
  private async heldSlotKeys(key: string): Promise<string[]> {
    const prefix = `${key}:slot:`;
    const matches = await this.storage.keys(`${prefix}*`);
    return matches.filter((slotKey) => slotKey.startsWith(prefix) && /^\d+$/.test(slotKey.slice(prefix.length)));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
