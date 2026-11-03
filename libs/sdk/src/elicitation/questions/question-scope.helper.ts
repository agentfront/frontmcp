import { internalZ as z } from '@frontmcp/lazy-zod';
import { sha256Hex, type SqliteAdapterOptions } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { type RawZodShape } from '../../common/types/common.types';
import {
  type InboxLinks,
  type PersistentQuestionsOptionsInterface,
  type PersistentQuestionsStorage,
} from '../../common/types/options/elicitation';
import { createQuestionStore, resolveQuestionStorage, type QuestionStoreResult } from './question-store.factory';
import { InvalidQuestionStoreError } from './question.errors';
import { type QuestionStore } from './question.store';

/** @default 24 hours */
export const DEFAULT_QUESTION_TTL_MS = 86_400_000;

const persistentQuestionsOptionsSchema = z
  .object(
    {
      ttlMs: z
        .number({ message: 'ttlMs must be a number of milliseconds' })
        .int('ttlMs must be a whole number of milliseconds')
        .positive('ttlMs must be greater than 0')
        .optional(),
      storage: z
        .object({
          type: z.enum(['memory', 'redis', 'sqlite'], {
            message: "storage.type must be 'memory', 'redis' or 'sqlite'",
          }),
        })
        .passthrough()
        .optional(),
      inboxLinks: z
        .enum(['terminal', 'stderr', 'off'], { message: "inboxLinks must be 'terminal', 'stderr' or 'off'" })
        .optional(),
    } satisfies RawZodShape<PersistentQuestionsOptionsInterface>,
    {
      error: (issue) => (issue.code === 'invalid_type' ? 'it must be true, false or an object of settings' : undefined),
    },
  )
  .strict();

/** `elicitation.persistent`, checked: `true` is the defaults; a mistake fails the boot. */
export function parsePersistentQuestionsOptions(persistent: unknown): PersistentQuestionsOptionsInterface {
  const parsed = persistentQuestionsOptionsSchema.safeParse(persistent === true ? {} : persistent);
  if (!parsed.success) {
    throw new InvalidQuestionStoreError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return { ...parsed.data, storage: parsed.data.storage as PersistentQuestionsStorage | undefined };
}

/** A scope's persistent questions: the store, a question's default TTL, and where inbox links go. */
export interface PersistentQuestions {
  store: QuestionStore;
  ttlMs: number;
  type: QuestionStoreResult['type'];
  inboxLinks: InboxLinks;
}

/** Open the store `elicitation.persistent` asks for, keyed apart from other servers on it; undefined while it is off. */
export async function openPersistentQuestions(options: {
  persistent: unknown;
  /** `info.name`: servers of another name that share the storage do not share its questions. */
  serverName?: string;
  redis?: unknown;
  sqlite?: SqliteAdapterOptions;
  logger: FrontMcpLogger;
}): Promise<PersistentQuestions | undefined> {
  const { persistent, serverName = '', logger } = options;
  if (!persistent) return undefined;
  const settings = parsePersistentQuestionsOptions(persistent);
  const storage = await resolveQuestionStorage({
    storage: settings.storage,
    redis: options.redis,
    sqlite: options.sqlite,
  });
  const keyPrefix = `mcp:questions:${sha256Hex(`server:${serverName}`).slice(0, 16)}:`;
  const { store, type, encrypted } = await createQuestionStore({ storage, keyPrefix, logger });
  logger.info('Persistent questions are on', { type, encrypted });
  return {
    store,
    type,
    ttlMs: settings.ttlMs ?? DEFAULT_QUESTION_TTL_MS,
    inboxLinks: settings.inboxLinks ?? 'terminal',
  };
}
