import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { ElicitationDisabledError, ElicitationNotSupportedError, InvalidInputError } from '../../../errors';
import { performElicit, type ElicitHelperDeps } from '../../helpers/elicit.helper';
import { askPersistentQuestion } from '../ask-question';
import { createQuestionStore } from '../question-store.factory';
import { questionSubjectOf } from '../question-subject';
import { QuestionPendingError, QuestionSupersededError } from '../question.errors';
import { type QuestionStore } from '../question.store';

const schema = z.object({ approve: z.boolean() });
const SUBJECT = 'principal:alice';
const DAY_MS = 86_400_000;

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('nothing arrived in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('askPersistentQuestion', () => {
  let store: QuestionStore;

  beforeEach(async () => {
    ({ store } = await createQuestionStore({
      storage: { type: 'memory' },
      encryption: { enabled: false },
      coalesceMs: 0,
    }));
  });

  afterEach(async () => {
    await store.close();
  });

  const ask = (options: { waitMs?: number; signal?: AbortSignal; key?: string } = {}) =>
    askPersistentQuestion({ store, subject: SUBJECT, signal: options.signal }, 'Deploy v2?', schema, {
      key: options.key ?? 'deploy',
      ttlMs: DAY_MS,
      waitMs: options.waitMs ?? 10_000,
    });

  const pendingId = () => waitFor(async () => (await store.list(SUBJECT)).find((question) => !question.answered)?.id);

  it('hands the waiting call the answer a person gives', async () => {
    const call = ask();
    await store.answer(SUBJECT, await pendingId(), { status: 'accept', content: { approve: true } });

    await expect(call).resolves.toEqual({ status: 'accept', content: { approve: true } });
    expect(await store.list(SUBJECT)).toEqual([]);
  });

  it('passes a decline on without content', async () => {
    const call = ask();
    await store.answer(SUBJECT, await pendingId(), { status: 'decline' });

    await expect(call).resolves.toEqual({ status: 'decline' });
  });

  it('stops waiting at its timer and keeps the question; the next call gets the later answer', async () => {
    await expect(ask({ waitMs: 50 })).rejects.toThrow(QuestionPendingError);

    await store.answer(SUBJECT, await pendingId(), { status: 'accept', content: { approve: false } });

    await expect(ask({ waitMs: 50 })).resolves.toEqual({ status: 'accept', content: { approve: false } });
  });

  it('delivers an answer that races its timer exactly once: to the call, or else to the next call', async () => {
    for (let round = 0; round < 20; round++) {
      const key = `race-${round}`;
      const call = ask({ waitMs: 30, key }).then(
        (answer) => ({ answer }),
        (error: unknown) => ({ error }),
      );
      const id = await waitFor(async () => (await store.list(SUBJECT)).find((question) => question.key === key)?.id);
      await new Promise((resolve) => setTimeout(resolve, 25 + (round % 10)));
      await store.answer(SUBJECT, id, { status: 'accept', content: { approve: true } });

      const first = await call;
      const delivered = 'answer' in first ? 1 : 0;
      const next = await ask({ waitMs: 20, key }).then(
        () => 1,
        () => 0,
      );

      expect(delivered + next).toBe(1);
    }
  });

  it('gives the answer to the newer of two calls of the subject; the older stops waiting', async () => {
    const older = ask();
    const id = await pendingId();
    const newer = ask();

    await expect(older).rejects.toThrow(QuestionSupersededError);
    await store.answer(SUBJECT, id, { status: 'accept', content: { approve: true } });
    await expect(newer).resolves.toEqual({ status: 'accept', content: { approve: true } });
  });

  it('stops waiting when its call is aborted, and leaves the answer for the next call', async () => {
    const controller = new AbortController();
    const call = ask({ signal: controller.signal });
    const id = await pendingId();

    controller.abort();
    await expect(call).rejects.toThrow(QuestionPendingError);
    await store.answer(SUBJECT, id, { status: 'accept', content: { approve: true } });

    await expect(ask({ waitMs: 50 })).resolves.toEqual({ status: 'accept', content: { approve: true } });
  });

  it('puts back an answer its take brought in after the call was aborted', async () => {
    const controller = new AbortController();
    let deliver: (outcome: unknown) => void = () => undefined;
    const restore = jest.fn(async () => undefined);
    const slow = {
      ask: async () => ({ kind: 'waiting', question: { expiresAt: Date.now() + DAY_MS } }),
      take: () => new Promise((settle) => (deliver = settle)),
      subscribe: () => () => undefined,
      restore,
    } as unknown as QuestionStore;
    const call = askPersistentQuestion(
      { store: slow, subject: SUBJECT, signal: controller.signal },
      'Deploy?',
      schema,
      {
        key: 'deploy',
        ttlMs: DAY_MS,
        waitMs: 10_000,
      },
    );
    await new Promise((settle) => setTimeout(settle, 10));

    controller.abort();
    const expiresAt = Date.now() + DAY_MS;
    deliver({ kind: 'answered', answer: { status: 'accept', content: { approve: true } }, expiresAt });

    await expect(call).rejects.toThrow(QuestionPendingError);
    await waitFor(async () => (restore.mock.calls.length > 0 ? true : undefined));
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ subject: SUBJECT, key: 'deploy' }),
      { status: 'accept', content: { approve: true } },
      expiresAt,
    );
  });

  /** A question of `deploy` with an answer waiting for the next call, and the expiry it was asked with. */
  const answeredQuestion = async () => {
    await expect(ask({ waitMs: 20 })).rejects.toThrow(QuestionPendingError);
    const [question] = await store.list(SUBJECT);
    await store.answer(SUBJECT, question.id, { status: 'accept', content: { approve: true } });
    return question;
  };

  /** The answer of `deploy` is still waiting, with the expiry of its question, and the next call gets it. */
  const expectAnswerKept = async (expiresAt: number) => {
    expect(await store.list(SUBJECT)).toEqual([expect.objectContaining({ key: 'deploy', answered: true, expiresAt })]);
    await expect(ask({ waitMs: 50 })).resolves.toEqual({ status: 'accept', content: { approve: true } });
  };

  it('leaves a waiting answer for the next call when its call was cancelled before it asked', async () => {
    const question = await answeredQuestion();
    const controller = new AbortController();
    controller.abort();

    await expect(ask({ signal: controller.signal })).rejects.toThrow(QuestionPendingError);

    await expectAnswerKept(question.expiresAt);
  });

  it('leaves a waiting answer for the next call when its call is cancelled while it asks', async () => {
    const question = await answeredQuestion();
    const controller = new AbortController();
    const racing = Object.create(store) as QuestionStore;
    racing.ask = async (request) => {
      const outcome = await store.ask(request);
      controller.abort();
      return outcome;
    };

    await expect(
      askPersistentQuestion({ store: racing, subject: SUBJECT, signal: controller.signal }, 'Deploy v2?', schema, {
        key: 'deploy',
        ttlMs: DAY_MS,
        waitMs: 10_000,
      }),
    ).rejects.toThrow(QuestionPendingError);

    await expectAnswerKept(question.expiresAt);
  });

  it('leaves a waiting answer for the next call when its call is cancelled while the answer is checked', async () => {
    const question = await answeredQuestion();
    const controller = new AbortController();
    const checking = z.object({ approve: z.boolean() }).refine(async () => {
      controller.abort();
      return true;
    });

    await expect(
      askPersistentQuestion({ store, subject: SUBJECT, signal: controller.signal }, 'Deploy v2?', checking, {
        key: 'deploy',
        ttlMs: DAY_MS,
        waitMs: 10_000,
      }),
    ).rejects.toThrow(QuestionPendingError);

    await expectAnswerKept(question.expiresAt);
  });

  it('does not wait at all for a call already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(ask({ signal: controller.signal, key: 'aborted' })).rejects.toThrow(QuestionPendingError);
  });

  it('fails the call when the store fails while it waits', async () => {
    const failing = {
      ask: async () => ({ kind: 'waiting', question: { expiresAt: Date.now() + DAY_MS } }),
      take: async () => {
        throw new Error('the store is down');
      },
      subscribe: () => () => undefined,
    } as unknown as QuestionStore;

    await expect(
      askPersistentQuestion({ store: failing, subject: SUBJECT }, 'Deploy?', schema, {
        key: 'deploy',
        ttlMs: DAY_MS,
        waitMs: 10_000,
      }),
    ).rejects.toThrow('the store is down');
  });

  it('refuses an answer the schema of the call refuses', async () => {
    const strict = z.object({ approve: z.boolean().refine((value) => value, 'must approve') });
    const call = askPersistentQuestion({ store, subject: SUBJECT }, 'Deploy?', strict, {
      key: 'strict',
      ttlMs: DAY_MS,
      waitMs: 10_000,
    });
    await store.answer(SUBJECT, await pendingId(), { status: 'accept', content: { approve: false } });

    await expect(call).rejects.toThrow(InvalidInputError);
  });
});

describe('questionSubjectOf', () => {
  it.each([
    ['a signed-in user', { user: { sub: 'alice' }, sessionId: 's-1' }, 'principal:alice'],
    ['a user of an issuer', { user: { sub: 'alice', iss: 'https://idp.one' } }, 'principal:https://idp.one#alice'],
    [
      'the same sub at another issuer',
      { user: { sub: 'alice', iss: 'https://idp.two' } },
      'principal:https://idp.two#alice',
    ],
    ['an anonymous user with a session', { user: { sub: 'anon:123' }, sessionId: 's-1' }, 'session:s-1'],
    ['a session verified by the session flow', { extra: { sessionId: 's-2' } }, 'session:s-2'],
    ['an anonymous caller with no session', { user: { sub: 'anon:123' } }, undefined],
    ['the stateless transport session', { sessionId: '__stateless__' }, undefined],
    ['nothing', undefined, undefined],
  ])('maps %s', (_case, authInfo, subject) => {
    expect(questionSubjectOf(authInfo as never)).toBe(subject);
  });
});

describe('performElicit with persist', () => {
  let store: QuestionStore;

  beforeEach(async () => {
    ({ store } = await createQuestionStore({ storage: { type: 'memory' }, encryption: { enabled: false } }));
  });

  afterEach(async () => {
    await store.close();
  });

  function deps(overrides: Partial<ElicitHelperDeps> = {}): ElicitHelperDeps {
    return {
      sessionId: 's-1',
      getClientCapabilities: () => undefined,
      tryGetContext: () => ({ authInfo: { user: { sub: 'alice' }, sessionId: 's-1' } }) as never,
      entryName: 'deploy',
      entryInput: {},
      elicitationEnabled: true,
      questions: { store, ttlMs: DAY_MS },
      ...overrides,
    };
  }

  it('asks without the client: a client with no elicitation support still gets its question kept', async () => {
    const call = performElicit(deps(), 'Deploy?', schema, { persist: { key: 'deploy' }, ttl: 10_000 });
    const id = await waitFor(async () => (await store.list(SUBJECT))[0]?.id);
    await store.answer(SUBJECT, id, { status: 'accept', content: { approve: true } });

    await expect(call).resolves.toEqual({ status: 'accept', content: { approve: true } });
  });

  it('is refused while elicitation is off', async () => {
    await expect(
      performElicit(deps({ elicitationEnabled: false }), 'Deploy?', schema, { persist: { key: 'deploy' } }),
    ).rejects.toThrow(ElicitationDisabledError);
  });

  it('is refused while persistent questions are off', async () => {
    await expect(
      performElicit(deps({ questions: undefined }), 'Deploy?', schema, { persist: { key: 'deploy' } }),
    ).rejects.toThrow(/Persistent questions are off/);
  });

  it('is refused for a caller it cannot be kept for', async () => {
    const anonymous = deps({ tryGetContext: () => ({ authInfo: { user: { sub: 'anon:1' } } }) as never });

    await expect(performElicit(anonymous, 'Deploy?', schema, { persist: { key: 'deploy' } })).rejects.toThrow(
      ElicitationNotSupportedError,
    );
  });

  it.each([
    ['an empty key', { persist: { key: '' } }],
    ['a URL-mode question', { mode: 'url' as const, url: 'https://example.com', persist: { key: 'deploy' } }],
    ['a TTL no longer than the wait', { ttl: 60_000, persist: { key: 'deploy', ttlMs: 60_000 } }],
  ])('refuses %s', async (_case, options) => {
    await expect(performElicit(deps(), 'Deploy?', schema, options)).rejects.toThrow(InvalidInputError);
  });
});
