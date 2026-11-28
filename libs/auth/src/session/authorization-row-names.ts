/**
 * Row names of the authorization stores.
 *
 * An authorization code, a pending authorization and a refresh token are each kept in a row named by a keyed hash of
 * the value a client presents, `HMAC-SHA256(k, value)`, never by the value itself: storage encryption seals the
 * values of rows, not their names. `k` is derived with HKDF-SHA256 from a secret that stays the same across restarts
 * and on every instance sharing the storage (see `tokenStorageKeyHashSecret`). Without a secret the name is the hash
 * of the value under a fixed key: it still holds no value and stays the same across restarts.
 *
 * Up to 1.13 a row was named by the value itself (`oauth:code:<code>`, `oauth:refresh:<token>`,
 * `oauth:pending:<id>`). The stores still read a row named that way, and move it under its hashed name when it is
 * used.
 */

import { base64urlEncode, hkdfSha256, hmacSha256 } from '@frontmcp/utils';

/** A secret row names are derived from: a string (as an environment variable holds it) or its bytes. */
export type AuthorizationKeyHashSecret = string | Uint8Array;

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode('frontmcp-authorization-store-v1');
const HKDF_INFO = encoder.encode('row-names');
/** The key a name is hashed under without a secret: fixed, so the names stay the same across restarts. */
const FIXED_KEY = encoder.encode('frontmcp-authorization-store-v1:row-names-without-a-secret');

/** Names the rows of an authorization store: `name(value)` is the base64url HMAC-SHA256 of `value`. */
export class AuthorizationRowNames {
  private readonly key: Uint8Array;

  constructor(secret?: AuthorizationKeyHashSecret) {
    const material = typeof secret === 'string' ? encoder.encode(secret) : secret;
    this.key = material && material.length > 0 ? hkdfSha256(material, HKDF_SALT, HKDF_INFO, 32) : FIXED_KEY;
  }

  /** The name of the row that holds `value`. */
  name(value: string): string {
    return base64urlEncode(hmacSha256(this.key, encoder.encode(value)));
  }
}
