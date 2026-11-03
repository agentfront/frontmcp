import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { createChangeFeed, createMemoryStorage, mkdtemp, rm } from '@frontmcp/utils';

import { InvalidInputError } from '../../../errors';
import { createQuestionStore } from '../question-store.factory';
import { QuestionAlreadyAnsweredError, QuestionNotFoundError, QuestionStoreBusyError } from '../question.errors';
import { QuestionStore, type QuestionRequest } from '../question.store';

const SCHEMA = {
  type: 'object',
  properties: { approve: { type: 'boolean' } },
  required: ['approve'],
};

const DAY_MS = 86_400_000;

function request(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    subject: 'principal:alice',
    key: 'deploy',
    message: 'Deploy v2 to production?',
    requestedSchema: SCHEMA,
    ttlMs: DAY_MS,
    waiter: 'call-1',
    ...overrides,
  };
}

async function memoryStore(secret?: string): Promise<QuestionStore> {
  const { store } = await createQuestionStore({
    storage: { type: 'memory' },
    encryption: secret ? { enabled: true, secret } : { enabled: false },
    coalesceMs: 0,
  });
  return store;
}

async function askedId(store: QuestionStore, overrides: Partial<QuestionRequest> = {}): Promise<string> {
  const outcome = await store.ask(request(overrides));
  if (outcome.kind !== 'waiting') throw new Error(`expected a waiting question, got ${outcome.kind}`);
  return outcome.question.id;
}

describe('QuestionStore', () => {
  let store: QuestionStore;

  beforeEach(async () => {
    store = await memoryStore();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await store.close();
  });

  describe('asking', () => {
    it('keeps the question for its subject, with its message and schema', async () => {
      const outcome = await store.ask(request());

      expect(outcome).toEqual({
        kind: 'waiting',
        question: {
          id: expect.stringMatching(/^q-/),
          key: 'deploy',
          message: 'Deploy v2 to production?',
          requestedSchema: SCHEMA,
          createdAt: expect.any(Number),
          expiresAt: expect.any(Number),
          answered: false,
        },
      });
      expect(await store.list('principal:alice')).toEqual([outcome.kind === 'waiting' && outcome.question]);
    });

    it('asks a key once: a second ask is the same question', async () => {
      const first = await askedId(store);
      const second = await askedId(store, { waiter: 'call-2' });

      expect(second).toBe(first);
      expect(await store.list('principal:alice')).toHaveLength(1);
    });

    it('keeps the questions of two subjects apart', async () => {
      await store.ask(request());
      await store.ask(request({ subject: 'principal:bob', message: 'Bob asks' }));

      expect((await store.list('principal:alice')).map((question) => question.message)).toEqual([
        'Deploy v2 to production?',
      ]);
      expect((await store.list('principal:bob')).map((question) => question.message)).toEqual(['Bob asks']);
      expect(await store.list('session:someone-else')).toEqual([]);
    });
  });

  describe('answering', () => {
    it('lets only the subject asked answer: another subject gets "not found"', async () => {
      const id = await askedId(store);

      await expect(store.answer('principal:bob', id, { status: 'accept', content: { approve: true } })).rejects.toThrow(
        QuestionNotFoundError,
      );
      expect(await store.take('principal:alice', 'deploy', 'call-1')).toEqual({
        kind: 'waiting',
        question: expect.objectContaining({ id }),
      });
    });

    it('refuses an unknown id', async () => {
      await store.ask(request());

      await expect(store.answer('principal:alice', 'q-unknown', { status: 'decline' })).rejects.toThrow(
        QuestionNotFoundError,
      );
    });

    it('validates the answer against the schema the question asked for', async () => {
      const id = await askedId(store);

      await expect(
        store.answer('principal:alice', id, { status: 'accept', content: { approve: 'yes' } }),
      ).rejects.toThrow(InvalidInputError);
      await expect(store.answer('principal:alice', id, { status: 'accept' })).rejects.toThrow(InvalidInputError);
      expect((await store.list('principal:alice'))[0].answered).toBe(false);
    });

    it('keeps the first of two answers and refuses the second', async () => {
      const id = await askedId(store);

      const results = await Promise.allSettled([
        store.answer('principal:alice', id, { status: 'accept', content: { approve: true } }),
        store.answer('principal:alice', id, { status: 'accept', content: { approve: false } }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(refused?.reason).toBeInstanceOf(QuestionAlreadyAnsweredError);
      const taken = await store.take('principal:alice', 'deploy', 'call-1');
      const kept = results.findIndex((result) => result.status === 'fulfilled') === 0;
      expect(taken).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: kept } },
        expiresAt: expect.any(Number),
      });
    });

    it('drops content from a decline', async () => {
      const id = await askedId(store);

      await store.answer('principal:alice', id, { status: 'decline', content: { approve: true } });

      expect(await store.take('principal:alice', 'deploy', 'call-1')).toEqual({
        kind: 'answered',
        answer: { status: 'decline' },
        expiresAt: expect.any(Number),
      });
    });
  });

  describe('delivery', () => {
    it('hands the answer to the waiting call once', async () => {
      const id = await askedId(store);
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      const [first, second] = await Promise.all([
        store.take('principal:alice', 'deploy', 'call-1'),
        store.take('principal:alice', 'deploy', 'call-1'),
      ]);

      expect([first.kind, second.kind].sort()).toEqual(['answered', 'superseded']);
      expect(await store.list('principal:alice')).toEqual([]);
    });

    it('keeps an answer that arrives after the call gave up, for the next call of the subject', async () => {
      const id = await askedId(store);
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      const next = await store.ask(request({ waiter: 'call-after-reconnect' }));

      expect(next).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: true } },
        expiresAt: expect.any(Number),
      });
      expect(await store.ask(request({ waiter: 'call-3' }))).toEqual({
        kind: 'waiting',
        question: expect.objectContaining({ answered: false }),
      });
    });

    it('gives the question to the newest call: the call it replaced no longer takes the answer', async () => {
      const id = await askedId(store, { waiter: 'session-1-call' });
      await askedId(store, { waiter: 'session-2-call' });
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      expect(await store.take('principal:alice', 'deploy', 'session-1-call')).toEqual({ kind: 'superseded' });
      expect(await store.take('principal:alice', 'deploy', 'session-2-call')).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: true } },
        expiresAt: expect.any(Number),
      });
    });

    it('delivers once when two sessions of the subject ask the answered question at once', async () => {
      const id = await askedId(store);
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      const outcomes = await Promise.all([
        store.ask(request({ waiter: 'session-a' })),
        store.ask(request({ waiter: 'session-b' })),
      ]);

      expect(outcomes.filter((outcome) => outcome.kind === 'answered')).toHaveLength(1);
    });

    it('tells its listeners of a new question and of an answer', async () => {
      const listener = jest.fn();
      const stop = store.subscribe('questions', listener);

      const id = await askedId(store);
      await waitFor(() => listener.mock.calls.length >= 1);
      await store.answer('principal:alice', id, { status: 'decline' });
      await waitFor(() => listener.mock.calls.length >= 2);
      stop();

      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('putting back an answer a call could not hand on', () => {
    it('keeps the expiry of the question the answer belonged to', async () => {
      const expiresAt = Date.now() + 60_000;
      await store.restore(request(), { status: 'decline' }, expiresAt);

      expect(await store.list('principal:alice')).toEqual([expect.objectContaining({ answered: true, expiresAt })]);
    });

    it('drops an answer whose question has expired', async () => {
      await store.restore(request(), { status: 'decline' }, Date.now() - 1);

      expect(await store.list('principal:alice')).toEqual([]);
    });

    it('keeps it for the next call when the question is gone', async () => {
      await store.restore(request(), { status: 'accept', content: { approve: true } });

      expect(await store.ask(request({ waiter: 'next' }))).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: true } },
        expiresAt: expect.any(Number),
      });
    });

    it('answers the question a newer call asked meanwhile', async () => {
      await askedId(store, { waiter: 'newer' });

      await store.restore(request(), { status: 'decline' });

      expect(await store.take('principal:alice', 'deploy', 'newer')).toEqual({
        kind: 'answered',
        answer: { status: 'decline' },
        expiresAt: expect.any(Number),
      });
    });

    it('leaves an answer that is already waiting', async () => {
      const id = await askedId(store);
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      await store.restore(request(), { status: 'decline' });

      expect(await store.take('principal:alice', 'deploy', 'call-1')).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: true } },
        expiresAt: expect.any(Number),
      });
    });
  });

  describe('a storage it cannot rely on', () => {
    it('gives up with QuestionStoreBusyError when every compare-and-set loses', async () => {
      const storage = createMemoryStorage();
      await storage.connect();
      const busy = new QuestionStore({ storage, feed: createChangeFeed(storage) });
      jest.spyOn(storage, 'setIfEquals').mockResolvedValue(false);
      const id = await askedId(busy);

      await expect(busy.answer('principal:alice', id, { status: 'decline' })).rejects.toThrow(QuestionStoreBusyError);
      await expect(busy.ask(request({ waiter: 'another-call' }))).rejects.toThrow(QuestionStoreBusyError);
      await busy.close();
    });

    it('reads a record it cannot parse as no question', async () => {
      const { store: plain, storage } = await createQuestionStore({
        storage: { type: 'memory' },
        encryption: { enabled: false },
      });
      await askedId(plain);
      for (const key of await storage.keys('*')) if (key.includes('q:')) await storage.set(key, '{not json');

      expect(await plain.list('principal:alice')).toEqual([]);
      expect(await plain.ask(request({ waiter: 'call-2' }))).toEqual({
        kind: 'waiting',
        question: expect.objectContaining({ key: 'deploy', answered: false }),
      });
      await plain.close();
    });

    it('keeps asking and answering when a change notification fails', async () => {
      const storage = createMemoryStorage();
      await storage.connect();
      const feed = createChangeFeed(storage);
      jest.spyOn(feed, 'publish').mockRejectedValue(new Error('the feed is down'));
      const quiet = new QuestionStore({ storage, feed });

      const id = await askedId(quiet);
      await quiet.answer('principal:alice', id, { status: 'decline' });

      expect(await quiet.take('principal:alice', 'deploy', 'call-1')).toEqual({
        kind: 'answered',
        answer: { status: 'decline' },
        expiresAt: expect.any(Number),
      });
      await quiet.close();
    });
  });

  describe('TTL', () => {
    it('forgets a question once its TTL passes', async () => {
      jest.useFakeTimers({ now: 1_000_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const id = await askedId(store, { ttlMs: 60_000 });

      jest.setSystemTime(1_000_000 + 60_001);

      expect(await store.list('principal:alice')).toEqual([]);
      await expect(store.answer('principal:alice', id, { status: 'decline' })).rejects.toThrow(QuestionNotFoundError);
      expect(await store.take('principal:alice', 'deploy', 'call-1')).toEqual({ kind: 'superseded' });
    });

    it('forgets an answer nobody took once the TTL passes', async () => {
      jest.useFakeTimers({ now: 1_000_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const id = await askedId(store, { ttlMs: 60_000 });
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      jest.setSystemTime(1_000_000 + 60_001);

      expect(await store.ask(request({ waiter: 'late-call', ttlMs: 60_000 }))).toEqual({
        kind: 'waiting',
        question: expect.objectContaining({ answered: false }),
      });
    });
  });

  describe('encryption at rest', () => {
    it('stores neither the question nor the answer in the clear', async () => {
      await store.close();
      const { store: encrypted, storage } = await createQuestionStore({
        storage: { type: 'memory' },
        encryption: { enabled: true, secret: 'a-server-secret-of-some-length' },
        coalesceMs: 0,
      });
      store = encrypted;
      const id = await askedId(store, { message: 'Ship the secret plan?' });
      await store.answer('principal:alice', id, { status: 'accept', content: { approve: true } });

      const raw = (await storage.mget(await storage.keys('*'))).join('\n');

      expect(raw).not.toContain('secret plan');
      expect(raw).not.toContain('principal:alice');
      expect(raw).not.toContain('approve');
      expect(await store.ask(request({ waiter: 'next' }))).toEqual({
        kind: 'answered',
        answer: { status: 'accept', content: { approve: true } },
        expiresAt: expect.any(Number),
      });
    });

    it("delivers no answer that was moved to another question's place in the store", async () => {
      await store.close();
      const { store: encrypted, storage } = await createQuestionStore({
        storage: { type: 'memory' },
        encryption: { enabled: true, secret: 'a-server-secret-of-some-length' },
        coalesceMs: 0,
      });
      store = encrypted;
      const recordKeys = async () => (await storage.keys('*')).filter((key) => key.includes('q:'));
      await askedId(store, { key: 'deploy-prod', waiter: 'prod' });
      const [prodKey] = await recordKeys();
      const stagingId = await askedId(store, { key: 'deploy-staging', waiter: 'staging' });
      await store.answer('principal:alice', stagingId, { status: 'accept', content: { approve: true } });
      const stagingKey = (await recordKeys()).find((key) => key !== prodKey) ?? '';
      await storage.set(prodKey, (await storage.get(stagingKey)) ?? '');

      expect(await store.ask(request({ key: 'deploy-prod', waiter: 'prod-2' }))).toEqual({
        kind: 'waiting',
        question: expect.objectContaining({ key: 'deploy-prod', answered: false }),
      });
    });
  });
});

describe('QuestionStore on SQLite, shared by two processes', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'questions-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('outlives the store that asked, and delivers the answer once across stores', async () => {
    const file = path.join(directory, 'questions.sqlite');
    const open = async () =>
      (await createQuestionStore({ storage: { type: 'sqlite', sqlite: { path: file } }, coalesceMs: 0 })).store;
    const asking = await open();
    const id = await askedId(asking);
    await asking.close();

    const answering = await open();
    await answering.answer('principal:alice', id, { status: 'accept', content: { approve: true } });
    const one = await open();
    const two = await open();

    const outcomes = await Promise.all([one.ask(request({ waiter: 'a' })), two.ask(request({ waiter: 'b' }))]);

    expect(outcomes.filter((outcome) => outcome.kind === 'answered')).toEqual([
      { kind: 'answered', answer: { status: 'accept', content: { approve: true } }, expiresAt: expect.any(Number) },
    ]);
    await Promise.all([answering.close(), one.close(), two.close()]);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the condition did not hold in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
