/**
 * Distributed Semaphore
 *
 * Provides concurrency control using the StorageAdapter interface.
 * Each concurrent execution holds one of `maxConcurrent` slot keys, claimed
 * with a conditional set and a TTL, so a slot whose ticket expires is free again.
 */

import { randomUUID, type StorageAdapter } from '@frontmcp/utils';

import { QueueTimeoutError } from '../errors';
import type { SemaphoreTicket } from './types';

const DEFAULT_TICKET_TTL_SECONDS = 300;
const MIN_POLL_INTERVAL_MS = 100;
const MAX_POLL_INTERVAL_MS = 1000;

export class DistributedSemaphore {
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
      return {
        ticket: ticketId,
        release: () => this.release(key, slotKey, ticketId),
      };
    }

    return null;
  }

  private async release(key: string, slotKey: string, ticketId: string): Promise<void> {
    // A slot that expired may hold another ticket by now; only free it while it is still ours.
    if (this.storage.deleteIfEquals) {
      await this.storage.deleteIfEquals(slotKey, ticketId);
    } else if ((await this.storage.get(slotKey)) === ticketId) {
      await this.storage.delete(slotKey);
    }

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
    return this.storage.count(`${key}:slot:*`);
  }

  async forceReset(key: string): Promise<void> {
    const slotKeys = await this.storage.keys(`${key}:slot:*`);
    if (slotKeys.length > 0) {
      await this.storage.mdelete(slotKeys);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
