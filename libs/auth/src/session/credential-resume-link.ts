/**
 * Credential resume-link signing (Checkpoint 3b).
 *
 * When a tool asks for a credential that is not connected
 * (`this.credentials.requireConnect({ key })`), the framework returns a
 * structured "credential not connected" result carrying a FRAMEWORK-SIGNED
 * resume URL. The URL embeds an HMAC-SHA256 token over `{ sub, key, context?,
 * exp }`, signed with the server secret. The mid-session add-credential handler
 * verifies the token (constant-time, via {@link verifyData}) and refuses expired
 * or tampered tokens, so a browser cannot be redirected into adding a credential
 * for an arbitrary subject/key.
 *
 * Reuses `@frontmcp/utils` HMAC signing (`signData`/`verifyData`) — no new
 * crypto. The signed payload contains NO secret material; it only authorizes
 * *which* `(sub, key)` slot the resume page may write to.
 */

import { signData, verifyData } from '@frontmcp/utils';

/**
 * The payload signed into a credential resume token.
 */
export interface CredentialResumePayload {
  /** Subject the credential will be stored under (the request's authenticated sub). */
  sub: string;
  /** Credential key being connected (e.g. provider id). */
  key: string;
  /** Optional opaque context forwarded back to `authenticate()` as `resume.context`. */
  context?: string;
  /** Absolute expiry, epoch milliseconds. */
  exp: number;
}

/** Default resume-token TTL: 10 minutes (short-lived). */
export const DEFAULT_RESUME_TTL_MS = 600_000;

/**
 * Sign a credential resume token (HMAC-SHA256 over the payload).
 *
 * @param input - subject, key, optional context, and TTL.
 * @param secret - the server signing secret (HMAC key).
 * @returns a compact base64url token string suitable for a URL query param.
 */
export function signCredentialResumeToken(
  input: { sub: string; key: string; context?: string; ttlMs?: number },
  secret: string,
): string {
  const payload: CredentialResumePayload = {
    sub: input.sub,
    key: input.key,
    ...(input.context !== undefined ? { context: input.context } : {}),
    exp: Date.now() + (input.ttlMs ?? DEFAULT_RESUME_TTL_MS),
  };
  // signData yields a JSON `{ data, sig, v }`; base64url-encode it so the whole
  // thing is a single opaque URL-safe token.
  const signedJson = signData(payload, { secret });
  return Buffer.from(signedJson, 'utf8').toString('base64url');
}

/**
 * Verify a credential resume token: constant-time signature check (via
 * {@link verifyData}) AND expiry enforcement.
 *
 * @param token - the base64url token from {@link signCredentialResumeToken}.
 * @param secret - the server signing secret (must match the signing secret).
 * @param now - current time (epoch ms), injectable for tests. @default Date.now()
 * @returns the verified payload, or null when the signature is invalid,
 *   the token is malformed, or it has expired.
 */
export function verifyCredentialResumeToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): CredentialResumePayload | null {
  let signedJson: string;
  try {
    signedJson = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const payload = verifyData<CredentialResumePayload>(signedJson, { secret });
  if (!payload) return null;
  // Shape + expiry checks (defense in depth — verifyData only proves integrity).
  // `exp` must be a finite number (reject NaN/Infinity, which `typeof === 'number'`
  // would otherwise admit and make the `now >= exp` comparison meaningless).
  if (typeof payload.sub !== 'string' || typeof payload.key !== 'string' || !Number.isFinite(payload.exp)) {
    return null;
  }
  // When present, `context` MUST be a string (it is forwarded to authenticate()).
  if (payload.context !== undefined && typeof payload.context !== 'string') {
    return null;
  }
  if (now >= payload.exp) {
    return null; // expired
  }
  return payload;
}

/**
 * Build the absolute resume URL a "credential not connected" result hands back.
 *
 * @param basePath - the auth scope's full base path (e.g. `https://host/mcp`).
 * @param token - a token from {@link signCredentialResumeToken}.
 * @returns `${basePath}/oauth/connect?token=...`
 */
export function buildCredentialResumeUrl(basePath: string, token: string): string {
  const trimmed = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${trimmed}/oauth/connect?token=${encodeURIComponent(token)}`;
}
