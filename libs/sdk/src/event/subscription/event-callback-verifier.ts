import {
  MCP_SUBSCRIPTION_ID_HEADER,
  MCP_WEBHOOK_RECEIVER_WELL_KNOWN_PATH,
  type EventDeliveryErrorCategory,
} from '@frontmcp/protocol';
import {
  base64urlEncode,
  generateWebhookMessageId,
  outboundFailureCategory,
  randomBytes,
  sendOutboundRequest,
  sha256Hex,
  signingKeyOf,
  timingSafeEqual,
  webhookSignatureHeaders,
  type OutboundRequest,
  type OutboundResult,
} from '@frontmcp/utils';

import { eventOutboundTargetOptions } from '../event-outbound';

export interface EventCallbackVerifierOptions {
  /** `events.webhook.allowedCallbacks`: URL prefixes accepted without a request. */
  allowedCallbacks: readonly string[];
  /** `events.webhook.unsafeAllowLocalCallbacks`. */
  allowLocal: boolean;
  /** How long a verified `(principal, url)` pair stays verified. */
  cacheTtlMs: number;
  timeoutMs: number;
  /** `events.webhook.verification.maxAttemptsPerHost`. @default VERIFICATION_ATTEMPTS_PER_HOST */
  maxAttemptsPerHost?: number;
  /** Sends a request: the hardened fetch, unless a test replaces it. */
  send?: (request: OutboundRequest) => Promise<OutboundResult>;
}

export interface EventCallbackVerificationRequest {
  principalKey: string;
  url: string;
  secret: string;
  subscriptionId: string;
  /** When the stored subscription was last verified, when there is one. */
  verifiedAt?: number | null;
}

export type EventCallbackVerification =
  | { outcome: 'verified'; verifiedAt: number }
  | { outcome: 'failed'; reason: EventDeliveryErrorCategory }
  | { outcome: 'limited'; max: number };

/** Verification requests one destination host may receive in each window, unless configured. */
export const VERIFICATION_ATTEMPTS_PER_HOST = 10;
const VERIFICATION_WINDOW_MS = 60_000;
const WELL_KNOWN_CACHE_MS = 300_000;
const WELL_KNOWN_MAX_BYTES = 65_536;
const CHALLENGE_BYTES = 32;
const CHALLENGE_ANSWER_MAX_BYTES = 4096;
const MAX_CACHED_ENTRIES = 5000;
const encoder = new TextEncoder();

interface Expiring<Value> {
  value: Value;
  expiresAt: number;
}

/** A bounded in-memory map whose entries end at a time of their own; the oldest entry makes room for a new one. */
class ExpiringMap<Value> {
  private readonly entries = new Map<string, Expiring<Value>>();

  /** The value of a key, unless its time has passed. */
  get(key: string, now: number): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > now) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  /** Keep a value until `expiresAt`. */
  set(key: string, value: Value, expiresAt: number): void {
    this.entries.delete(key);
    if (this.entries.size >= MAX_CACHED_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt });
  }
}

/** Whether two strings are equal, compared in constant time for equal lengths. */
function isSameText(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Whether a callback is a configured prefix or lies under it: the same origin, and a path that continues at a `/`. */
function isUnderAllowedPrefix(callback: URL, prefix: string): boolean {
  if (!URL.canParse(prefix)) return false;
  const allowed = new URL(prefix);
  if (allowed.origin !== callback.origin) return false;
  if (callback.pathname === allowed.pathname) return true;
  const directory = allowed.pathname.endsWith('/') ? allowed.pathname : `${allowed.pathname}/`;
  return callback.pathname.startsWith(directory);
}

/** The path prefixes a receiver's well-known document declares; none for a document that cannot be read. */
function receiversOf(result: OutboundResult): string[] {
  if (!result.answered || result.status !== 200 || result.bodyTruncated) return [];
  try {
    const receivers = (JSON.parse(result.body) as { receivers?: unknown } | null)?.receivers;
    if (!Array.isArray(receivers)) return [];
    return receivers.filter((prefix): prefix is string => typeof prefix === 'string' && prefix.startsWith('/'));
  } catch {
    return [];
  }
}

/** The challenge a verification answer echoes, when its body is JSON that carries one. */
function challengeOf(answerBody: string): string | undefined {
  try {
    const challenge = (JSON.parse(answerBody) as { challenge?: unknown } | null)?.challenge;
    return typeof challenge === 'string' ? challenge : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Proves a callback accepts MCP deliveries before a subscription is activated: a configured prefix, a fresh earlier
 * proof for the same owner and URL, the receiver's well-known document, or a signed challenge it must echo.
 */
export class EventCallbackVerifier {
  private readonly verifiedPairs = new ExpiringMap<number>();
  private readonly receiversByOrigin = new ExpiringMap<string[]>();
  private readonly attemptsByHost = new ExpiringMap<number>();
  private readonly send: (request: OutboundRequest) => Promise<OutboundResult>;
  private readonly maxAttemptsPerHost: number;

  /** Takes the allowed prefixes, cache lifetime, timeout, attempt limit and sender (the hardened request by default). */
  constructor(private readonly options: EventCallbackVerifierOptions) {
    this.send = options.send ?? sendOutboundRequest;
    this.maxAttemptsPerHost = options.maxAttemptsPerHost ?? VERIFICATION_ATTEMPTS_PER_HOST;
  }

  /** Verify the callback of a subscription, sending at most one well-known request and one challenge. */
  async verify(request: EventCallbackVerificationRequest): Promise<EventCallbackVerification> {
    const now = Date.now();
    const { allowedCallbacks, cacheTtlMs } = this.options;
    const callback = new URL(request.url);
    if (allowedCallbacks.some((prefix) => isUnderAllowedPrefix(callback, prefix))) {
      return { outcome: 'verified', verifiedAt: now };
    }

    const pairKey = sha256Hex(`${request.principalKey}\n${request.url}`);
    const earlierProof = this.verifiedPairs.get(pairKey, now) ?? request.verifiedAt ?? undefined;
    if (earlierProof !== undefined && now - earlierProof < cacheTtlMs) {
      return { outcome: 'verified', verifiedAt: earlierProof };
    }

    if (!this.takeAttempt(callback.hostname, now)) return { outcome: 'limited', max: this.maxAttemptsPerHost };

    const failure = (await this.isDeclaredReceiver(callback, now)) ? undefined : await this.challenge(request, now);
    if (failure) return { outcome: 'failed', reason: failure };

    this.verifiedPairs.set(pairKey, now, now + cacheTtlMs);
    return { outcome: 'verified', verifiedAt: now };
  }

  /** Count a verification attempt against its destination host; false once the host's window is full. */
  private takeAttempt(host: string, now: number): boolean {
    const attempts = this.attemptsByHost.get(host, now);
    if (attempts === undefined) {
      this.attemptsByHost.set(host, 1, now + VERIFICATION_WINDOW_MS);
      return true;
    }
    if (attempts >= this.maxAttemptsPerHost) return false;
    this.attemptsByHost.set(host, attempts + 1, now + VERIFICATION_WINDOW_MS);
    return true;
  }

  /** Whether the callback's origin publishes a well-known document whose path prefixes cover the callback. */
  private async isDeclaredReceiver(callback: URL, now: number): Promise<boolean> {
    let receivers = this.receiversByOrigin.get(callback.origin, now);
    if (!receivers) {
      const result = await this.send({
        url: new URL(MCP_WEBHOOK_RECEIVER_WELL_KNOWN_PATH, callback.origin).toString(),
        method: 'GET',
        timeoutMs: this.options.timeoutMs,
        maxResponseBytes: WELL_KNOWN_MAX_BYTES,
        ...eventOutboundTargetOptions(this.options.allowLocal),
      });
      receivers = receiversOf(result);
      this.receiversByOrigin.set(callback.origin, receivers, now + WELL_KNOWN_CACHE_MS);
    }
    return receivers.some((prefix) => callback.pathname.startsWith(prefix));
  }

  /** Send the signed verification envelope; the failure category, or undefined when the nonce came back. */
  private async challenge(
    request: EventCallbackVerificationRequest,
    now: number,
  ): Promise<EventDeliveryErrorCategory | undefined> {
    const nonce = base64urlEncode(randomBytes(CHALLENGE_BYTES));
    const body = JSON.stringify({ type: 'verification', challenge: nonce });
    const message = { id: generateWebhookMessageId('verification'), timestamp: Math.floor(now / 1000), body };
    const result = await this.send({
      url: request.url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MCP_SUBSCRIPTION_ID_HEADER]: request.subscriptionId,
        ...webhookSignatureHeaders(message, [signingKeyOf(request.secret)]),
      },
      body,
      timeoutMs: this.options.timeoutMs,
      maxResponseBytes: CHALLENGE_ANSWER_MAX_BYTES,
      ...eventOutboundTargetOptions(this.options.allowLocal),
    });

    const category = outboundFailureCategory(result);
    if (category) return category;
    if (!result.answered || result.bodyTruncated) return 'challenge_failed';
    const echoed = challengeOf(result.body);
    return echoed !== undefined && isSameText(echoed, nonce) ? undefined : 'challenge_failed';
  }
}
