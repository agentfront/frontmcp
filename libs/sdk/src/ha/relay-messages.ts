/**
 * Messages carried on a node's HA relay channel (`{redisKeyPrefix}notify:{nodeId}`).
 *
 * Every node subscribes to its own channel. Other nodes publish to it to deliver
 * a notification to a session it owns, ask it to destroy one, or relay an HTTP
 * request for one of its sessions and receive the response back on their own
 * channel.
 */

/** A notification for a session owned by the receiving node. */
export interface NotificationRelayMessage {
  /** Absent on messages published before relay kinds existed. */
  kind?: 'notification';
  /** Target session ID */
  sessionId: string;
  /** MCP notification to deliver */
  notification: {
    method: string;
    params?: Record<string, unknown>;
  };
  /** Source pod that originated the notification */
  sourceNodeId: string;
  /** Timestamp of relay */
  timestamp: number;
}

/** Ask the receiving node to destroy its transport for a session. */
export interface DestroySessionRelayMessage {
  kind: 'destroy-session';
  sessionId: string;
  reason?: string;
  sourceNodeId: string;
  timestamp: number;
}

/** The parts of an HTTP request a relayed request carries to the session owner. */
export interface RelayedHttpRequest {
  method: string;
  /** Path and query, as received (`/mcp?x=1`). */
  url: string;
  /** Path without the query (`/mcp`). */
  path: string;
  headers: Record<string, string | string[]>;
  query: Record<string, unknown>;
  /** The parsed body (JSON), when the request had one. */
  body?: unknown;
  /** `http` or `https`, as the receiving node saw it. */
  protocol?: string;
  /** Whether the client connection to the receiving node was TLS. */
  encrypted?: boolean;
  /** Socket peer address of the client on the receiving node. */
  peerAddress?: string;
}

/** An HTTP request for a session the receiving node owns. */
export interface RequestRelayMessage {
  kind: 'relay-request';
  /** Correlates the response frames with this request. */
  requestId: string;
  /** Node that received the request; the response frames are published to it. */
  sourceNodeId: string;
  sessionId: string;
  request: RelayedHttpRequest;
  timestamp: number;
}

/** One step of a relayed response, in the order the owner produced it. */
export type RelayResponseEvent =
  /** The owner received the request and is serving it. */
  | { event: 'ack' }
  /** Status line and headers. */
  | { event: 'head'; status: number; headers: Record<string, string | string[]> }
  /** A body chunk (`base64` for bytes, `utf8` for text). */
  | { event: 'data'; data: string; encoding: 'utf8' | 'base64' }
  /** The response is complete. */
  | { event: 'end' }
  /** The owner could not finish the response. */
  | { event: 'error'; message: string };

/** A response frame for a relayed request, published back to the node that relayed it. */
export type ResponseRelayMessage = {
  kind: 'relay-response';
  requestId: string;
  /** The owner that served the request. */
  sourceNodeId: string;
} & RelayResponseEvent;

/** The relaying node's client went away: stop serving the request. */
export interface CancelRelayMessage {
  kind: 'relay-cancel';
  requestId: string;
  sourceNodeId: string;
}

/** Any message on a node's relay channel. */
export type HaRelayMessage =
  | NotificationRelayMessage
  | DestroySessionRelayMessage
  | RequestRelayMessage
  | ResponseRelayMessage
  | CancelRelayMessage;

/** Kinds of the request-relay messages. */
export type RequestRelayKind = 'relay-request' | 'relay-response' | 'relay-cancel';

/** Whether a relay channel message belongs to a relayed HTTP request. */
export function isRequestRelayMessage(
  message: HaRelayMessage,
): message is RequestRelayMessage | ResponseRelayMessage | CancelRelayMessage {
  return message.kind === 'relay-request' || message.kind === 'relay-response' || message.kind === 'relay-cancel';
}
