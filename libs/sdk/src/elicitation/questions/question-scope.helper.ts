import { internalZ as z } from '@frontmcp/lazy-zod';
import { type SqliteAdapterOptions } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { type RawZodShape } from '../../common/types/common.types';
import {
  type PersistentQuestionsOptionsInterface,
  type PersistentQuestionsStorage,
} from '../../common/types/options/elicitation';
import { InvalidQuestionStoreError } from '../../errors';
import { createQuestionStore, resolveQuestionStorage, type QuestionStoreResult } from './question-store.factory';
import { type QuestionStore } from './question.store';

/** @default 24 hours */
export const DEFAULT_QUESTION_TTL_MS = 86_400_000;

const persistentQuestionsOptionsSchema = z
  .object({
    ttlMs: z
      .number({ message: 'ttlMs must be a number of milliseconds' })
      .int('ttlMs must be a whole number of milliseconds')
      .positive('ttlMs must be greater than 0')
      .optional(),
    storage: z
      .object({
        type: z.enum(['memory', 'redis', 'sqlite'], { message: "storage.type must be 'memory', 'redis' or 'sqlite'" }),
      })
      .passthrough()
      .optional(),
  } satisfies RawZodShape<PersistentQuestionsOptionsInterface>)
  .strict();

/** `elicitation.persistent`, checked: `true` is the defaults; a mistake fails the boot. */
export function parsePersistentQuestionsOptions(persistent: unknown): PersistentQuestionsOptionsInterface {
  const parsed = persistentQuestionsOptionsSchema.safeParse(persistent === true ? {} : persistent);
  if (!parsed.success) {
    throw new InvalidQuestionStoreError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return { ...parsed.data, storage: parsed.data.storage as PersistentQuestionsStorage | undefined };
}

/** A scope's persistent questions: the store, and how long a question is kept unless its call says otherwise. */
export interface PersistentQuestions {
  store: QuestionStore;
  ttlMs: number;
  type: QuestionStoreResult['type'];
}

/** Open the store `elicitation.persistent` asks for; undefined while it is off. */
export async function openPersistentQuestions(options: {
  persistent: unknown;
  redis?: unknown;
  sqlite?: SqliteAdapterOptions;
  logger: FrontMcpLogger;
}): Promise<PersistentQuestions | undefined> {
  const { persistent, logger } = options;
  if (!persistent) return undefined;
  const settings = parsePersistentQuestionsOptions(persistent);
  const storage = await resolveQuestionStorage({
    storage: settings.storage,
    redis: options.redis,
    sqlite: options.sqlite,
  });
  const { store, type, encrypted } = await createQuestionStore({ storage, logger });
  logger.info('Persistent questions are on', { type, encrypted });
  return { store, type, ttlMs: settings.ttlMs ?? DEFAULT_QUESTION_TTL_MS };
}
