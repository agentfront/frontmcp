/**
 * Integrity-protected `requestState` for MRTR — protocol 2026-07-28, SEP-2322.
 *
 * The spec is explicit that `requestState` round-trips through the client and
 * MUST therefore be treated as attacker-controlled input:
 *
 * > If `requestState` influences authorization, resource access, or business
 * > logic, servers **MUST** protect its integrity (e.g. HMAC or AEAD) and
 * > **MUST** reject state that fails verification.
 *
 * It also asks servers to bound replay by binding the state to
 * the authenticated principal, a short expiry, and the originating request.
 * All three are enforced here — a blob minted for user A's `tools/call echo`
 * is rejected if it comes back from user B, after it expires, or on a
 * different call.
 *
 * Format: `<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`.
 */
import { type InputResponses } from '@frontmcp/protocol';
import {
  base64urlDecode,
  base64urlEncode,
  getEnv,
  getRuntimeContext,
  hmacSha256,
  isProduction,
  randomBytes,
  sha256Hex,
  timingSafeEqual,
} from '@frontmcp/utils';

/** How long a minted state stays redeemable. */
export const DEFAULT_REQUEST_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Largest `requestState` this server will even attempt to verify.
 *
 * The blob is attacker-controlled and reaches an HMAC before anything else can
 * reject it, so an unbounded value would let a client burn CPU at will. 256 KiB
 * is far above any legitimate accumulation of `InputResponses` (sampling
 * completions are the biggest realistic contributor) while keeping the work per
 * request bounded.
 */
export const MAX_REQUEST_STATE_BYTES = 256 * 1024;

interface RequestStatePayload {
  /** Answers gathered so far, keyed by input-request key. */
  r: InputResponses;
  /** Authenticated principal this state was minted for. */
  p: string;
  /** Digest binding the state to the originating request. */
  b: string;
  /** Absolute expiry, epoch ms. */
  e: number;
}

export interface RequestStateBinding {
  /** Authenticated principal, or a stable stand-in for anonymous callers. */
  principal: string;
  /** Digest of the originating request (see {@link computeRequestBinding}). */
  binding: string;
}

export type RequestStateDecodeResult =
  | { ok: true; responses: InputResponses }
  | {
      ok: false;
      reason: 'absent' | 'malformed' | 'bad-signature' | 'expired' | 'principal-mismatch' | 'request-mismatch';
    };

/** Where the `requestState` HMAC key comes from. */
export type RequestStateKeySource = 'VAULT_SECRET' | 'JWT_SECRET' | 'per-process';

let cachedKey: { key: Uint8Array; source: RequestStateKeySource } | undefined;
let warnedKeyNotShared = false;

/** A configured secret, treating an unset or blank value as absent. */
function configuredSecret(name: 'VAULT_SECRET' | 'JWT_SECRET'): string | undefined {
  const value = getEnv(name);
  return value && value.trim().length > 0 ? value : undefined;
}

function resolveKey(): { key: Uint8Array; source: RequestStateKeySource } {
  if (cachedKey) return cachedKey;
  const vault = configuredSecret('VAULT_SECRET');
  const jwt = vault ? undefined : configuredSecret('JWT_SECRET');
  if (vault) cachedKey = { key: encoder.encode(vault), source: 'VAULT_SECRET' };
  else if (jwt) cachedKey = { key: encoder.encode(jwt), source: 'JWT_SECRET' };
  else cachedKey = { key: randomBytes(32), source: 'per-process' };
  return cachedKey;
}

/**
 * Resolve the HMAC key.
 *
 * Mirrors the credential vault's pepper resolution (`VAULT_SECRET ?? JWT_SECRET`,
 * then a random per-process value) so a multi-node deployment that already
 * configures one of those secrets gets cross-node-verifiable state for free.
 * Without a configured secret the key is per-process, which still blocks
 * tampering but makes state non-portable across nodes — acceptable because a
 * rejected state only costs the client one extra round trip.
 */
export function getRequestStateKey(): Uint8Array {
  return resolveKey().key;
}

/**
 * Which secret the `requestState` key comes from — `'per-process'` when neither
 * `VAULT_SECRET` nor `JWT_SECRET` is set, in which case state minted by one
 * instance fails verification on every other one.
 */
export function getRequestStateKeySource(): RequestStateKeySource {
  return resolveKey().source;
}

/**
 * Warn once, at startup, when multi-round tools cannot resume across instances.
 *
 * A top-level `redis` or an object `transport.persistence` signals a deployment
 * that expects several instances (or restarts) to share work. Under a
 * per-process key each instance signs `requestState` with its own random key,
 * so a round that lands on another instance fails verification and the
 * exchange silently starts over — the only symptom is a repeated question.
 */
export function warnIfRequestStateKeyNotShared(options: {
  logger: { warn(message: string): void };
  metadata: { redis?: unknown; transport?: { persistence?: unknown } };
}): void {
  // A page is one instance, which may keep the redis of the Node server it shares a config with
  if (warnedKeyNotShared || !isProduction() || getRuntimeContext().runtime === 'browser') return;
  const { metadata } = options;
  const persistence = metadata.transport?.persistence;
  const sharesState = Boolean(metadata.redis) || (typeof persistence === 'object' && persistence !== null);
  if (!sharesState || getRequestStateKeySource() !== 'per-process') return;

  warnedKeyNotShared = true;
  options.logger.warn(
    'requestState is signed with a per-process key (neither VAULT_SECRET nor JWT_SECRET is set). ' +
      'Multi-round tools (elicit/sample) restart when a round lands on another instance; ' +
      'set VAULT_SECRET (or JWT_SECRET) to the same value on every instance.',
  );
}

/** Reset the cached key and the one-time warning. Test-only. @internal */
export function resetRequestStateKey(): void {
  cachedKey = undefined;
  warnedKeyNotShared = false;
}

/**
 * Bind state to the request that produced it.
 *
 * Uses the method plus the identity-bearing params (tool/prompt name, resource
 * URI, arguments) — deliberately excluding `_meta`, `inputResponses` and
 * `requestState` itself, all of which legitimately differ between the initial
 * request and the retry.
 */
export function computeRequestBinding(method: string, params: Record<string, unknown> | undefined): string {
  const salient: Record<string, unknown> = {};
  for (const key of ['name', 'uri', 'arguments']) {
    if (params?.[key] !== undefined) salient[key] = params[key];
  }
  return sha256Hex(`${method}\x00${JSON.stringify(salient)}`);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncodeJson(value: unknown): string {
  return base64urlEncode(encoder.encode(JSON.stringify(value)));
}

/**
 * Constant-time signature comparison.
 *
 * `timingSafeEqual` throws on unequal lengths, so the length check happens
 * first — a length mismatch is already a non-match and leaks nothing beyond
 * what the ciphertext length reveals.
 */
function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

function sign(body: string): string {
  return base64urlEncode(hmacSha256(getRequestStateKey(), encoder.encode(body)));
}

/** Mint an integrity-protected `requestState`. */
export function encodeRequestState(
  responses: InputResponses,
  binding: RequestStateBinding,
  ttlMs: number = DEFAULT_REQUEST_STATE_TTL_MS,
): string {
  const payload: RequestStatePayload = {
    r: responses,
    p: binding.principal,
    b: binding.binding,
    e: Date.now() + ttlMs,
  };
  const body = base64urlEncodeJson(payload);
  return `${body}.${sign(body)}`;
}

/**
 * Verify and decode a client-echoed `requestState`.
 *
 * Every failure mode is distinguished so callers can log the cause, but they
 * all lead to the same outcome for the client: the exchange restarts. Returning
 * an error instead would strand a caller whose only mistake was letting the
 * state expire.
 */
export function decodeRequestState(state: unknown, expected: RequestStateBinding): RequestStateDecodeResult {
  if (typeof state !== 'string' || state.length === 0) return { ok: false, reason: 'absent' };

  // Checked before the HMAC so an oversized blob costs a length comparison
  // rather than a hash over the whole payload.
  if (state.length > MAX_REQUEST_STATE_BYTES) return { ok: false, reason: 'malformed' };

  const separator = state.lastIndexOf('.');
  if (separator <= 0) return { ok: false, reason: 'malformed' };

  const body = state.slice(0, separator);
  const signature = state.slice(separator + 1);

  if (!signaturesMatch(signature, sign(body))) return { ok: false, reason: 'bad-signature' };

  let payload: RequestStatePayload;
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(body))) as RequestStatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload !== 'object' || typeof payload.r !== 'object' || payload.r === null) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.e !== 'number' || Date.now() > payload.e) return { ok: false, reason: 'expired' };
  if (payload.p !== expected.principal) return { ok: false, reason: 'principal-mismatch' };
  if (payload.b !== expected.binding) return { ok: false, reason: 'request-mismatch' };

  return { ok: true, responses: payload.r };
}
