import { internalZ as z } from '@frontmcp/lazy-zod';

const MINUTE_MS = 60_000;

/** How people sign in to a server's `@HttpRoute` pages: a token printed at startup, a one-time code, then a cookie. */
export interface LoopbackTokenPeopleAuthOptions {
  mode: 'loopback-token';
  /** How long a one-time sign-in code stays valid, at most 10 minutes. @default 60000 */
  codeTtlMs?: number;
  /** How long a browser stays signed in. @default 43200000 (12 hours) */
  sessionTtlMs?: number;
  /** Bad tokens or codes a client may send before it is locked out. @default 5 */
  maxFailedAttempts?: number;
  /** How long a locked-out client waits, and how long a bad attempt is remembered. @default 60000 */
  lockoutMs?: number;
  /** The `Path` of the session cookie. @default '/' */
  cookiePath?: string;
}

/** `http.auth.people`: `'loopback-token'`, or the same mode with its settings. */
export type PeopleAuthOption = 'loopback-token' | LoopbackTokenPeopleAuthOptions;

export type PeopleAuthOptions = Required<LoopbackTokenPeopleAuthOptions>;

function milliseconds(field: string) {
  return z
    .number({ message: `${field} must be a number of milliseconds` })
    .int(`${field} must be a whole number of milliseconds`)
    .positive(`${field} must be greater than 0`);
}

const loopbackTokenSchema = z
  .object({
    mode: z.literal('loopback-token'),
    codeTtlMs: milliseconds('codeTtlMs')
      .max(10 * MINUTE_MS, 'codeTtlMs must be at most 600000 (10 minutes): a sign-in code is for one hand-off')
      .optional(),
    sessionTtlMs: milliseconds('sessionTtlMs').optional(),
    maxFailedAttempts: z
      .number({ message: 'maxFailedAttempts must be a number' })
      .int('maxFailedAttempts must be a whole number')
      .positive('maxFailedAttempts must be greater than 0')
      .optional(),
    lockoutMs: milliseconds('lockoutMs').optional(),
    cookiePath: z.string().startsWith('/', 'cookiePath must start with "/"').optional(),
  })
  .strict();

export const peopleAuthOptionsSchema = z
  .union([z.literal('loopback-token'), loopbackTokenSchema], {
    message: "http.auth.people must be 'loopback-token' or { mode: 'loopback-token', ... }",
  })
  .transform((value): PeopleAuthOptions => {
    const settings: Partial<LoopbackTokenPeopleAuthOptions> = typeof value === 'string' ? {} : value;
    return {
      mode: 'loopback-token',
      codeTtlMs: settings.codeTtlMs ?? MINUTE_MS,
      sessionTtlMs: settings.sessionTtlMs ?? 12 * 60 * MINUTE_MS,
      maxFailedAttempts: settings.maxFailedAttempts ?? 5,
      lockoutMs: settings.lockoutMs ?? MINUTE_MS,
      cookiePath: settings.cookiePath ?? '/',
    };
  });
