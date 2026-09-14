/**
 * Incremental-authorization ticket signing (GHSA-2c4g-9c8x-6m8g).
 *
 * Progressive authorization lets an ALREADY-authenticated user expand a grant
 * to one more app without repeating login. That only holds if the server can
 * prove the caller is already authenticated — otherwise "skip the login step"
 * is an authentication bypass.
 *
 * The proof is this ticket. It is minted server-side at the ONLY moment the
 * caller's identity is known and verified: when a `tools/call` is refused with
 * `AuthorizationRequiredError` and the incremental `auth_url` is built. The
 * ticket is an HMAC-SHA256 token over `{ sub, appId, toolId?, priorAppIds?,
 * jti, exp }`, signed with the server secret, and `/oauth/authorize` treats a
 * request as incremental ONLY when it verifies. Without a valid ticket the
 * request is an ordinary login and runs the full credential gate.
 *
 * Reuses `@frontmcp/utils` HMAC signing (`signData`/`verifyData`) — no new
 * crypto — and mirrors {@link signCredentialResumeToken}. The payload contains
 * no secret material; it only authorizes *which* `(sub, app)` grant expansion
 * may skip re-authentication, once, before `exp`.
 */

import { randomUUID, signData, verifyData } from '@frontmcp/utils';

/**
 * The payload signed into an incremental-authorization ticket.
 */
export interface IncrementalAuthTicketPayload {
  /** The verified subject the expanded grant will be minted for. */
  sub: string;
  /** App id the grant is being expanded to include. */
  appId: string;
  /** Tool whose call triggered the authorization requirement. */
  toolId?: string;
  /** Apps the caller already holds a grant for, carried forward. */
  priorAppIds?: string[];
  /** Unique ticket id, used to enforce single use. */
  jti: string;
  /** Absolute expiry, epoch milliseconds. */
  exp: number;
}

/** Default incremental-ticket TTL: 5 minutes (long enough for a browser round-trip). */
export const DEFAULT_INCREMENTAL_TICKET_TTL_MS = 300_000;

/**
 * Sign an incremental-authorization ticket (HMAC-SHA256 over the payload).
 *
 * @param input - the verified subject, the target app, and optional context.
 * @param secret - the server signing secret (HMAC key).
 * @returns a compact base64url token string suitable for a URL query param.
 */
export function signIncrementalAuthTicket(
  input: { sub: string; appId: string; toolId?: string; priorAppIds?: string[]; ttlMs?: number },
  secret: string,
): string {
  const payload: IncrementalAuthTicketPayload = {
    sub: input.sub,
    appId: input.appId,
    ...(input.toolId !== undefined ? { toolId: input.toolId } : {}),
    ...(input.priorAppIds !== undefined ? { priorAppIds: input.priorAppIds } : {}),
    jti: randomUUID(),
    exp: Date.now() + (input.ttlMs ?? DEFAULT_INCREMENTAL_TICKET_TTL_MS),
  };
  // signData yields a JSON `{ data, sig, v }`; base64url-encode it so the whole
  // thing is a single opaque URL-safe token.
  const signedJson = signData(payload, { secret });
  return Buffer.from(signedJson, 'utf8').toString('base64url');
}

/**
 * Verify an incremental-authorization ticket: constant-time signature check
 * (via {@link verifyData}) AND expiry enforcement.
 *
 * Single use is enforced separately, by the caller, against the ticket's `jti`
 * — a signature check alone cannot detect replay.
 *
 * @param token - the base64url token from {@link signIncrementalAuthTicket}.
 * @param secret - the server signing secret (must match the signing secret).
 * @param now - current time (epoch ms), injectable for tests. @default Date.now()
 * @returns the verified payload, or null when the signature is invalid, the
 *   token is malformed, or it has expired.
 */
export function verifyIncrementalAuthTicket(
  token: string,
  secret: string,
  now: number = Date.now(),
): IncrementalAuthTicketPayload | null {
  let signedJson: string;
  try {
    signedJson = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const payload = verifyData<IncrementalAuthTicketPayload>(signedJson, { secret });
  if (!payload) return null;
  // Shape + expiry checks (defense in depth — verifyData only proves integrity).
  // `exp` must be finite (reject NaN/Infinity, which `typeof === 'number'` would
  // otherwise admit and make the `now >= exp` comparison meaningless).
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.appId !== 'string' || payload.appId.length === 0) return null;
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) return null;
  if (!Number.isFinite(payload.exp)) return null;
  if (payload.toolId !== undefined && typeof payload.toolId !== 'string') return null;
  if (
    payload.priorAppIds !== undefined &&
    (!Array.isArray(payload.priorAppIds) || payload.priorAppIds.some((id) => typeof id !== 'string'))
  ) {
    return null;
  }
  if (now >= payload.exp) {
    return null; // expired
  }
  return payload;
}
