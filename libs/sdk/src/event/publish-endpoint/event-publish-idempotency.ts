import { randomUUID, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import { type EventPublishResult } from '../../common';

/** How long the answer to a published `eventId` is kept, in seconds: a repeat within it is answered, not published. */
export const PUBLISH_IDEMPOTENCY_WINDOW_SECONDS = 600;

/** How long a publish may take before a repeat of its `eventId` is let through, in seconds. */
export const PUBLISH_CLAIM_SECONDS = 60;

const RECORD_PREFIX = 'published:';

/** What a request that names an `eventId` should do: publish it, answer what an earlier one got, or wait. */
export type EventPublishClaim =
  | { state: 'claimed' }
  | { state: 'published'; result: EventPublishResult }
  | { state: 'in-flight' };

interface PendingRecord {
  pending: string;
}

/** Whether a stored record is the claim of a publish that has not answered yet. */
function isPending(record: PendingRecord | EventPublishResult): record is PendingRecord {
  return 'pending' in record;
}

/**
 * The answers to the events published over HTTP with an `eventId`, kept in the events storage for
 * {@link PUBLISH_IDEMPOTENCY_WINDOW_SECONDS}: every process of the server sees them when the storage is shared.
 */
export class EventPublishIdempotency {
  /** Takes the events storage the claims and answers are kept in. */
  constructor(private readonly storage: NamespacedStorage) {}

  /** Claim an `eventId` of an event for this request, or learn what became of the request that claimed it. */
  async claim(eventName: string, eventId: string): Promise<EventPublishClaim> {
    const key = this.keyOf(eventName, eventId);
    const token = randomUUID();
    await this.storage.set(key, JSON.stringify({ pending: token }), {
      ttlSeconds: PUBLISH_CLAIM_SECONDS,
      ifNotExists: true,
    });
    const stored = await this.storage.get(key);
    if (stored === null) return { state: 'in-flight' };
    const record = JSON.parse(stored) as PendingRecord | EventPublishResult;
    if (!isPending(record)) return { state: 'published', result: record };
    return { state: record.pending === token ? 'claimed' : 'in-flight' };
  }

  /** Keep the answer of a claimed publish for the window. */
  async complete(eventName: string, eventId: string, result: EventPublishResult): Promise<void> {
    await this.storage.set(this.keyOf(eventName, eventId), JSON.stringify(result), {
      ttlSeconds: PUBLISH_IDEMPOTENCY_WINDOW_SECONDS,
    });
  }

  /** Give a claim back after its publish failed, so the sender's retry publishes. */
  async release(eventName: string, eventId: string): Promise<void> {
    await this.storage.delete(this.keyOf(eventName, eventId));
  }

  /** The storage key of one `eventId` of one event; hashed, so no id can shape a key. */
  private keyOf(eventName: string, eventId: string): string {
    return RECORD_PREFIX + sha256Hex(JSON.stringify([eventName, eventId])).slice(0, 40);
  }
}
