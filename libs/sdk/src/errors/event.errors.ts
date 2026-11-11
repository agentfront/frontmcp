import type { EventDeliveryErrorCategory, EventsErrorName } from '@frontmcp/protocol';

import { InternalMcpError, PublicMcpError } from './mcp.error';

/** Thrown at startup when two events of a server declare the same name: a subscription names its event by it. */
export class EventNameConflictError extends InternalMcpError {
  /** Names the event that is declared twice. */
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
  /** Takes the public message, the HTTP status, and the JSON-RPC code and `data` the client receives. */
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
  /** Names the event or subscription that does not exist, with the code of the caller's dialect. */
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
  /** Says why the caller may not use the event, with the code of the caller's dialect. */
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
  /** Names the limit that was reached and its ceiling. */
  constructor(codes: EventErrorCodes, limit: 'subscriptions' | 'verifications', max: number) {
    super(RESOURCE_LIMIT_MESSAGES[limit](max), 'EVENT_RESOURCE_EXHAUSTED', 429, codes.resourceExhausted, {
      limit,
      max,
    });
  }
}

/** `Unsupported`: the request asks for something this server or event does not offer, such as a delivery mode. */
export class EventUnsupportedError extends EventProtocolError {
  /** Names the unsupported option, the value asked for and what is supported. */
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
  /** Carries the fixed category of the callback failure, never the endpoint's answer. */
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
  /** An internal store failure, with its message. */
  constructor(message: string) {
    super(`Event subscription store: ${message}`, 'EVENT_SUBSCRIPTION_STORE');
  }
}

/** The HTTP publish endpoint cannot be served as configured; thrown at startup. */
export class EventPublishEndpointError extends InternalMcpError {
  /** Says what about the endpoint's configuration is wrong. */
  constructor(message: string) {
    super(`Event publish endpoint: ${message}`, 'EVENT_PUBLISH_ENDPOINT');
  }
}

/** Publishing on a server that has no events: none is declared, or `events.enabled` is `false`. */
export class EventsNotEnabledError extends InternalMcpError {
  /** Says that the server has events turned off or declares none. */
  constructor() {
    super(
      "Events are not enabled on this server, so nothing can be published. List the event in an app's `events`, " +
        'and remove events.enabled: false if it is set.',
      'EVENTS_NOT_ENABLED',
    );
  }
}

/** Publishing an event the server does not have. */
export class EventNotRegisteredError extends InternalMcpError {
  /** Names the event that was published but is not registered. */
  constructor(eventName: string) {
    super(
      `Event "${eventName}" is not registered, so it cannot be published. List it in the \`events\` of an app.`,
      'EVENT_NOT_REGISTERED',
    );
  }
}

/** Publishing `data` that does not match the event's `payloadSchema`, or options that cannot be used. */
export class InvalidEventPublishError extends InternalMcpError {
  /** Names the event and what is wrong with the data or options it was published with. */
  constructor(eventName: string, problem: string) {
    super(`Event "${eventName}" cannot be published: ${problem}`, 'INVALID_EVENT_PUBLISH');
  }
}
