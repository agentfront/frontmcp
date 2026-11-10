import { PublicMcpError } from '../errors/mcp.error';

/** The JSON-RPC error a server answered an events request of the client with. */
export class EventRequestError extends PublicMcpError {
  /** The error of `method`, with the JSON-RPC code and data the server sent. */
  constructor(
    readonly method: string,
    readonly rpcCode: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${method} failed (${rpcCode}): ${message}`, 'EVENT_REQUEST_FAILED', 400);
  }
}

/** None of the delivery modes the event offers is one this client can use. */
export class NoCompatibleDeliveryModeError extends PublicMcpError {
  /** Names the modes the event offers and the modes the client can use. */
  constructor(eventName: string, offered: readonly string[], usable: readonly string[]) {
    super(
      `Event "${eventName}" is offered by ${offered.join(', ') || 'no mode'}, and this client can use ` +
        `${usable.join(', ')}. Configure a webhook receiver, use a transport that streams, or pick another event.`,
      'NO_COMPATIBLE_DELIVERY_MODE',
      400,
    );
  }
}

/** The server ended a subscription of the client, for example because its access was revoked. */
export class EventSubscriptionTerminatedError extends PublicMcpError {
  /** Carries the error the server ended the subscription with. */
  constructor(
    readonly eventName: string,
    readonly error: { code: number; message: string; data?: Record<string, unknown> },
  ) {
    super(`The subscription to "${eventName}" was terminated by the server: ${error.message}`, 'EVENT_TERMINATED', 410);
  }
}
