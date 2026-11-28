import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';

import { InvalidSharedServerOptionsError } from '../errors/shared-server.errors';

/** How sessions reach a shared local server: an owner-only Unix socket, or loopback HTTP. */
export type SharedServerTransport = 'unix' | 'http';

/** A function a session reads its key with: when it starts, and again each time `rereadKey` fires. */
export type SharedServerKeyFunction = () => string | Promise<string>;

/** When a session whose `key` is a function reads it again. */
export interface SharedServerKeyReread {
  /** The file whose change re-reads the key: it appears, goes, or its size or modification time changes. */
  file: string;
  /** How often the file is checked. @default 1000 */
  intervalMs?: number;
}

export interface SharedServerOptions {
  /** Names the server; a function is read at the start and on `rereadKey`, and a new key moves the session. */
  key: string | SharedServerKeyFunction;
  /** @default 'unix', or 'http' on Windows */
  transport?: SharedServerTransport;
  /**
   * How long a session tries to reach the key's server, starting or replacing it when needed, before it runs the
   * server in its own process instead.
   * @default 15000
   */
  attachBudgetMs?: number;
  /**
   * Whether a session that finds a server older than its own `info.version` drains it and starts its own; when
   * `false`, it runs the server in its own process and leaves the older one running.
   * @default true
   */
  replaceOlder?: boolean;
  /** How long the server keeps running without a request before it exits; `false` keeps it running. @default 600000 */
  idleTimeoutMs?: number | false;
  /** The folder the server runs from: it exits once that folder is removed; `false` never. @default the entry's folder */
  checkout?: string | false;
  /**
   * Boot the server in the session's own process while the session attaches, so a session that can't attach serves its
   * client at once, without booting it then. The spare serves nothing until it is needed, and is shut down once the
   * session attached. @default false
   */
  spare?: boolean;
  /** When a function `key` is read again (see {@link SharedServerKeyReread}); without it, it is read once. */
  rereadKey?: SharedServerKeyReread;
  /** By key, the entry that starts the server of a key the session moves to; it starts no other key's server. */
  entries?: Record<string, string>;
}

export interface ResolvedSharedServerOptions {
  /** The key: the string, or what the function answered when the session started. */
  key: string;
  transport: SharedServerTransport;
  attachBudgetMs: number;
  replaceOlder: boolean;
  idleTimeoutMs: number | false;
  checkout: string | false;
  spare: boolean;
  /** The function `key`, which the session reads again. */
  keySource?: SharedServerKeyFunction;
  rereadKey?: Required<SharedServerKeyReread>;
  /** The entries of the keys a session may start a server for, by key, with absolute paths. */
  entries: Readonly<Record<string, string>>;
}

const DEFAULT_ATTACH_BUDGET_MS = 15_000;
const MAX_ATTACH_BUDGET_MS = 600_000;
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const MAX_IDLE_TIMEOUT_MS = 604_800_000;
const DEFAULT_REREAD_INTERVAL_MS = 1_000;
const MAX_REREAD_INTERVAL_MS = 600_000;

// Lowercase, and no trailing dot: a case-insensitive file system, or Windows, would give two keys one folder.
const KEY_PATTERN = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;
const WINDOWS_DEVICE_PATTERN = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/;
const KEY_FORMAT =
  'key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit';
const WINDOWS_DEVICE = "key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)";
const KEY_TYPE = 'key is required: a string, or a function that answers one';
const ATTACH_BUDGET = `attachBudgetMs must be a whole number of milliseconds from 1 to ${MAX_ATTACH_BUDGET_MS}`;
const IDLE_TIMEOUT = `idleTimeoutMs must be a whole number of milliseconds from 1 to ${MAX_IDLE_TIMEOUT_MS}, or false`;
const CHECKOUT = 'checkout must be the path of a folder, or false';
const SPARE = 'spare must be true or false';
const REREAD = `rereadKey must be { file, intervalMs? }: the path of a file, and 1 to ${MAX_REREAD_INTERVAL_MS} ms`;
const ENTRY = 'entries must map keys to the paths of entry files';
const NEEDS_KEY_FUNCTION = 'needs a function key, which the session reads again';

function milliseconds(max: number, message: string) {
  return z.number({ message }).int(message).min(1, message).max(max, message);
}

const filePath = (message: string) =>
  z
    .string({ message })
    .min(1, message)
    .refine((value) => !value.includes('\0'), message);

const keySchema = z
  .string({ message: KEY_TYPE })
  .regex(KEY_PATTERN, KEY_FORMAT)
  .refine((key) => !WINDOWS_DEVICE_PATTERN.test(key), WINDOWS_DEVICE);

const sharedServerOptionsSchema = z
  .object({
    key: z.unknown().optional(),
    transport: z.enum(['unix', 'http'], { message: "transport must be 'unix' or 'http'" }).optional(),
    attachBudgetMs: milliseconds(MAX_ATTACH_BUDGET_MS, ATTACH_BUDGET).optional(),
    replaceOlder: z.boolean({ message: 'replaceOlder must be true or false' }).optional(),
    idleTimeoutMs: z
      .union([milliseconds(MAX_IDLE_TIMEOUT_MS, IDLE_TIMEOUT), z.literal(false)], { message: IDLE_TIMEOUT })
      .optional(),
    checkout: z.union([filePath(CHECKOUT), z.literal(false)], { message: CHECKOUT }).optional(),
    spare: z.boolean({ message: SPARE }).optional(),
    rereadKey: z
      .object(
        { file: filePath(REREAD), intervalMs: milliseconds(MAX_REREAD_INTERVAL_MS, REREAD).optional() },
        { message: REREAD },
      )
      .strict()
      .optional(),
    entries: z.record(keySchema, filePath(ENTRY), { message: ENTRY }).optional(),
  })
  .strict()
  .superRefine(({ key }, context) => {
    // A function is read later; a string must be a key, whose issue names what is wrong with it
    if (typeof key === 'function') return;
    if (typeof key !== 'string') {
      context.addIssue({ code: 'custom', path: ['key'], message: KEY_TYPE });
      return;
    }
    for (const issue of keySchema.safeParse(key).error?.issues ?? []) {
      context.addIssue({ code: 'custom', path: ['key'], message: issue.message });
    }
  });

type ValidatedOptions = Omit<ResolvedSharedServerOptions, 'key' | 'keySource'> & {
  key: string | SharedServerKeyFunction;
};

/** Validate `runShared()`'s options; the key stays a function when it is one. */
export function validateSharedServerOptions(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
  entry?: string,
): ValidatedOptions {
  const result = sharedServerOptionsSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(({ path: at, message }) =>
      at.length ? `${at.join('.')}: ${message}` : message,
    );
    throw new InvalidSharedServerOptionsError(issues.join('; '));
  }
  const { transport = platform === 'win32' ? 'http' : 'unix', checkout, rereadKey, entries } = result.data;
  const key = result.data.key as string | SharedServerKeyFunction;
  if (transport === 'unix' && platform === 'win32') {
    throw new InvalidSharedServerOptionsError(
      "transport: a Unix socket can't be kept owner-only on Windows; use transport 'http'",
    );
  }
  if (typeof key === 'string' && rereadKey) {
    throw new InvalidSharedServerOptionsError(`rereadKey: rereadKey ${NEEDS_KEY_FUNCTION}`);
  }
  if (typeof key === 'string' && entries) {
    throw new InvalidSharedServerOptionsError(`entries: entries ${NEEDS_KEY_FUNCTION}`);
  }
  return {
    key,
    transport,
    attachBudgetMs: result.data.attachBudgetMs ?? DEFAULT_ATTACH_BUDGET_MS,
    replaceOlder: result.data.replaceOlder ?? true,
    idleTimeoutMs: result.data.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    checkout: checkout === false ? false : path.resolve(checkout ?? (entry ? path.dirname(entry) : process.cwd())),
    spare: result.data.spare ?? false,
    ...(rereadKey
      ? {
          rereadKey: {
            file: path.resolve(rereadKey.file),
            intervalMs: rereadKey.intervalMs ?? DEFAULT_REREAD_INTERVAL_MS,
          },
        }
      : {}),
    entries: Object.freeze(
      Object.fromEntries(Object.entries(entries ?? {}).map(([name, file]) => [name, path.resolve(file)])),
    ),
  };
}

/** {@link validateSharedServerOptions} for a string key: the checkout is the folder of `entry`, else the cwd. */
export function parseSharedServerOptions(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
  entry?: string,
): ResolvedSharedServerOptions {
  const { key, ...options } = validateSharedServerOptions(input, platform, entry);
  if (typeof key !== 'string') {
    throw new InvalidSharedServerOptionsError('key: a function key is read when the session starts');
  }
  return { ...options, key };
}

/** Whether `value` is a key a shared server can have: its folder is the same on every file system. */
export function isSharedServerKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value) && !WINDOWS_DEVICE_PATTERN.test(value);
}

/** What a key function answers: a key, or why it gave none (it threw, or answered something that is not a key). */
export async function readSharedServerKey(
  source: SharedServerKeyFunction,
): Promise<{ key: string } | { error: string }> {
  let answer: unknown;
  try {
    answer = await source();
  } catch (error) {
    return { error: `the key function failed (${error instanceof Error ? error.message : String(error)})` };
  }
  if (isSharedServerKey(answer)) return { key: answer };
  return { error: `the key function answered ${JSON.stringify(answer) ?? String(answer)}, and ${KEY_FORMAT}` };
}
