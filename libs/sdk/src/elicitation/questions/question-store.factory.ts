import {
  createChangeFeed,
  createStorage,
  getEnv,
  getRuntimeContext,
  lstat,
  mkdir,
  realpath,
  writeFile,
  type RootStorage,
  type SqliteAdapterOptions,
} from '@frontmcp/utils';

import { isRedisProvider, redisOptionsSchema, type FrontMcpLogger } from '../../common';
import { type PersistentQuestionsStorage } from '../../common/types/options/elicitation';
import { findReplaceableDirectory } from '../../server/security/replaceable-directory';
import { getElicitationSecret } from '../store/elicitation-encryption';
import { InvalidQuestionStoreError } from './question.errors';
import { QuestionStore } from './question.store';

const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const GROUP_OR_OTHER_ACCESS = 0o077;

export interface QuestionStoreFactoryOptions {
  storage: PersistentQuestionsStorage;
  /** @default 'mcp:questions:' */
  keyPrefix?: string;
  /** `'auto'` (the default) encrypts when a secret is given or `MCP_ELICITATION_SECRET` (or a fallback) is set. */
  encryption?: { enabled?: boolean | 'auto'; secret?: string };
  /** How often a SQLite store checks for another process's write, in milliseconds. */
  pollIntervalMs?: number;
  /** Changes within this window wake the waiting calls and the inbox once, in milliseconds. */
  coalesceMs?: number;
  logger?: FrontMcpLogger;
}

export interface QuestionStoreResult {
  store: QuestionStore;
  type: PersistentQuestionsStorage['type'];
  encrypted: boolean;
  /** The storage the store owns, for inspection. */
  storage: RootStorage;
}

/** Open a question store through the storage factory, with its change feed; an unusable backend fails, never falls back. */
export async function createQuestionStore(options: QuestionStoreFactoryOptions): Promise<QuestionStoreResult> {
  const { storage: config, keyPrefix = 'mcp:questions:', encryption, pollIntervalMs, coalesceMs, logger } = options;
  const enabled = encryption?.enabled ?? 'auto';
  const secret = enabled === false ? undefined : (encryption?.secret ?? getElicitationSecret() ?? undefined);
  if (enabled === true && !secret) {
    throw new InvalidQuestionStoreError(
      'encryption is on but no secret is set: set MCP_ELICITATION_SECRET (or MCP_SESSION_SECRET / MCP_SERVER_SECRET)',
    );
  }
  let storage: RootStorage;
  try {
    storage = await createStorage({ ...config, prefix: keyPrefix, fallback: 'error' });
  } catch (error) {
    throw new InvalidQuestionStoreError(
      `the ${config.type} store cannot be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const feed = createChangeFeed(storage, {
    pollIntervalMs,
    coalesceMs,
    onError: (error) => logger?.warn('Persistent questions: a change notification failed', error),
  });
  return { store: new QuestionStore({ storage, feed, secret }), type: config.type, encrypted: !!secret, storage };
}

export interface QuestionStorageSources {
  /** `elicitation.persistent.storage`. */
  storage?: PersistentQuestionsStorage;
  /** `elicitation.redis`, else the server's `redis`. */
  redis?: unknown;
  /** The server's `sqlite`, with its path resolved. */
  sqlite?: SqliteAdapterOptions;
}

/**
 * Where questions are kept: `elicitation.persistent.storage`, else the server's Redis, else its SQLite file, else
 * `questions.sqlite` in `$FRONTMCP_HOME` (`~/.frontmcp`), made owner-only, and refused when another user could read
 * or replace it. Serverless and edge runtimes have no default: a question there must outlive the instance, so they
 * need a store that is named.
 */
export async function resolveQuestionStorage(sources: QuestionStorageSources): Promise<PersistentQuestionsStorage> {
  if (sources.storage) return sources.storage;
  const redis = sources.redis === undefined ? undefined : redisOptionsSchema.safeParse(sources.redis);
  if (redis?.success && isRedisProvider(redis.data)) {
    const { host, port, password, db, tls } = redis.data;
    return { type: 'redis', redis: { config: { host, port, password, db, tls } } };
  }
  if (sources.sqlite) return { type: 'sqlite', sqlite: sources.sqlite };
  const { runtime, deployment } = getRuntimeContext();
  if (runtime !== 'node' || deployment === 'serverless') {
    throw new InvalidQuestionStoreError(
      'this runtime has no default store for questions: set elicitation.persistent.storage, or the server redis',
    );
  }
  const path = nodePath();
  const home = getEnv('FRONTMCP_HOME') || path.join(nodeOs().homedir(), '.frontmcp');
  const file = path.join(home, 'questions.sqlite');
  await mkdir(home, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  if (process.platform !== 'win32') await assertNoOtherUserCanReplace(home);
  await writeFile(file, '', { mode: OWNER_ONLY_FILE, flag: 'a' });
  if (process.platform !== 'win32') await assertOwnerOnlyFile(file);
  return { type: 'sqlite', sqlite: { path: file } };
}

async function assertNoOtherUserCanReplace(home: string): Promise<void> {
  for (const directory of new Set([home, await realpath(home)])) {
    const replaceable = await findReplaceableDirectory(directory);
    if (!replaceable) continue;
    const { ownerUid } = replaceable;
    const reason =
      ownerUid === undefined ? 'the group or others can write to it' : `it belongs to another user (uid ${ownerUid})`;
    throw new InvalidQuestionStoreError(
      `refusing the default store under ${replaceable.directory}: ${reason}. ` +
        'Set FRONTMCP_HOME to a folder only you can write to, or elicitation.persistent.storage',
    );
  }
}

async function assertOwnerOnlyFile(file: string): Promise<void> {
  const stats = await lstat(file);
  const reason = !stats.isFile()
    ? 'it is not a regular file'
    : stats.uid !== process.getuid?.()
      ? `it belongs to another user (uid ${stats.uid})`
      : stats.mode & GROUP_OR_OTHER_ACCESS
        ? 'the group or others can read it'
        : undefined;
  if (reason) {
    throw new InvalidQuestionStoreError(`refusing the default store ${file}: ${reason}; make it owner-only (0600)`);
  }
}

/** Node's `os` and `path`, loaded on first use: the default file is Node-only and a browser bundle must not load them. */
function nodeOs(): typeof import('os') {
  return require('os');
}

function nodePath(): typeof import('path') {
  return require('path');
}
