/**
 * HMAC-SHA256 signatures on approval requests and callbacks, in the Standard Webhooks format
 * (https://www.standardwebhooks.com): `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<base64>` over
 * `<id>.<timestamp>.<body>`, so a receiver can check them with any Standard Webhooks library.
 *
 * @module @frontmcp/plugin-approval
 */

import { base64Decode, base64Encode, hmacSha256, randomUUID, timingSafeEqual } from '@frontmcp/utils';

export const WEBHOOK_ID_HEADER = 'webhook-id';
export const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

/** How far a signed timestamp may be from the server's clock, in seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const STANDARD_WEBHOOKS_SECRET_PREFIX = 'whsec_';
const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const encoder = new TextEncoder();

/** The HMAC key of a secret: a `whsec_` secret is base64 after the prefix, any other its UTF-8 bytes. */
export function signingKeyOf(secret: string): Uint8Array {
  if (!secret.startsWith(STANDARD_WEBHOOKS_SECRET_PREFIX)) return encoder.encode(secret);
  const encoded = secret.slice(STANDARD_WEBHOOKS_SECRET_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new TypeError('not base64');
  return base64Decode(encoded);
}

function signatureOf(signingKey: Uint8Array, id: string, timestamp: string, body: string): string {
  return base64Encode(hmacSha256(signingKey, encoder.encode(`${id}.${timestamp}.${body}`)));
}

/** The headers that sign `body`: a new message id, the current time and the signature over both and the body. */
export function signatureHeaders(signingKey: Uint8Array, body: string, now = Date.now()): Record<string, string> {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(now / 1000));
  return {
    [WEBHOOK_ID_HEADER]: id,
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: `v1,${signatureOf(signingKey, id, timestamp, body)}`,
  };
}

export type SignatureCheck = 'valid' | 'missing' | 'stale' | 'mismatch';

export interface SignedMessage {
  id?: string;
  timestamp?: string;
  signature?: string;
  body: string;
}

/**
 * Checks a signed message: its timestamp within {@link SIGNATURE_TOLERANCE_SECONDS} of `now`, and one of the
 * space-separated `v1,<signature>` entries equal, compared in constant time, to the one the key gives.
 */
export function checkSignature(signingKey: Uint8Array, message: SignedMessage, now = Date.now()): SignatureCheck {
  const { id, timestamp, signature, body } = message;
  if (!id || !timestamp || !signature) return 'missing';
  if (!TIMESTAMP_PATTERN.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return 'stale';
  }
  const expected = encoder.encode(signatureOf(signingKey, id, timestamp, body));
  const matches = signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || value === undefined) return false;
    const provided = encoder.encode(value);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
  return matches ? 'valid' : 'mismatch';
}
