import { base64urlEncode, randomBytes, sha256, timingSafeEqual, type StorageAdapter } from '@frontmcp/utils';

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

/** Where sessions are kept besides memory, so they survive a restart, and who hears when that store fails. */
export interface PeopleSessionPersistence {
  store: Pick<StorageAdapter, 'get' | 'set' | 'delete'>;
  onError?: (message: string, error: unknown) => void;
}

interface StoredSecret {
  digest: Uint8Array;
  expiresAt: number;
  subject?: string;
}

/** A signed-out session the store may still hold: refused here until the store removes it, or it would have expired. */
interface Revocation {
  expiresAt: number;
  removing: boolean;
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

function toSession({ expiresAt, subject }: Omit<StoredSecret, 'digest'>): PeopleSession {
  return subject ? { expiresAt, subject } : { expiresAt };
}

/** A session is kept under the digest of its cookie value, never the value itself. */
function sessionKey(digest: Uint8Array): string {
  return `session:${base64urlEncode(digest)}`;
}

function keptSession(raw: string | null): PeopleSession | undefined {
  if (raw === null) return undefined;
  try {
    const { expiresAt, subject } = JSON.parse(raw) as { expiresAt?: unknown; subject?: unknown };
    if (typeof expiresAt !== 'number' || (subject !== undefined && typeof subject !== 'string')) return undefined;
    return toSession({ expiresAt, subject });
  } catch {
    return undefined;
  }
}

/**
 * People auth for a server's own pages: a token printed once at startup buys one-time sign-in codes, and a code,
 * posted from the server's own page, buys a session cookie. Only digests of the token, codes and sessions are kept.
 * With a {@link PeopleSessionPersistence} store, sessions are kept there too, so they outlive the process; the token,
 * codes and lockouts stay in memory.
 */
export class LoopbackTokenAuth {
  private token?: string;
  private readonly tokenDigest: Uint8Array;
  private codes: StoredSecret[] = [];
  private sessions: StoredSecret[] = [];
  private readonly failures = new Map<string, ClientFailures>();
  private readonly writes = new Set<Promise<void>>();
  /** By store key, the signed-out sessions whose removal from the store has not succeeded yet. */
  private readonly revoked = new Map<string, Revocation>();

  constructor(
    readonly options: PeopleAuthOptions,
    private readonly persistence?: PeopleSessionPersistence,
  ) {
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
    const digest = sha256(cookieValue);
    this.sessions = [...unexpired(this.sessions), { digest, expiresAt, ...(subject ? { subject } : {}) }];
    this.keep(digest, toSession({ expiresAt, subject }));
    return { ok: true, cookieValue, expiresAt };
  }

  /** A session this process made; {@link findSession} also finds one kept in the store. */
  verifySession(presented: string | undefined): PeopleSession | undefined {
    if (!presented) return undefined;
    this.sessions = unexpired(this.sessions);
    const session = this.sessions.find((stored) => matches(presented, stored.digest));
    return session ? toSession(session) : undefined;
  }

  /**
   * A session this process made, else one kept in the store; a store that cannot be read finds none. A session signed
   * out here is refused while the store still holds it.
   */
  async findSession(presented: string | undefined): Promise<PeopleSession | undefined> {
    const known = this.verifySession(presented);
    const store = this.persistence?.store;
    if (known || !presented || !store) return known;
    const key = sessionKey(sha256(presented));
    if (this.isRevoked(key)) {
      this.removeKept(key);
      return undefined;
    }
    let raw: string | null;
    try {
      raw = await store.get(key);
    } catch (error) {
      this.report('a kept people session could not be read', error);
      return undefined;
    }
    if (this.isRevoked(key)) return undefined;
    const session = keptSession(raw);
    return session && session.expiresAt > Date.now() ? session : undefined;
  }

  /**
   * Signs the person out. With a store, the session is removed from it too, and refused here until that succeeds: a
   * removal that fails is tried again when the cookie comes back and at the next {@link flush}, until the session
   * would have expired.
   */
  endSession(presented: string | undefined): void {
    if (!presented) return;
    const known = this.verifySession(presented);
    this.sessions = this.sessions.filter((stored) => !matches(presented, stored.digest));
    const store = this.persistence?.store;
    if (!store) return;
    this.forgetExpiredRevocations();
    const key = sessionKey(sha256(presented));
    if (!this.revoked.has(key)) {
      // A session from the store has an unknown expiry, which is at most a full session TTL away.
      const expiresAt = known?.expiresAt ?? Date.now() + this.options.sessionTtlMs;
      this.revoked.set(key, { expiresAt, removing: false });
    }
    this.removeKept(key);
  }

  /**
   * Waits for the session writes in flight, so a session handed out is kept before the answer goes. A sign-out the
   * store could not remove is tried again first.
   */
  async flush(): Promise<void> {
    this.forgetExpiredRevocations();
    for (const key of this.revoked.keys()) this.removeKept(key);
    await Promise.all(this.writes);
  }

  private keep(digest: Uint8Array, session: PeopleSession): void {
    const store = this.persistence?.store;
    if (!store) return;
    const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
    const write = store.set(sessionKey(digest), JSON.stringify(session), { ttlSeconds });
    this.track(write, 'a people session could not be kept, so a restart ends it');
  }

  /** Removes a signed-out session from the store, unless a removal is already on its way; refused here until then. */
  private removeKept(key: string): void {
    const store = this.persistence?.store;
    const revocation = this.revoked.get(key);
    if (!store || !revocation || revocation.removing) return;
    revocation.removing = true;
    const removal = store.delete(key).then(
      () => {
        if (this.revoked.get(key) === revocation) this.revoked.delete(key);
      },
      (error: unknown) => {
        revocation.removing = false;
        throw error;
      },
    );
    this.track(removal, 'a kept people session could not be removed, so this process refuses it and tries again');
  }

  private isRevoked(key: string): boolean {
    const revocation = this.revoked.get(key);
    if (revocation === undefined) return false;
    if (revocation.expiresAt > Date.now()) return true;
    this.revoked.delete(key);
    return false;
  }

  /** A session past its expiry is gone from the store by its TTL, so its removal is not tried again. */
  private forgetExpiredRevocations(): void {
    const now = Date.now();
    for (const [key, revocation] of this.revoked) if (revocation.expiresAt <= now) this.revoked.delete(key);
  }

  private track(write: Promise<unknown>, failure: string): void {
    const settled = write.then(
      () => undefined,
      (error: unknown) => this.report(failure, error),
    );
    this.writes.add(settled);
    void settled.then(() => this.writes.delete(settled));
  }

  private report(message: string, error: unknown): void {
    try {
      this.persistence?.onError?.(message, error);
    } catch {
      // a failing listener must not fail the sign-in
    }
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
    this.failures.delete(client);
    if (this.failures.size >= MAX_TRACKED_CLIENTS) this.forgetOldestClients(now);
    this.failures.set(client, { count: locked ? 0 : count, lastAt: now, lockedUntil: locked ? now + lockoutMs : 0 });
    return locked ? LOCKED : INVALID;
  }

  /**
   * Clients are kept in the order of their last failure, so the idle ones come first: drop them, and stop at the
   * first active one, unless the map is still full, when that oldest active one goes too.
   */
  private forgetOldestClients(now: number): void {
    for (const [client, failures] of this.failures) {
      const idle = failures.lockedUntil <= now && now - failures.lastAt > this.options.lockoutMs;
      if (!idle && this.failures.size < MAX_TRACKED_CLIENTS) return;
      this.failures.delete(client);
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
