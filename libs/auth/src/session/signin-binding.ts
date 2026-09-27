/**
 * Ties a sign-in to the browser that started it (RFC 9700 §4.7, RFC 6749 §10.12).
 *
 * `/oauth/authorize` gives the browser a random value in a cookie named after
 * the pending authorization, and keeps only its SHA-256 on the pending
 * authorization (and on the federated session that continues it). The
 * callbacks that resume the sign-in (`/oauth/callback`, the upstream
 * provider's callback) require that cookie. Without it, a sign-in someone
 * started in their own browser could be finished in a victim's browser: sent to
 * the upstream provider with the other person's `state`, the victim's browser
 * would come back with a code for the victim's provider account, and the
 * FrontMCP code would go to the other person's client.
 *
 * The cookie is named per pending authorization so several sign-ins can run in
 * one browser at once.
 */
import { base64urlEncode, getCookie, randomBytes, sha256Hex, timingSafeEqual } from '@frontmcp/utils';

/** Prefix of the sign-in binding cookie's name; the rest identifies the pending authorization. */
export const SIGNIN_BINDING_COOKIE_PREFIX = 'frontmcp_signin_';

/**
 * How long the binding cookie lives, in seconds: long enough for a pending
 * authorization (10 minutes) followed by a federated session (15 minutes).
 */
export const SIGNIN_BINDING_MAX_AGE_SECONDS = 30 * 60;

/** A new binding: the cookie to give the browser, and the hash to keep server-side. */
export interface SigninBinding {
  /** Cookie name, derived from the pending authorization id. */
  cookieName: string;
  /** Cookie value: 32 random bytes, base64url. Never stored server-side. */
  value: string;
  /** SHA-256 (hex) of `value`, kept on the pending authorization. */
  hash: string;
}

/** The binding cookie's name for the pending authorization `pendingAuthId` (it doesn't carry the id itself). */
export function signinBindingCookieName(pendingAuthId: string): string {
  return `${SIGNIN_BINDING_COOKIE_PREFIX}${sha256Hex(`signin:${pendingAuthId}`).slice(0, 16)}`;
}

/** Create the binding for a new pending authorization. */
export function createSigninBinding(pendingAuthId: string): SigninBinding {
  const value = base64urlEncode(randomBytes(32));
  return { cookieName: signinBindingCookieName(pendingAuthId), value, hash: sha256Hex(value) };
}

/**
 * Whether a request's `Cookie` header carries the binding of `pendingAuthId`
 * whose hash is `expectedHash`. Fails closed: no expected hash (a record created
 * without a binding), no cookie, or a different value all return `false`.
 */
export function signinBindingMatches(
  cookieHeader: string | undefined,
  pendingAuthId: string,
  expectedHash: string | undefined,
): boolean {
  if (!expectedHash) return false;
  const value = getCookie(cookieHeader, signinBindingCookieName(pendingAuthId));
  if (!value) return false;
  const encoder = new TextEncoder();
  const actual = encoder.encode(sha256Hex(value));
  const expected = encoder.encode(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
