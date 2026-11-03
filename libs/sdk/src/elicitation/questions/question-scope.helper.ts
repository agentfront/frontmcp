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

/**
 * Why an edge runtime cannot keep questions. `upstash` and `vercel-kv` would reach it over HTTP, but they have no atomic
 * compare-and-set (`setIfEquals`), which answering and handing over a question needs.
 */
const NOT_ON_EDGE_RUNTIME =
  'it is not available on an edge runtime: a question must outlive the isolate that asked it, and none of its stores ' +
  "runs there ('redis' needs a TCP connection, 'sqlite' a local file, and 'memory' ends with the isolate). Run the " +
  'server on Node.js to keep questions, or turn elicitation.persistent off';

/** `elicitation.persistent`, checked for where the server runs: a mistake, or an edge runtime, fails the boot. */
export function persistentQuestionsSettings(
  persistent: unknown,
  onEdgeRuntime: boolean,
): PersistentQuestionsOptionsInterface {
  const settings = parsePersistentQuestionsOptions(persistent);
  if (onEdgeRuntime) throw new InvalidQuestionStoreError(NOT_ON_EDGE_RUNTIME);
  return settings;
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
  /** Whether the server runs on an edge runtime, where no store of a question runs. */
  onEdgeRuntime?: boolean;
  logger: FrontMcpLogger;
}): Promise<PersistentQuestions | undefined> {
  const { persistent, serverName = '', logger } = options;
  if (!persistent) return undefined;
  const settings = persistentQuestionsSettings(persistent, options.onEdgeRuntime ?? false);
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
