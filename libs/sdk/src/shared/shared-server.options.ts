import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';

import { InvalidSharedServerOptionsError } from '../errors/shared-server.errors';

/** How sessions reach a shared local server: an owner-only Unix socket, or loopback HTTP. */
export type SharedServerTransport = 'unix' | 'http';

export interface SharedServerOptions {
  /** Names the server: every session started with the same key on this machine shares one server process. */
  key: string;
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
}

export interface ResolvedSharedServerOptions {
  key: string;
  transport: SharedServerTransport;
  attachBudgetMs: number;
  replaceOlder: boolean;
  idleTimeoutMs: number | false;
  checkout: string | false;
}

const DEFAULT_ATTACH_BUDGET_MS = 15_000;
const MAX_ATTACH_BUDGET_MS = 600_000;
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const MAX_IDLE_TIMEOUT_MS = 604_800_000;

// Lowercase, and no trailing dot: a case-insensitive file system, or Windows, would give two keys one folder.
const KEY_FORMAT =
  'key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit';
const WINDOWS_DEVICE = "key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)";
const ATTACH_BUDGET = `attachBudgetMs must be a whole number of milliseconds from 1 to ${MAX_ATTACH_BUDGET_MS}`;
const IDLE_TIMEOUT = `idleTimeoutMs must be a whole number of milliseconds from 1 to ${MAX_IDLE_TIMEOUT_MS}, or false`;
const CHECKOUT = 'checkout must be the path of a folder, or false';

function milliseconds(max: number, message: string) {
  return z.number({ message }).int(message).min(1, message).max(max, message);
}

const sharedServerOptionsSchema = z
  .object({
    key: z
      .string({ message: 'key is required' })
      .regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, KEY_FORMAT)
      .refine((key) => !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/.test(key), WINDOWS_DEVICE),
    transport: z.enum(['unix', 'http'], { message: "transport must be 'unix' or 'http'" }).optional(),
    attachBudgetMs: milliseconds(MAX_ATTACH_BUDGET_MS, ATTACH_BUDGET).optional(),
    replaceOlder: z.boolean({ message: 'replaceOlder must be true or false' }).optional(),
    idleTimeoutMs: z
      .union([milliseconds(MAX_IDLE_TIMEOUT_MS, IDLE_TIMEOUT), z.literal(false)], { message: IDLE_TIMEOUT })
      .optional(),
    checkout: z
      .union(
        [
          z
            .string()
            .min(1, CHECKOUT)
            .refine((folder) => !folder.includes('\0'), CHECKOUT),
          z.literal(false),
        ],
        { message: CHECKOUT },
      )
      .optional(),
  })
  .strict();

/**
 * Validate `runShared()`'s options and resolve the transport for `platform`, and the checkout: the folder of `entry`,
 * the file the process runs, or the working folder without one.
 */
export function parseSharedServerOptions(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
  entry?: string,
): ResolvedSharedServerOptions {
  const result = sharedServerOptionsSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(({ path: at, message }) =>
      at.length ? `${at.join('.')}: ${message}` : message,
    );
    throw new InvalidSharedServerOptionsError(issues.join('; '));
  }
  const { key, transport = platform === 'win32' ? 'http' : 'unix', checkout } = result.data;
  if (transport === 'unix' && platform === 'win32') {
    throw new InvalidSharedServerOptionsError(
      "transport: a Unix socket can't be kept owner-only on Windows; use transport 'http'",
    );
  }
  return {
    key,
    transport,
    attachBudgetMs: result.data.attachBudgetMs ?? DEFAULT_ATTACH_BUDGET_MS,
    replaceOlder: result.data.replaceOlder ?? true,
    idleTimeoutMs: result.data.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    checkout: checkout === false ? false : path.resolve(checkout ?? (entry ? path.dirname(entry) : process.cwd())),
  };
}
