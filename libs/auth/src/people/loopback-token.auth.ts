import { base64urlEncode, randomBytes, sha256, timingSafeEqual } from '@frontmcp/utils';

import type { PeopleAuthOptions } from './people-auth.options';

/** The cookie a signed-in browser presents. */
export const PEOPLE_SESSION_COOKIE = 'frontmcp_people';

/** A signed-in browser. */
export interface PeopleSession {
  readonly expiresAt: number;
  /** The MCP subject this person answers for: set when the sign-in code was made for it (`createCode({ subject })`). */
  readonly subject?: string;
}

export interface PeopleSignInRefusal {
  ok: false;
  /** `invalid`: a wrong, used or expired token or code; `locked`: too many of them from this client. */
  reason: 'invalid' | 'locked';
}

export type PeopleCodeIssue = { ok: true; code: string; expiresAt: number } | PeopleSignInRefusal;

export type PeopleSessionIssue = { ok: true; cookieValue: string; expiresAt: number } | PeopleSignInRefusal;

interface StoredSecret {
  digest: Uint8Array;
  expiresAt: number;
  subject?: string;
}

interface ClientFailures {
  count: number;
  lastAt: number;
  lockedUntil: number;
}

const INVALID: PeopleSignInRefusal = { ok: false, reason: 'invalid' };
const LOCKED: PeopleSignInRefusal = { ok: false, reason: 'locked' };
const MAX_TRACKED_CLIENTS = 1024;

function newSecret(): string {
  return base64urlEncode(randomBytes(32));
}

/** Compares digests, so neither the time taken nor the equal-length requirement depends on what was presented. */
function matches(presented: string, digest: Uint8Array): boolean {
  return timingSafeEqual(sha256(presented), digest);
}

function unexpired(secrets: StoredSecret[]): StoredSecret[] {
  const now = Date.now();
  return secrets.filter((secret) => secret.expiresAt > now);
}

/**
 * People auth for a server's own pages: a token printed once at startup buys one-time sign-in codes, and a code,
 * posted from the server's own page, buys a session cookie. Only digests of the token, codes and sessions are kept.
 */
export class LoopbackTokenAuth {
  private token?: string;
  private readonly tokenDigest: Uint8Array;
  private codes: StoredSecret[] = [];
  private sessions: StoredSecret[] = [];
  private readonly failures = new Map<string, ClientFailures>();

  constructor(readonly options: PeopleAuthOptions) {
    const token = newSecret();
    this.token = token;
    this.tokenDigest = sha256(token);
  }

  /** The token, the first time it is asked for: the server prints it at startup, and nothing can read it after. */
  takeToken(): string | undefined {
    const token = this.token;
    this.token = undefined;
    return token;
  }

  /**
   * A one-time sign-in code, for a caller this process already trusts, such as a tool. A code made for a `subject`
   * signs the person in for that subject only; a code without one, such as the token's, for none.
   */
  createCode(options: { subject?: string } = {}): { code: string; expiresAt: number } {
    const code = newSecret();
    const expiresAt = Date.now() + this.options.codeTtlMs;
    const { subject } = options;
    this.codes = [...unexpired(this.codes), { digest: sha256(code), expiresAt, ...(subject ? { subject } : {}) }];
    return { code, expiresAt };
  }

  /** A one-time sign-in code for the holder of the token. */
  exchangeToken(presented: string | undefined, client: string): PeopleCodeIssue {
    if (this.isLocked(client)) return LOCKED;
    if (presented === undefined || !matches(presented, this.tokenDigest)) return this.refuse(client);
    this.failures.delete(client);
    return { ok: true, ...this.createCode() };
  }

  /** A session for the holder of a code; the code is spent. */
  exchangeCode(presented: string | undefined, client: string): PeopleSessionIssue {
    if (this.isLocked(client)) return LOCKED;
    this.codes = unexpired(this.codes);
    const index = presented === undefined ? -1 : this.codes.findIndex((code) => matches(presented, code.digest));
    if (index === -1) return this.refuse(client);
    const [{ subject }] = this.codes.splice(index, 1);
    this.failures.delete(client);
    const cookieValue = newSecret();
    const expiresAt = Date.now() + this.options.sessionTtlMs;
    this.sessions = [
      ...unexpired(this.sessions),
      { digest: sha256(cookieValue), expiresAt, ...(subject ? { subject } : {}) },
    ];
    return { ok: true, cookieValue, expiresAt };
  }

  verifySession(presented: string | undefined): PeopleSession | undefined {
    if (!presented) return undefined;
    this.sessions = unexpired(this.sessions);
    const session = this.sessions.find((stored) => matches(presented, stored.digest));
    if (!session) return undefined;
    return session.subject
      ? { expiresAt: session.expiresAt, subject: session.subject }
      : { expiresAt: session.expiresAt };
  }

  endSession(presented: string | undefined): void {
    if (!presented) return;
    this.sessions = this.sessions.filter((stored) => !matches(presented, stored.digest));
  }

  private isLocked(client: string): boolean {
    return (this.failures.get(client)?.lockedUntil ?? 0) > Date.now();
  }

  private refuse(client: string): PeopleSignInRefusal {
    const now = Date.now();
    const { maxFailedAttempts, lockoutMs } = this.options;
    const previous = this.failures.get(client);
    const count = previous && now - previous.lastAt <= lockoutMs ? previous.count + 1 : 1;
    const locked = count >= maxFailedAttempts;
    if (!previous && this.failures.size >= MAX_TRACKED_CLIENTS) this.forgetIdleClients(now);
    this.failures.set(client, { count: locked ? 0 : count, lastAt: now, lockedUntil: locked ? now + lockoutMs : 0 });
    return locked ? LOCKED : INVALID;
  }

  private forgetIdleClients(now: number): void {
    for (const [client, failures] of this.failures) {
      if (failures.lockedUntil <= now && now - failures.lastAt > this.options.lockoutMs) this.failures.delete(client);
    }
  }
}

export interface PeopleSessionCookie {
  name: string;
  value: string;
  path: string;
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  /** Seconds. */
  maxAge: number;
}

/** The session cookie: HttpOnly, SameSite=Strict, scoped to `path`, and Secure when the page is served over https. */
export function peopleSessionCookie(
  value: string,
  options: { path: string; secure: boolean; maxAgeMs: number },
): PeopleSessionCookie {
  return {
    name: PEOPLE_SESSION_COOKIE,
    value,
    path: options.path,
    httpOnly: true,
    sameSite: 'strict',
    secure: options.secure,
    maxAge: Math.floor(options.maxAgeMs / 1000),
  };
}
