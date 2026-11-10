import {
  EventErrorSchema,
  EventOccurrenceSchema,
  MCP_SUBSCRIPTION_ID_HEADER,
  type EventError,
  type EventOccurrence,
} from '@frontmcp/protocol';
import {
  signingKeyOf,
  verifyWebhookSignature,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookSignatureCheck,
} from '@frontmcp/utils';

/** The deliveries remembered for deduplication, by subscription and `webhook-id`; the oldest is forgotten first. */
export const WEBHOOK_DEDUPE_WINDOW = 10000;

/** What a delivery is known by when it reaches a listener. */
export interface EventWebhookDeliveryInfo {
  /** The `X-MCP-Subscription-Id` header: the id the server derived for the subscription. */
  subscriptionId: string;
  /** The `webhook-id` header, kept across the retries of one message. */
  webhookId: string;
}

/** Receives what the deliveries of one subscription, or of every subscription, carry. */
export interface EventWebhookListener {
  /** An event occurrence. The delivery is acknowledged once this settles; a throw answers 500 so it is retried. */
  onEvent?(occurrence: EventOccurrence, delivery: EventWebhookDeliveryInfo): void | Promise<void>;
  /** A `gap` envelope: events were skipped and `cursor` is where delivery goes on from. */
  onGap?(cursor: string | null, delivery: EventWebhookDeliveryInfo): void | Promise<void>;
  /** A `terminated` envelope: the server ended the subscription. */
  onTerminated?(error: EventError, delivery: EventWebhookDeliveryInfo): void | Promise<void>;
}

export interface EventWebhookReceiverOptions extends EventWebhookListener {
  /** Secrets that sign the deliveries of any subscription, for a receiver with one fixed secret. */
  secrets?: string[];
}

/** A secret the receiver checks deliveries with, bound to a subscription id once it is known. */
export interface EventWebhookRegistration {
  /** The subscription id the secret is bound to; undefined until it is. */
  readonly subscriptionId: string | undefined;
  /** Route the deliveries of `subscriptionId` to this registration. */
  bind(subscriptionId: string): void;
  /** Accept one more secret, as after a rotation, keeping the earlier ones. */
  addSecret(secret: string): void;
  /** Stop accepting deliveries for this registration. */
  release(): void;
}

export interface EventWebhookRegistrationOptions {
  secret: string;
  /** The subscription id, when it is already known. */
  subscriptionId?: string;
  /** Where this subscription's deliveries go; the receiver's own callbacks get the rest. */
  listener?: EventWebhookListener;
}

/** One request as it arrived: the headers and the exact body bytes the signature covers. */
export interface EventWebhookRequest {
  headers: Headers | Record<string, string | string[] | undefined>;
  rawBody: string;
}

/** The answer to give the server. */
export interface EventWebhookResponse {
  status: number;
  /** A JSON body to send, when there is one. */
  body?: Record<string, unknown>;
  /** How the signature checked, when it was checked. */
  signature?: WebhookSignatureCheck;
}

/** A framework-neutral receiver of MCP Events webhook deliveries. */
export interface EventWebhookReceiver {
  /** Check, deduplicate and route one request, and say what to answer. */
  handle(request: EventWebhookRequest): Promise<EventWebhookResponse>;
  /** How a request's signature checks against the secrets of its subscription, without acting on it; undefined when none is known. */
  verify(request: EventWebhookRequest): WebhookSignatureCheck | undefined;
  /** Register a secret, usually one generated for a new subscription. */
  register(options: EventWebhookRegistrationOptions): EventWebhookRegistration;
  /** Accept one more secret for every subscription. */
  addSecret(secret: string): void;
  /** Whether any secret is configured or registered. */
  hasSecrets(): boolean;
}

/** A registered secret and where its deliveries go. */
interface RegistrationRecord {
  subscriptionId: string | undefined;
  signingKeys: Uint8Array[];
  listener: EventWebhookListener | undefined;
}

/** The value of a header, read without regard to case. */
function headerOf(headers: EventWebhookRequest['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() === lowerName) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/** The JSON object a body holds, or undefined. */
function jsonObjectOf(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a receiver of MCP Events webhooks: it selects the secret by `X-MCP-Subscription-Id`, verifies the Standard
 * Webhooks signature and its freshness, deduplicates on `webhook-id`, answers verification challenges, and hands
 * occurrences and `gap` / `terminated` envelopes to the listener of the subscription.
 */
export function createEventWebhookReceiver(options: EventWebhookReceiverOptions = {}): EventWebhookReceiver {
  const sharedKeys = (options.secrets ?? []).map(signingKeyOf);
  const registrations = new Set<RegistrationRecord>();
  const seenWebhookIds = new Set<string>();
  const inFlight = new Set<string>();

  /** The registrations bound to a subscription id. */
  const boundTo = (subscriptionId: string) =>
    [...registrations].filter((registration) => registration.subscriptionId === subscriptionId);

  /** Check a request against keys. */
  const check = (request: EventWebhookRequest, signingKeys: Uint8Array[]) =>
    verifyWebhookSignature(
      {
        id: headerOf(request.headers, WEBHOOK_ID_HEADER),
        timestamp: headerOf(request.headers, WEBHOOK_TIMESTAMP_HEADER),
        signature: headerOf(request.headers, WEBHOOK_SIGNATURE_HEADER),
        body: request.rawBody,
      },
      signingKeys,
    );

  /** Bind an unbound registration whose secret signed a verification challenge. */
  const bindUnbound = (request: EventWebhookRequest, subscriptionId: string): WebhookSignatureCheck => {
    let result: WebhookSignatureCheck = 'mismatch';
    for (const registration of registrations) {
      if (registration.subscriptionId !== undefined) continue;
      result = check(request, registration.signingKeys);
      if (result === 'valid') {
        registration.subscriptionId = subscriptionId;
        return result;
      }
      if (result !== 'mismatch') return result;
    }
    return result;
  };

  /** Check a request against the shared secrets and those bound to its subscription. */
  const verify = (request: EventWebhookRequest): WebhookSignatureCheck | undefined => {
    const subscriptionId = headerOf(request.headers, MCP_SUBSCRIPTION_ID_HEADER) ?? '';
    const signingKeys = [...sharedKeys, ...boundTo(subscriptionId).flatMap((registration) => registration.signingKeys)];
    return signingKeys.length > 0 ? check(request, signingKeys) : undefined;
  };

  /** Remember a handled delivery, forgetting the oldest past the window. */
  const remember = (dedupeKey: string) => {
    seenWebhookIds.add(dedupeKey);
    if (seenWebhookIds.size > WEBHOOK_DEDUPE_WINDOW) {
      const oldest = seenWebhookIds.values().next().value as string;
      seenWebhookIds.delete(oldest);
    }
  };

  /** Hand a checked body to the listener it is for. */
  const dispatch = async (
    json: Record<string, unknown>,
    listener: EventWebhookListener,
    delivery: EventWebhookDeliveryInfo,
  ): Promise<EventWebhookResponse> => {
    if (json['type'] === 'gap') {
      await listener.onGap?.(typeof json['cursor'] === 'string' ? json['cursor'] : null, delivery);
      return { status: 200 };
    }
    if (json['type'] === 'terminated') {
      const error = EventErrorSchema.safeParse(json['error']);
      if (!error.success) return { status: 400 };
      await listener.onTerminated?.(error.data, delivery);
      return { status: 200 };
    }
    const occurrence = EventOccurrenceSchema.safeParse(json);
    if (json['type'] !== undefined || !occurrence.success) return { status: 400 };
    await listener.onEvent?.(occurrence.data, delivery);
    return { status: 200 };
  };

  return {
    async handle(request) {
      const subscriptionId = headerOf(request.headers, MCP_SUBSCRIPTION_ID_HEADER) ?? '';
      const webhookId = headerOf(request.headers, WEBHOOK_ID_HEADER) ?? '';
      const json = jsonObjectOf(request.rawBody);
      const isVerification = json?.['type'] === 'verification' && typeof json['challenge'] === 'string';
      const bound = boundTo(subscriptionId);

      let signature = verify(request);
      if (signature !== 'valid' && isVerification && bound.length === 0) {
        signature = bindUnbound(request, subscriptionId);
      }
      if (signature === undefined) return { status: 503 };
      if (signature !== 'valid') return { status: 401, signature };
      if (!json) return { status: 400, signature };
      if (isVerification) return { status: 200, body: { challenge: json['challenge'] }, signature };
      const dedupeKey = `${subscriptionId} ${webhookId}`;
      if (seenWebhookIds.has(dedupeKey)) return { status: 200, signature };
      // A retry that arrives while the first attempt still runs is answered retryable, so the listener runs once
      if (inFlight.has(dedupeKey)) return { status: 503, signature };

      const listener = bound[0]?.listener ?? options;
      inFlight.add(dedupeKey);
      try {
        const response = await dispatch(json, listener, { subscriptionId, webhookId });
        if (response.status === 200) remember(dedupeKey);
        return { ...response, signature };
      } catch {
        return { status: 500, signature };
      } finally {
        inFlight.delete(dedupeKey);
      }
    },

    verify,

    register({ secret, subscriptionId, listener }) {
      const record: RegistrationRecord = { subscriptionId, signingKeys: [signingKeyOf(secret)], listener };
      registrations.add(record);
      return {
        get subscriptionId() {
          return record.subscriptionId;
        },
        bind(id) {
          record.subscriptionId = id;
        },
        addSecret(next) {
          record.signingKeys.push(signingKeyOf(next));
        },
        release() {
          registrations.delete(record);
        },
      };
    },

    addSecret(secret) {
      sharedKeys.push(signingKeyOf(secret));
    },

    hasSecrets() {
      return sharedKeys.length > 0 || registrations.size > 0;
    },
  };
}
