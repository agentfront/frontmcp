// A shared local server proves it holds the key in its owner-only file before a client sends it the token.
import {
  base64urlDecode,
  base64urlEncode,
  hkdfSha256,
  hmacSha256,
  randomBytes,
  timingSafeEqual,
} from '@frontmcp/utils';

const SECRET_BYTES = 32;
/** 32 bytes in unpadded base64url: the shape of a secret, a nonce and a proof. */
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
const KEY_SALT = 'frontmcp shared server';
const PROOF_LABEL = 'frontmcp shared server identity v1';

const encoder = new TextEncoder();

/** What a shared server and its clients derive from the secret in the server's owner-only file. */
export interface SharedServerKeys {
  /** Signs the server's identity proofs. */
  proofKey: Uint8Array;
  /** The bearer token a client presents once the server proved its identity. */
  token: string;
}

/** A fresh secret for a shared server to write to its owner-only file: 32 random bytes, base64url. */
export function createSharedServerSecret(): string {
  return base64urlEncode(randomBytes(SECRET_BYTES));
}

/** A fresh nonce for one identity challenge: 32 random bytes, base64url. */
export function createSharedServerNonce(): string {
  return base64urlEncode(randomBytes(SECRET_BYTES));
}

function isBase64url32Bytes(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL_32_BYTES.test(value);
}

/** Whether `value` has the shape of a nonce from {@link createSharedServerNonce}. */
export function isSharedServerNonce(value: unknown): value is string {
  return isBase64url32Bytes(value);
}

/** Derive the proof key and the token from a secret, each with its own label, so neither reveals the other. */
export function deriveSharedServerKeys(secret: string): SharedServerKeys {
  if (!isBase64url32Bytes(secret)) throw new TypeError('a shared server secret is 32 bytes of base64url');
  const bytes = base64urlDecode(secret);
  const salt = encoder.encode(KEY_SALT);
  return {
    proofKey: hkdfSha256(bytes, salt, encoder.encode('proof'), 32),
    token: base64urlEncode(hkdfSha256(bytes, salt, encoder.encode('token'), 32)),
  };
}

/** What a proof vouches for: the endpoint the server listens on, the client's nonce, and the server's version. */
export interface SharedServerIdentityStatement {
  endpoint: string;
  nonce: string;
  version: string;
}

function proofBytes(proofKey: Uint8Array, { endpoint, nonce, version }: SharedServerIdentityStatement): Uint8Array {
  return hmacSha256(proofKey, encoder.encode(JSON.stringify([PROOF_LABEL, endpoint, nonce, version])));
}

/** The server's answer to a nonce: an HMAC over the nonce, the endpoint it listens on and the version it runs. */
export function proveSharedServerIdentity(proofKey: Uint8Array, statement: SharedServerIdentityStatement): string {
  return base64urlEncode(proofBytes(proofKey, statement));
}

/** Whether `proof` vouches for `statement` with `proofKey`, compared in constant time. */
export function verifySharedServerIdentity(
  proofKey: Uint8Array,
  statement: SharedServerIdentityStatement,
  proof: unknown,
): boolean {
  if (!isBase64url32Bytes(proof)) return false;
  const expected = proofBytes(proofKey, statement);
  const presented = base64urlDecode(proof);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
