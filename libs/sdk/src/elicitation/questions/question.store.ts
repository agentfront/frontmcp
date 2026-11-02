import {
  bytesToHex,
  hmacSha256,
  randomUUID,
  sha256Hex,
  type ChangeFeed,
  type NamespacedStorage,
} from '@frontmcp/utils';

import { type HttpRouteTopicSource } from '../../common/metadata/http-route.metadata';
import { InvalidInputError } from '../../errors';
import { type ElicitResult } from '../elicitation.types';
import { validateElicitationContent } from '../helpers/validate-elicitation-content';
import { deserializeAndDecrypt, encryptAndSerialize } from '../store/elicitation-encryption';
import { QuestionAlreadyAnsweredError, QuestionNotFoundError, QuestionStoreBusyError } from './question.errors';

/** The topic a store publishes whenever a question is asked, answered or taken. */
export const QUESTIONS_TOPIC = 'questions';

const RECORD_PREFIX = 'q:';
/** Attempts at a compare-and-set before giving up on a record other writers keep changing. */
const MAX_ATTEMPTS = 16;
const textEncoder = new TextEncoder();

/** A question as the inbox shows it. */
export interface PersistentQuestion {
  id: string;
  key: string;
  message: string;
  requestedSchema: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  /** Answered, and waiting for the call that takes the answer. */
  answered: boolean;
}

export interface QuestionRequest {
  /** Who was asked: `principal:<sub>` or `session:<id>`. */
  subject: string;
  key: string;
  message: string;
  requestedSchema: Record<string, unknown>;
  ttlMs: number;
  /** The call that waits for the answer; the newest call to ask a question is the one that gets it. */
  waiter: string;
}

export type QuestionOutcome =
  | { kind: 'answered'; answer: ElicitResult }
  | { kind: 'waiting'; question: PersistentQuestion }
  | { kind: 'superseded' };

/** What asking gives: the answer, taken now, or the question this call now waits on. */
export type AskOutcome = Exclude<QuestionOutcome, { kind: 'superseded' }>;

interface QuestionRecord {
  id: string;
  subject: string;
  key: string;
  message: string;
  requestedSchema: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  waiter: string;
  answer?: ElicitResult;
}

interface StoredRecord {
  storageKey: string;
  raw: string;
  record: QuestionRecord;
}

export interface QuestionStoreOptions {
  /** Owned by the store: it is disconnected on `close()`. */
  storage: NamespacedStorage;
  feed: ChangeFeed;
  /** Encrypts each record with a key derived from it and the record's subject, and keys records by HMACs. */
  secret?: string;
}

function view(record: QuestionRecord): PersistentQuestion {
  const { id, key, message, requestedSchema, createdAt, expiresAt, answer } = record;
  return { id, key, message, requestedSchema, createdAt, expiresAt, answered: answer !== undefined };
}

function ttlSecondsUntil(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function normalized(answer: ElicitResult): ElicitResult {
  return answer.status === 'accept' ? { status: 'accept', content: answer.content } : { status: answer.status };
}

/**
 * Persistent questions, kept per subject in a storage with atomic compare-and-set: one record per subject and key,
 * whose answer the newest call waiting on it takes, once.
 */
export class QuestionStore implements HttpRouteTopicSource {
  constructor(private readonly options: QuestionStoreOptions) {}

  get encrypted(): boolean {
    return this.options.secret !== undefined;
  }

  /** Ask a question: its answer when it was answered (taken now), else the question, now waited on by `waiter`. */
  async ask(request: QuestionRequest): Promise<AskOutcome> {
    const storageKey = this.recordKey(request.subject, request.key);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.read(storageKey, request.subject);
      if (!current) {
        const created = await this.create(storageKey, request);
        if (created) return { kind: 'waiting', question: view(created) };
        continue;
      }
      const { record, raw } = current;
      if (record.answer) {
        if (await this.claim(storageKey, raw)) return { kind: 'answered', answer: record.answer };
        continue;
      }
      if (record.waiter === request.waiter) return { kind: 'waiting', question: view(record) };
      const handedOver = { ...record, waiter: request.waiter };
      if (await this.replace(storageKey, raw, handedOver)) return { kind: 'waiting', question: view(handedOver) };
    }
    throw new QuestionStoreBusyError();
  }

  /** The answer for `waiter`, taken once; `superseded` when the question is gone or a newer call waits on it. */
  async take(subject: string, key: string, waiter: string): Promise<QuestionOutcome> {
    const storageKey = this.recordKey(subject, key);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.read(storageKey, subject);
      if (!current || current.record.waiter !== waiter) return { kind: 'superseded' };
      const { record, raw } = current;
      if (!record.answer) return { kind: 'waiting', question: view(record) };
      if (await this.claim(storageKey, raw)) return { kind: 'answered', answer: record.answer };
    }
    throw new QuestionStoreBusyError();
  }

  /** Put back an answer a call took but could not hand on, so the next call that asks gets it. */
  async restore(request: QuestionRequest, answer: ElicitResult): Promise<void> {
    const storageKey = this.recordKey(request.subject, request.key);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.read(storageKey, request.subject);
      if (current?.record.answer) return;
      if (current) {
        if (await this.replace(storageKey, current.raw, { ...current.record, answer })) return;
        continue;
      }
      if (await this.create(storageKey, request, answer)) return;
    }
    throw new QuestionStoreBusyError();
  }

  /** The questions asked of `subject`, oldest first. */
  async list(subject: string): Promise<PersistentQuestion[]> {
    const records = await this.records(subject);
    return records.map(({ record }) => view(record)).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Answer a question of `subject`. Another subject's question is "not found", like one that never was; an `accept`
   * must match the question's schema; only the first answer is kept.
   */
  async answer(subject: string, id: string, answer: ElicitResult): Promise<void> {
    const result = normalized(answer);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const found = (await this.records(subject)).find(({ record }) => record.id === id);
      if (!found) throw new QuestionNotFoundError();
      const { record, raw, storageKey } = found;
      if (record.answer) throw new QuestionAlreadyAnsweredError();
      if (result.status === 'accept') {
        const validation = validateElicitationContent(result.content, record.requestedSchema);
        if (!validation.success) {
          throw new InvalidInputError('The answer does not match the schema of the question', validation.errors);
        }
      }
      if (await this.replace(storageKey, raw, { ...record, answer: result })) return;
    }
    throw new QuestionStoreBusyError();
  }

  /** Call `listener` when a question is asked, answered or taken, here or in another process on the storage. */
  subscribe(topic: string, listener: () => void): () => void {
    return this.options.feed.subscribe(topic, listener);
  }

  async close(): Promise<void> {
    await this.options.feed.close();
    await this.options.storage.disconnect();
  }

  private async create(
    storageKey: string,
    request: QuestionRequest,
    answer?: ElicitResult,
  ): Promise<QuestionRecord | undefined> {
    const now = Date.now();
    const record: QuestionRecord = {
      id: `q-${randomUUID()}`,
      subject: request.subject,
      key: request.key,
      message: request.message,
      requestedSchema: request.requestedSchema,
      createdAt: now,
      expiresAt: now + request.ttlMs,
      waiter: request.waiter,
      ...(answer ? { answer } : {}),
    };
    const raw = await this.encode(record);
    await this.options.storage.set(storageKey, raw, {
      ttlSeconds: ttlSecondsUntil(record.expiresAt),
      ifNotExists: true,
    });
    const stored = await this.read(storageKey, request.subject);
    if (stored?.record.id !== record.id) return undefined;
    await this.changed();
    return record;
  }

  private async claim(storageKey: string, raw: string): Promise<boolean> {
    const claimed = await this.options.storage.deleteIfEquals(storageKey, raw);
    if (claimed) await this.changed();
    return claimed;
  }

  private async replace(storageKey: string, raw: string, record: QuestionRecord): Promise<boolean> {
    const next = await this.encode(record);
    const { storage } = this.options;
    if (!(await storage.setIfEquals(storageKey, raw, next))) return false;
    await storage.expireIfEquals(storageKey, next, ttlSecondsUntil(record.expiresAt));
    await this.changed();
    return true;
  }

  private async read(storageKey: string, subject: string): Promise<StoredRecord | undefined> {
    const raw = await this.options.storage.get(storageKey);
    return raw === null ? undefined : this.live(storageKey, raw, subject);
  }

  private async records(subject: string): Promise<StoredRecord[]> {
    const { storage } = this.options;
    const keys = await storage.keys(`${RECORD_PREFIX}${this.digest('subject', subject)}:*`);
    if (keys.length === 0) return [];
    const raws = await storage.mget(keys);
    const records = await Promise.all(
      keys.map((storageKey, index) => {
        const raw = raws[index];
        return raw === null || raw === undefined ? undefined : this.live(storageKey, raw, subject);
      }),
    );
    return records.filter((record): record is StoredRecord => record !== undefined);
  }

  /** The record, unless it cannot be read or has expired (an expired one is deleted). */
  private async live(storageKey: string, raw: string, subject: string): Promise<StoredRecord | undefined> {
    const record = await this.decode(raw, subject);
    if (!record || record.subject !== subject) return undefined;
    if (record.expiresAt <= Date.now()) {
      await this.options.storage.deleteIfEquals(storageKey, raw);
      return undefined;
    }
    return { storageKey, raw, record };
  }

  private async encode(record: QuestionRecord): Promise<string> {
    const { secret } = this.options;
    return secret === undefined ? JSON.stringify(record) : encryptAndSerialize(record, record.subject, secret);
  }

  private async decode(raw: string, subject: string): Promise<QuestionRecord | undefined> {
    const { secret } = this.options;
    try {
      const record =
        secret === undefined
          ? (JSON.parse(raw) as QuestionRecord)
          : await deserializeAndDecrypt<QuestionRecord>(raw, subject, secret);
      return record ?? undefined;
    } catch {
      return undefined;
    }
  }

  private recordKey(subject: string, key: string): string {
    return `${RECORD_PREFIX}${this.digest('subject', subject)}:${this.digest('key', key)}`;
  }

  /** A storage key part that names `value` without showing it: an HMAC with the secret, else a SHA-256. */
  private digest(kind: string, value: string): string {
    const { secret } = this.options;
    const text = `${kind}:${value}`;
    return secret === undefined
      ? sha256Hex(text)
      : bytesToHex(hmacSha256(textEncoder.encode(secret), textEncoder.encode(text)));
  }

  private async changed(): Promise<void> {
    try {
      await this.options.feed.publish(QUESTIONS_TOPIC);
    } catch {
      // A missed wake-up costs a waiting call its answer until its next read, not the answer itself
    }
  }
}
