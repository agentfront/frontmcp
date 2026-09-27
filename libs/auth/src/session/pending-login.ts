/**
 * A sign-in verified at `/oauth/callback` and kept on the pending authorization
 * while the user picks tools on the consent screen.
 *
 * It is sealed (AES-256-GCM, key derived from the server secret and bound to
 * the pending authorization id) because it may hold the credentials an
 * `authenticate()` verifier returned, and pending records can live in a shared
 * store (Redis, SQLite).
 */
import {
  base64urlDecode,
  base64urlEncode,
  decryptAesGcm,
  encryptAesGcm,
  hkdfSha256,
  randomBytes,
} from '@frontmcp/utils';

/** What a completed sign-in contributes to the authorization code. */
export interface PendingLoginState {
  /** The signed-in subject. */
  sub: string;
  email?: string;
  name?: string;
  /** Custom claims returned by `authenticate()`. */
  claims?: Record<string, unknown>;
  /** Credentials returned by `authenticate()`, stored in the vault when the code is minted. */
  credentials?: Array<{ key: string; secret: string; metadata?: Record<string, unknown> }>;
}

const SALT = new TextEncoder().encode('frontmcp-pending-login');

function keyFor(secret: Uint8Array, pendingAuthId: string): Uint8Array {
  return hkdfSha256(secret, SALT, new TextEncoder().encode(`pending-login:${pendingAuthId}`), 32);
}

/** Seal a verified sign-in for the pending authorization `pendingAuthId`. */
export function sealPendingLogin(secret: Uint8Array, pendingAuthId: string, state: PendingLoginState): string {
  const iv = randomBytes(12);
  const { ciphertext, tag } = encryptAesGcm(
    keyFor(secret, pendingAuthId),
    new TextEncoder().encode(JSON.stringify(state)),
    iv,
  );
  return [iv, tag, ciphertext].map((part) => base64urlEncode(part)).join('.');
}

/**
 * Open a sealed sign-in. Returns `undefined` when it was sealed for another
 * pending authorization, with another secret, or was tampered with.
 */
export function openPendingLogin(
  secret: Uint8Array,
  pendingAuthId: string,
  sealed: string,
): PendingLoginState | undefined {
  try {
    const [iv, tag, ciphertext] = sealed.split('.').map((part) => base64urlDecode(part));
    if (!iv || !tag || !ciphertext) return undefined;
    const plaintext = decryptAesGcm(keyFor(secret, pendingAuthId), ciphertext, iv, tag);
    const state = JSON.parse(new TextDecoder().decode(plaintext)) as PendingLoginState;
    return typeof state?.sub === 'string' && state.sub.length > 0 ? state : undefined;
  } catch {
    return undefined;
  }
}
