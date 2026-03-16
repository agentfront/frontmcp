/**
 * Distributed Semaphore
 *
 * Provides concurrency control using the StorageAdapter interface.
 * Each concurrent execution acquires a "ticket" stored in the backend.
 * Active tickets tracked via atomic counter + individual ticket keys with TTL.
 */

import { randomUUID } from '@frontmcp/utils';
import type { StorageAdapter } from '@frontmcp/utils';
import type { SemaphoreTicket } from './types';
import { QueueTimeoutError } from '../errors';

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
    const countKey = `${key}:count`;
    const newCount = await this.storage.incr(countKey);

    if (newCount <= maxConcurrent) {
      const ticketId = randomUUID();
      const ticketKey = `${key}:ticket:${ticketId}`;

      await this.storage.set(ticketKey, String(Date.now()), {
        ttlSeconds: this.ticketTtlSeconds,
      });

      return {
        ticket: ticketId,
        release: () => this.release(key, ticketId),
      };
    }

    await this.storage.decr(countKey);
    return null;
  }

  private async release(key: string, ticketId: string): Promise<void> {
    const countKey = `${key}:count`;
    const ticketKey = `${key}:ticket:${ticketId}`;

    await this.storage.delete(ticketKey);
    const newCount = await this.storage.decr(countKey);

    if (newCount < 0) {
      await this.storage.set(countKey, '0');
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
    const countKey = `${key}:count`;
    const raw = await this.storage.get(countKey);
    return Math.max(0, parseInt(raw ?? '0', 10) || 0);
  }

  async forceReset(key: string): Promise<void> {
    const countKey = `${key}:count`;
    await this.storage.delete(countKey);
    const ticketKeys = await this.storage.keys(`${key}:ticket:*`);
    if (ticketKeys.length > 0) {
      await this.storage.mdelete(ticketKeys);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
