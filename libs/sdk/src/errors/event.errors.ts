import type { EventDeliveryErrorCategory, EventsErrorName } from '@frontmcp/protocol';

import { InternalMcpError, PublicMcpError } from './mcp.error';

/** Thrown at startup when two events of a server declare the same name: a subscription names its event by it. */
export class EventNameConflictError extends InternalMcpError {
  constructor(eventName: string) {
    super(
      `Event "${eventName}" is declared twice: each event of a server needs its own name. ` +
        'Rename one of them with @Event({ name }).',
      'EVENT_NAME_CONFLICT',
    );
  }
}

/** The JSON-RPC codes of the events errors in one dialect: `EVENTS_ERROR_CODES` or `EVENTS_SKETCH_ERROR_CODES`. */
export type EventErrorCodes = Readonly<Record<EventsErrorName, number>>;

/** An events error with the JSON-RPC code of the caller's dialect and the `data` the events protocol defines. */
export abstract class EventProtocolError extends PublicMcpError {
  constructor(
    message: string,
    code: string,
    statusCode: number,
    readonly jsonRpcCode: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message, code, statusCode);
  }

  /** The JSON-RPC error a client receives. */
  toJsonRpcError(): { code: number; message: string; data: Record<string, unknown> } {
    return { code: this.jsonRpcCode, message: this.getPublicMessage(), data: this.data };
  }
}

/** `NotFound`: the server serves no event, or the caller holds no subscription, of that name. */
export class EventNotFoundError extends EventProtocolError {
  constructor(codes: EventErrorCodes, kind: 'event' | 'subscription', name: string) {
    const subject = kind === 'event' ? `Event "${name}" is not served` : `No subscription to "${name}" was found`;
    super(`${subject}. Call events/list for the events this server offers.`, 'EVENT_NOT_FOUND', 404, codes.notFound, {
      kind,
      name,
    });
  }
}

/** `Forbidden`: the caller may not subscribe to the event. */
export class EventForbiddenError extends EventProtocolError {
  constructor(codes: EventErrorCodes, name: string, reason: string) {
    super(`Subscribing to "${name}" is not allowed: ${reason}`, 'EVENT_FORBIDDEN', 403, codes.forbidden, { reason });
  }
}

const RESOURCE_LIMIT_MESSAGES = {
  subscriptions: (max: number) =>
    `The limit of ${max} subscriptions per caller is reached. Remove one with events/unsubscribe, then retry.`,
  verifications: (max: number) =>
    `The callback host was sent ${max} verification requests in the last minute. Retry in a minute.`,
} as const;

/** `ResourceExhausted`: the caller reached a limit, such as its number of subscriptions. */
export class EventResourceExhaustedError extends EventProtocolError {
  constructor(codes: EventErrorCodes, limit: 'subscriptions' | 'verifications', max: number) {
    super(RESOURCE_LIMIT_MESSAGES[limit](max), 'EVENT_RESOURCE_EXHAUSTED', 429, codes.resourceExhausted, {
      limit,
      max,
    });
  }
}

/** `Unsupported`: the request asks for something this server or event does not offer, such as a delivery mode. */
export class EventUnsupportedError extends EventProtocolError {
  constructor(codes: EventErrorCodes, feature: string, value: string, supported: readonly string[]) {
    super(
      `"${value}" is not a supported ${feature}. Supported: ${supported.join(', ') || 'none'}.`,
      'EVENT_UNSUPPORTED',
      400,
      codes.unsupported,
      { feature, value, supported: [...supported] },
    );
  }
}

/** `CallbackEndpointError`: the callback did not prove it accepts deliveries. Only the failure category is told. */
export class EventCallbackEndpointError extends EventProtocolError {
  constructor(codes: EventErrorCodes, reason: EventDeliveryErrorCategory) {
    super(
      `The callback endpoint could not be verified (${reason}). It must answer the verification request with 2xx ` +
        'and the challenge it received.',
      'EVENT_CALLBACK_ENDPOINT_ERROR',
      400,
      codes.callbackEndpointError,
      { reason },
    );
  }
}

/** The subscription store cannot be opened as configured, or a record could not be written. */
export class EventSubscriptionStoreError extends InternalMcpError {
  constructor(message: string) {
    super(`Event subscription store: ${message}`, 'EVENT_SUBSCRIPTION_STORE');
  }
}
