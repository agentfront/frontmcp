import { bytesToHex, hmacSha256, timingSafeEqual } from '@frontmcp/utils';

/** The header that carries a webhook request's signature: `v1=` and the hex HMAC-SHA256 (see {@link signWorkflowWebhook}). */
export const WORKFLOW_WEBHOOK_SIGNATURE_HEADER = 'x-frontmcp-signature';

/** The header that carries when the sender signed the request, in Unix seconds. */
export const WORKFLOW_WEBHOOK_TIMESTAMP_HEADER = 'x-frontmcp-timestamp';

/** How far a request's timestamp may be from the server's clock, either way, in seconds. */
export const WORKFLOW_WEBHOOK_TOLERANCE_SECONDS = 300;

/** The most signatures a workflow's webhook remembers at once; past it, new requests are refused until some expire. */
const MAX_REMEMBERED_SIGNATURES = 10_000;

const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/i;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const encoder = new TextEncoder();

/**
 * Why a webhook request was refused: each one answers the same 401, and only the server's log names it, but for
 * `too many`, which answers 429.
 */
export type WorkflowWebhookRefusal = 'unsigned' | 'malformed' | 'expired' | 'bad signature' | 'replayed' | 'too many';

/**
 * The signature of a webhook request: `v1=` and the lowercase hex HMAC-SHA256, keyed with the workflow's
 * `webhook.secret`, of the timestamp, a `.`, and the body's bytes as sent.
 *
 * @param secret - The workflow's `webhook.secret`
 * @param timestamp - What the request sends in `X-FrontMCP-Timestamp`: the time of signing, in Unix seconds
 * @param body - The request's body, as sent; empty for a GET
 */
export function signWorkflowWebhook(secret: string, timestamp: string, body: Uint8Array): string {
  const prefix = encoder.encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  return `v1=${bytesToHex(hmacSha256(encoder.encode(secret), signed))}`;
}

/**
 * The signatures accepted within the tolerance, so each signed request starts one run: the same request sent again
 * is refused. It remembers them in this process only, and never forgets one before its timestamp leaves the tolerance.
 */
export class WorkflowWebhookReplayGuard {
  /** Each signature accepted, with when its timestamp leaves the tolerance, in Unix seconds. */
  private readonly accepted = new Map<string, number>();

  /** Remember `signature`: `replayed` when it was accepted before, `too many` when it remembers as many as it can. */
  claim(signature: string, timestamp: number, nowSeconds: number): 'replayed' | 'too many' | undefined {
    this.forgetExpired(nowSeconds);
    if (this.accepted.has(signature)) return 'replayed';
    if (this.accepted.size >= MAX_REMEMBERED_SIGNATURES) return 'too many';
    this.accepted.set(signature, timestamp + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS);
    return undefined;
  }

  private forgetExpired(nowSeconds: number): void {
    for (const [signature, expiresAt] of this.accepted) {
      if (expiresAt < nowSeconds) this.accepted.delete(signature);
    }
  }
}

export interface WorkflowWebhookRequest {
  /** The request's headers, with lowercase names. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The body's bytes, as received. */
  body: Uint8Array;
}

/**
 * Check a webhook request's signature: both headers present and well formed, the timestamp within
 * {@link WORKFLOW_WEBHOOK_TOLERANCE_SECONDS} of `nowSeconds`, the signature equal to the expected one (compared in
 * constant time), and not accepted before. Answers why it is refused, or nothing when it is signed.
 */
export function verifyWorkflowWebhook(
  request: WorkflowWebhookRequest,
  secret: string,
  replays: WorkflowWebhookReplayGuard,
  nowSeconds = Math.floor(Date.now() / 1000),
): WorkflowWebhookRefusal | undefined {
  const signatureHeader = firstHeader(request.headers[WORKFLOW_WEBHOOK_SIGNATURE_HEADER]);
  const timestampHeader = firstHeader(request.headers[WORKFLOW_WEBHOOK_TIMESTAMP_HEADER]);
  if (signatureHeader === undefined || timestampHeader === undefined) return 'unsigned';
  const signature = SIGNATURE_PATTERN.exec(signatureHeader.trim())?.[1]?.toLowerCase();
  if (!signature || !TIMESTAMP_PATTERN.test(timestampHeader)) return 'malformed';
  const timestamp = Number(timestampHeader);
  if (Math.abs(nowSeconds - timestamp) > WORKFLOW_WEBHOOK_TOLERANCE_SECONDS) return 'expired';
  const expected = encoder.encode(signWorkflowWebhook(secret, timestampHeader, request.body).slice('v1='.length));
  if (!timingSafeEqual(encoder.encode(signature), expected)) return 'bad signature';
  return replays.claim(signature, timestamp, nowSeconds);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
