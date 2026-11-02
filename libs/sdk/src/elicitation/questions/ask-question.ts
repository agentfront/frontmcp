import { toJSONSchema, internalZ as z, type ZodType } from '@frontmcp/lazy-zod';
import { randomUUID } from '@frontmcp/utils';

import {
  ElicitationNotSupportedError,
  InvalidInputError,
  QuestionPendingError,
  QuestionSupersededError,
} from '../../errors';
import { DEFAULT_ELICIT_TTL, type ElicitOptions, type ElicitResult, type PersistOptions } from '../elicitation.types';
import { type ElicitHelperDeps } from '../helpers/elicit.helper';
import { questionSubjectOf } from './question-subject';
import { QUESTIONS_TOPIC, type QuestionOutcome, type QuestionRequest, type QuestionStore } from './question.store';

/** How often a waiting call reads its question even without a change notification. */
const RECHECK_MS = 5_000;
const MAX_QUESTION_KEY_LENGTH = 256;

export interface PersistentAskDeps {
  store: QuestionStore;
  subject: string;
  /** Aborted when the call stops: the question stays for the next call. */
  signal?: AbortSignal;
}

export interface PersistentAskOptions {
  key: string;
  /** How long the question, and an answer nobody took yet, are kept. */
  ttlMs: number;
  /** How long this call waits for the answer. */
  waitMs: number;
}

async function delivered<S extends ZodType>(
  answer: ElicitResult,
  schema: S,
): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
  type Result = ElicitResult<S extends ZodType<infer O> ? O : unknown>;
  if (answer.status !== 'accept') return { status: answer.status } as Result;
  const parsed = await schema.safeParseAsync(answer.content);
  if (!parsed.success) {
    throw new InvalidInputError('The answer does not match the requested schema', parsed.error.issues);
  }
  return { status: 'accept', content: parsed.data } as Result;
}

/**
 * Ask a question that outlives this call: kept for `subject` under `key`, answered in the inbox. Resolves with the
 * answer once: at once when one is waiting, or when it arrives while this call waits. Rejects with
 * `QuestionPendingError` when the call stops waiting (timer or abort), and `QuestionSupersededError` when a newer call
 * of the subject asks the question; either way the question, and its answer, stay for the next call.
 */
export async function askPersistentQuestion<S extends ZodType>(
  deps: PersistentAskDeps,
  message: string,
  schema: S,
  options: PersistentAskOptions,
): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
  const { store, subject, signal } = deps;
  const request: QuestionRequest = {
    subject,
    key: options.key,
    message,
    requestedSchema: toJSONSchema(schema) as Record<string, unknown>,
    ttlMs: options.ttlMs,
    waiter: `call-${randomUUID()}`,
  };
  const asked = await store.ask(request);
  if (asked.kind === 'answered') return delivered(asked.answer, schema);
  if (asked.kind === 'superseded') throw new QuestionSupersededError(options.key);
  const { expiresAt } = asked.question;

  const answer = await new Promise<ElicitResult>((resolve, reject) => {
    let settled = false;
    let queued = false;
    let chain: Promise<void> = Promise.resolve();

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      stop();
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const pending = () => finish(() => reject(new QuestionPendingError(options.key, expiresAt)));

    const handle = (outcome: QuestionOutcome) => {
      if (outcome.kind === 'answered') {
        if (settled || signal?.aborted) {
          pending();
          void store.restore(request, outcome.answer).catch(() => undefined);
          return;
        }
        finish(() => resolve(outcome.answer));
      } else if (outcome.kind === 'superseded') {
        finish(() => reject(new QuestionSupersededError(options.key)));
      }
    };

    const serialized = (task: () => Promise<void>) => {
      chain = chain.then(task).catch((error: unknown) => finish(() => reject(error)));
    };
    const take = () => store.take(subject, options.key, request.waiter);

    const check = () => {
      if (settled || queued) return;
      queued = true;
      serialized(async () => {
        queued = false;
        if (!settled) handle(await take());
      });
    };
    const giveUp = () =>
      serialized(async () => {
        if (settled) return;
        const outcome = await take();
        handle(outcome);
        if (outcome.kind === 'waiting') pending();
      });

    const onAbort = () => pending();
    const timer = setTimeout(giveUp, options.waitMs);
    const poll = setInterval(check, RECHECK_MS);
    const stop = store.subscribe(QUESTIONS_TOPIC, check);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    check();
  });
  return delivered(answer, schema);
}

/** `this.elicit(message, schema, { persist })`: checks the call, then asks for the caller the request names. */
export async function elicitPersistent<S extends ZodType>(
  deps: Pick<ElicitHelperDeps, 'questions' | 'signal' | 'tryGetContext'>,
  message: string,
  requestedSchema: S,
  options: ElicitOptions & { persist: PersistOptions },
): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
  const { persist } = options;
  if (typeof persist.key !== 'string' || persist.key.length === 0 || persist.key.length > MAX_QUESTION_KEY_LENGTH) {
    throw new InvalidInputError(`persist.key must be a string of 1 to ${MAX_QUESTION_KEY_LENGTH} characters`);
  }
  if (options.mode === 'url') throw new InvalidInputError('a persistent question is a form: drop mode "url"');
  const waitMs = options.ttl ?? DEFAULT_ELICIT_TTL;
  const { questions } = deps;
  if (!questions) {
    throw new ElicitationNotSupportedError(
      'Persistent questions are off: enable them with @FrontMcp({ elicitation: { enabled: true, persistent: true } })',
    );
  }
  const ttlMs = persist.ttlMs ?? questions.ttlMs;
  if (!Number.isInteger(ttlMs) || ttlMs <= waitMs) {
    throw new InvalidInputError(
      `persist.ttlMs (${ttlMs}) must be a whole number longer than ttl (${waitMs}), the wait`,
    );
  }
  const subject = questionSubjectOf(deps.tryGetContext()?.authInfo);
  if (!subject) {
    throw new ElicitationNotSupportedError(
      'A persistent question is kept for a signed-in user or a session, and this anonymous caller has neither',
    );
  }
  const zodSchema = requestedSchema instanceof z.ZodType ? requestedSchema : z.object(requestedSchema as z.ZodRawShape);
  return askPersistentQuestion({ store: questions.store, subject, signal: deps.signal }, message, zodSchema as S, {
    key: persist.key,
    ttlMs,
    waitMs,
  });
}
