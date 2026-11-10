/** Standard Webhooks signatures (https://www.standardwebhooks.com): HMAC-SHA256 over `<id>.<timestamp>.<body>`. */

import { base64Decode, base64Encode, base64urlEncode, hmacSha256, randomBytes, timingSafeEqual } from './index';

export const WEBHOOK_ID_HEADER = 'webhook-id';
export const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

/** How far a signed timestamp may be from the verifier's clock, in seconds. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

const SECRET_PREFIX = 'whsec_';
const MIN_SECRET_BYTES = 24;
const MAX_SECRET_BYTES = 64;
const GENERATED_SECRET_BYTES = 32;
const MESSAGE_ID_RANDOM_BYTES = 18;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const WELL_FORMED_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const MESSAGE_KIND_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_VERSION = 'v1';
const encoder = new TextEncoder();

export interface WebhookMessage {
  /** The `webhook-id`, kept across the retries of one message. */
  id: string;
  /** The Unix time of this attempt, in whole seconds. */
  timestamp: number;
  /** The request body, exactly as it is sent. */
  body: string;
}

export interface SignedWebhookMessage {
  id?: string;
  timestamp?: string;
  signature?: string;
  body: string;
}

export type WebhookSignatureCheck = 'valid' | 'missing' | 'stale' | 'mismatch';

/** The HMAC key of a secret: a `whsec_` secret is base64 after the prefix, any other its UTF-8 bytes. */
export function signingKeyOf(secret: string): Uint8Array {
  if (!secret.startsWith(SECRET_PREFIX)) return encoder.encode(secret);
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (!BASE64_PATTERN.test(encoded)) throw new TypeError('not base64');
  return base64Decode(encoded);
}

/** Whether a secret is `whsec_` followed by base64, padded or not, that decodes to 24 to 64 bytes. */
export function isStandardWebhookSecret(secret: string): boolean {
  if (!secret.startsWith(SECRET_PREFIX)) return false;
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (!WELL_FORMED_BASE64_PATTERN.test(encoded)) return false;
  const symbolCount = encoded.split('=')[0].length;
  const byteCount = Math.floor((symbolCount * 3) / 4);
  return byteCount >= MIN_SECRET_BYTES && byteCount <= MAX_SECRET_BYTES;
}

/** A new `whsec_` secret of 32 random bytes. */
export function generateStandardWebhookSecret(): string {
  return `${SECRET_PREFIX}${base64Encode(randomBytes(GENERATED_SECRET_BYTES))}`;
}

/** A new `webhook-id`, `msg_<random>` or `msg_<kind>_<random>`: ASCII letters, digits, `_` and `-` only. */
export function generateWebhookMessageId(kind?: string): string {
  const random = base64urlEncode(randomBytes(MESSAGE_ID_RANDOM_BYTES));
  if (kind === undefined) return `msg_${random}`;
  if (!MESSAGE_KIND_PATTERN.test(kind)) {
    throw new TypeError('a webhook message kind holds only ASCII letters, digits, "_" and "-"');
  }
  return `msg_${kind}_${random}`;
}

function signatureOf(signingKey: Uint8Array, id: string, timestamp: string, body: string): string {
  return base64Encode(hmacSha256(signingKey, encoder.encode(`${id}.${timestamp}.${body}`)));
}

/** The `webhook-signature` of a message: one `v1,<base64>` per signing key, separated by a space. */
export function signWebhookMessage(message: WebhookMessage, signingKeys: readonly Uint8Array[]): string {
  const timestamp = String(message.timestamp);
  if (!message.id || !TIMESTAMP_PATTERN.test(timestamp) || signingKeys.length === 0) {
    throw new TypeError('a webhook signature needs a message id, a timestamp in whole seconds and a signing key');
  }
  return signingKeys
    .map((signingKey) => `${SIGNATURE_VERSION},${signatureOf(signingKey, message.id, timestamp, message.body)}`)
    .join(' ');
}

/** The three headers that sign a message with every signing key. */
export function webhookSignatureHeaders(
  message: WebhookMessage,
  signingKeys: readonly Uint8Array[],
): Record<string, string> {
  return {
    [WEBHOOK_ID_HEADER]: message.id,
    [WEBHOOK_TIMESTAMP_HEADER]: String(message.timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: signWebhookMessage(message, signingKeys),
  };
}

function isSameSignature(provided: Uint8Array, expected: Uint8Array): boolean {
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Checks a signed message: a timestamp within the tolerance of `now`, and a `v1` signature one of the keys gives. */
export function verifyWebhookSignature(
  message: SignedWebhookMessage,
  signingKeys: readonly Uint8Array[],
  now = Date.now(),
): WebhookSignatureCheck {
  const { id, timestamp, signature, body } = message;
  if (!id || !timestamp || !signature) return 'missing';

  const isTimestamp = TIMESTAMP_PATTERN.test(timestamp);
  if (!isTimestamp || Math.abs(now / 1000 - Number(timestamp)) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return 'stale';

  const expectedSignatures = signingKeys.map((signingKey) =>
    encoder.encode(signatureOf(signingKey, id, timestamp, body)),
  );
  const matches = signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== SIGNATURE_VERSION || value === undefined) return false;
    const provided = encoder.encode(value);
    return expectedSignatures.some((expected) => isSameSignature(provided, expected));
  });
  return matches ? 'valid' : 'mismatch';
}
