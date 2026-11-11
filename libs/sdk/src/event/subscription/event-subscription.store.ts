import type { EventDeliveryErrorCategory } from '@frontmcp/protocol';
import { bytesToHex, hmacSha256, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import { type EventSubscriber } from '../../common';
import { deserializeAndDecrypt, encryptAndSerialize } from '../../elicitation/store/elicitation-encryption';
import { EventSubscriptionStoreError } from '../../errors';
import { type EventDialect } from '../event-dialect';

/** Where a webhook subscription is delivered, and the secrets its deliveries are signed with. */
export interface EventWebhookDelivery {
  mode: 'webhook';
  url: string;
  secret: string;
  /** The secret a refresh replaced: deliveries are also signed with it until `previousSecretUntil`. */
  previousSecret?: string;
  previousSecretUntil?: number;
}

export interface EventSubscriptionStatus {
  lastDeliveryAt?: number;
  lastError?: EventDeliveryErrorCategory;
  failedSince?: number;
  /** Failed delivery attempts in a row; a delivery the callback acknowledges ends the count. */
  failures?: number;
  /** When delivery was suspended. */
  suspendedSince?: number;
}

export interface EventSubscriptionRecord {
  /** `sub_` and 32 hex characters, derived from the owner, the callback, the event and its arguments. */
  id: string;
  principalKey: string;
  /** The owner as the server knew them at the last `events/subscribe`. */
  subscriber: EventSubscriber;
  eventName: string;
  arguments: Record<string, unknown>;
  /** The canonical JSON of `arguments`. */
  argumentsKey: string;
  delivery: EventWebhookDelivery;
  dialect: EventDialect;
  createdAt: number;
  updatedAt: number;
  /** When the subscription ends, in Unix milliseconds; `null` for one that never expires. */
  expiresAt: number | null;
  verifiedAt: number | null;
  lastAuthorizedAt: number;
  /** `false` while delivery is suspended; the next `events/subscribe` sets it again. */
  active: boolean;
  status: EventSubscriptionStatus;
}

/** What `update` may change; identity and lifetime change through `upsert` alone. */
export type EventSubscriptionChanges = Partial<
  Pick<EventSubscriptionRecord, 'active' | 'status' | 'verifiedAt' | 'lastAuthorizedAt' | 'subscriber' | 'delivery'>
>;

export type EventSubscriptionPatch =
  | EventSubscriptionChanges
  | ((current: EventSubscriptionRecord) => EventSubscriptionChanges);

/** Stored subscriptions, shared by every node of a server. Reads leave out a subscription whose lifetime is over. */
export interface EventSubscriptionStore {
  /** Create the subscription, or replace the one with the same id. */
  upsert(record: EventSubscriptionRecord): Promise<void>;
  get(id: string): Promise<EventSubscriptionRecord | undefined>;
  /** Remove a subscription, expired or not; resolves to it for the one caller that removed it. */
  delete(id: string): Promise<EventSubscriptionRecord | undefined>;
  /** Remove a subscription whose lifetime ended at or before `now`; resolves to it for the caller that removed it. */
  deleteExpired(id: string, now: number): Promise<EventSubscriptionRecord | undefined>;
  listByEvent(eventName: string): Promise<EventSubscriptionRecord[]>;
  countByPrincipal(principalKey: string): Promise<number>;
  /** Change a subscription in place; undefined when it is gone. */
  update(id: string, patch: EventSubscriptionPatch): Promise<EventSubscriptionRecord | undefined>;
  /** The subscriptions whose lifetime ended at or before `now` and that are still stored. */
  listExpired(now: number): Promise<EventSubscriptionRecord[]>;
  close(): Promise<void>;
}

export interface StorageEventSubscriptionStoreOptions {
  /** Owned by the store: it is disconnected on `close()`. */
  storage: NamespacedStorage;
  /** Encrypts each record and keys the indexes by HMACs. Required for a store that outlives the process. */
  secret?: string;
}

interface StoredSubscription {
  raw: string;
  record: EventSubscriptionRecord;
}

const RECORD_PREFIX = 's:';
const EVENT_INDEX_PREFIX = 'e:';
const PRINCIPAL_INDEX_PREFIX = 'p:';
const EXPIRY_INDEX_PREFIX = 'x:';
/** How long an expired subscription stays stored, so the expiry sweep can still tell its event. */
const EXPIRED_RETENTION_SECONDS = 3600;
/** Attempts at a compare-and-set before giving up on a record other writers keep changing. */
const MAX_ATTEMPTS = 16;
const textEncoder = new TextEncoder();

/** Whether the subscription's lifetime is over at `now`. */
function isExpired(record: EventSubscriptionRecord, now: number): boolean {
  return record.expiresAt !== null && record.expiresAt <= now;
}

/** The storage TTL of a record and its index keys: its lifetime plus the retention, or none without an expiry. */
function ttlOptionsOf(record: EventSubscriptionRecord): { ttlSeconds?: number } {
  if (record.expiresAt === null) return {};
  const remainingSeconds = Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 1000));
  return { ttlSeconds: remainingSeconds + EXPIRED_RETENTION_SECONDS };
}

/** The subscription id an index key ends with. */
function idOfIndexKey(indexKey: string): string {
  return indexKey.slice(indexKey.lastIndexOf(':') + 1);
}

/** Subscriptions in a storage with atomic compare-and-set (memory, Redis, SQLite), indexed by event and by owner. */
export class StorageEventSubscriptionStore implements EventSubscriptionStore {
  constructor(private readonly options: StorageEventSubscriptionStoreOptions) {}

  /** Write the record and its index keys, with a storage TTL that outlasts a finite lifetime. */
  async upsert(record: EventSubscriptionRecord): Promise<void> {
    const { storage } = this.options;
    const ttlOptions = ttlOptionsOf(record);
    await storage.set(RECORD_PREFIX + record.id, await this.encode(record), ttlOptions);
    await storage.set(this.eventIndexKey(record), '1', ttlOptions);
    await storage.set(this.principalIndexKey(record), '1', ttlOptions);
    if (record.expiresAt !== null) {
      await storage.set(`${EXPIRY_INDEX_PREFIX}${record.expiresAt}:${record.id}`, '1', ttlOptions);
    }
  }

  /** The live subscription of an id. */
  async get(id: string): Promise<EventSubscriptionRecord | undefined> {
    const stored = await this.read(id);
    return stored && !isExpired(stored.record, Date.now()) ? stored.record : undefined;
  }

  /** Remove a subscription, expired or not. */
  async delete(id: string): Promise<EventSubscriptionRecord | undefined> {
    return this.remove(id, () => true);
  }

  /** Remove a subscription only when its lifetime is over. */
  async deleteExpired(id: string, now: number): Promise<EventSubscriptionRecord | undefined> {
    return this.remove(id, (record) => isExpired(record, now));
  }

  /** The live subscriptions of an event, through its index. */
  async listByEvent(eventName: string): Promise<EventSubscriptionRecord[]> {
    return this.liveRecordsOf(`${EVENT_INDEX_PREFIX}${this.digest('event', eventName)}:*`);
  }

  /** How many live subscriptions an owner holds, through its index. */
  async countByPrincipal(principalKey: string): Promise<number> {
    const records = await this.liveRecordsOf(`${PRINCIPAL_INDEX_PREFIX}${this.digest('principal', principalKey)}:*`);
    return records.length;
  }

  /** Apply a patch with compare-and-set, on top of whatever another writer stored first. */
  async update(id: string, patch: EventSubscriptionPatch): Promise<EventSubscriptionRecord | undefined> {
    const { storage } = this.options;
    const recordKey = RECORD_PREFIX + id;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const stored = await this.read(id);
      if (!stored || isExpired(stored.record, Date.now())) return undefined;
      const changes = typeof patch === 'function' ? patch(stored.record) : patch;
      const next: EventSubscriptionRecord = { ...stored.record, ...changes };
      const nextRaw = await this.encode(next);
      if (!(await storage.setIfEquals(recordKey, stored.raw, nextRaw))) continue;
      const { ttlSeconds } = ttlOptionsOf(next);
      if (ttlSeconds !== undefined) await storage.expireIfEquals(recordKey, nextRaw, ttlSeconds);
      return next;
    }
    throw new EventSubscriptionStoreError(`subscription ${id} kept changing while it was updated`);
  }

  /** The expired subscriptions the expiry index names, dropping index keys that no longer apply. */
  async listExpired(now: number): Promise<EventSubscriptionRecord[]> {
    const { storage } = this.options;
    const expiryKeys = await storage.keys(`${EXPIRY_INDEX_PREFIX}*`);
    const dueKeys = expiryKeys.filter((expiryKey) => Number(expiryKey.split(':')[1]) <= now);
    const expired: EventSubscriptionRecord[] = [];
    for (const expiryKey of dueKeys) {
      const stored = await this.read(idOfIndexKey(expiryKey));
      if (stored && isExpired(stored.record, now)) {
        expired.push(stored.record);
      } else {
        await storage.delete(expiryKey);
      }
    }
    return expired;
  }

  /** Disconnect the storage. */
  async close(): Promise<void> {
    await this.options.storage.disconnect();
  }

  /** Remove the stored subscription when `shouldRemove` accepts it, once across every node. */
  private async remove(
    id: string,
    shouldRemove: (record: EventSubscriptionRecord) => boolean,
  ): Promise<EventSubscriptionRecord | undefined> {
    const { storage } = this.options;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const stored = await this.read(id);
      if (!stored || !shouldRemove(stored.record)) return undefined;
      if (!(await storage.deleteIfEquals(RECORD_PREFIX + id, stored.raw))) continue;
      await storage.mdelete([this.eventIndexKey(stored.record), this.principalIndexKey(stored.record)]);
      return stored.record;
    }
    throw new EventSubscriptionStoreError(`subscription ${id} kept changing while it was removed`);
  }

  /** The live subscriptions an index pattern names. */
  private async liveRecordsOf(indexPattern: string): Promise<EventSubscriptionRecord[]> {
    const { storage } = this.options;
    const indexKeys = await storage.keys(indexPattern);
    if (indexKeys.length === 0) return [];
    const ids = indexKeys.map(idOfIndexKey);
    const raws = await storage.mget(ids.map((id) => RECORD_PREFIX + id));
    const now = Date.now();
    const records: EventSubscriptionRecord[] = [];
    for (let index = 0; index < ids.length; index++) {
      const raw = raws[index];
      const record = raw === null || raw === undefined ? undefined : await this.decode(raw, ids[index]);
      if (record && !isExpired(record, now)) records.push(record);
    }
    return records;
  }

  /** The stored subscription, expired or not, with the exact value a compare-and-set needs. */
  private async read(id: string): Promise<StoredSubscription | undefined> {
    const raw = await this.options.storage.get(RECORD_PREFIX + id);
    if (raw === null) return undefined;
    const record = await this.decode(raw, id);
    return record ? { raw, record } : undefined;
  }

  /** The record as stored: encrypted under a key of its own when the store has a secret. */
  private async encode(record: EventSubscriptionRecord): Promise<string> {
    const { secret } = this.options;
    return secret === undefined ? JSON.stringify(record) : encryptAndSerialize(record, `events:${record.id}`, secret);
  }

  /** The record a stored value holds; undefined for one that cannot be read or belongs to another id. */
  private async decode(raw: string, id: string): Promise<EventSubscriptionRecord | undefined> {
    const { secret } = this.options;
    try {
      const record =
        secret === undefined
          ? (JSON.parse(raw) as EventSubscriptionRecord)
          : await deserializeAndDecrypt<EventSubscriptionRecord>(raw, `events:${id}`, secret);
      return record?.id === id ? record : undefined;
    } catch {
      return undefined;
    }
  }

  /** The index key that lists the subscription under its event. */
  private eventIndexKey(record: EventSubscriptionRecord): string {
    return `${EVENT_INDEX_PREFIX}${this.digest('event', record.eventName)}:${record.id}`;
  }

  /** The index key that lists the subscription under its owner. */
  private principalIndexKey(record: EventSubscriptionRecord): string {
    return `${PRINCIPAL_INDEX_PREFIX}${this.digest('principal', record.principalKey)}:${record.id}`;
  }

  /** A key part that names `value` without showing it: an HMAC with the secret, else a SHA-256. */
  private digest(kind: string, value: string): string {
    const { secret } = this.options;
    const text = `${kind}:${value}`;
    if (secret === undefined) return sha256Hex(text);
    return bytesToHex(hmacSha256(textEncoder.encode(secret), textEncoder.encode(text)));
  }
}
