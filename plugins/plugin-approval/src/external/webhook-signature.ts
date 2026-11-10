/**
 * Standard Webhooks signatures on approval requests and callbacks, signed and checked by `@frontmcp/utils`.
 *
 * @module @frontmcp/plugin-approval
 */

import {
  randomUUID,
  verifyWebhookSignature,
  webhookSignatureHeaders,
  type SignedWebhookMessage,
  type WebhookSignatureCheck,
} from '@frontmcp/utils';

export { signingKeyOf, WEBHOOK_ID_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@frontmcp/utils';

/** The headers that sign `body`: a new message id, the current time and the signature over both and the body. */
export function signatureHeaders(signingKey: Uint8Array, body: string, now = Date.now()): Record<string, string> {
  const message = { id: `msg_${randomUUID()}`, timestamp: Math.floor(now / 1000), body };
  return webhookSignatureHeaders(message, [signingKey]);
}

/** Checks a signed message against the key: its timestamp within five minutes of `now`, and its signature. */
export function checkSignature(
  signingKey: Uint8Array,
  message: SignedWebhookMessage,
  now = Date.now(),
): WebhookSignatureCheck {
  return verifyWebhookSignature(message, [signingKey], now);
}
