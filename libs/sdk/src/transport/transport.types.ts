import { type ServerRequest, type ServerResponse } from '../common';
import { type AuthenticatedServerRequest } from '../server/server.types';

export type TransportType = 'sse' | 'streamable-http' | 'http' | 'stateless-http' | 'in-memory' | 'stdio';

/** Session id the stateless HTTP transport gives every request; it identifies no client. */
export const STATELESS_SESSION_ID = '__stateless__';

export interface TransportKey {
  type: TransportType;
  token: string;
  tokenHash: string;
  sessionId: string;
  sessionIdSse?: string;
}

export interface RemoteLocation {
  nodeId: string;
  channel: string;
}

/**
 * Distributed session registry: which node owns which session, and the relay that
 * serves a request on the owning node.
 */
export interface TransportBus {
  nodeId(): string;

  /** Record that this node owns the session. */
  advertise(key: TransportKey): Promise<void>;

  /** Drop this node's ownership record (only when it still owns the session). */
  revoke(key: TransportKey): Promise<void>;

  /** The node owning this exact session (same type and token), unless it is this node. */
  lookup(key: TransportKey): Promise<RemoteLocation | null>;

  /** The node owning a session id, whatever its type or token — this node included. */
  lookupOwner(sessionId: string): Promise<RemoteLocation | null>;

  /** Relay channel of a node. */
  channelOf(nodeId: string): string;

  /** Whether requests can be relayed to another node from here. */
  canRelay(): boolean;

  /**
   * Serve a request on the node that owns its session and write that node's response.
   * @throws SessionOwnerUnreachableError when the owner could not serve it (nothing written yet).
   */
  proxyRequest(
    location: RemoteLocation,
    sessionId: string,
    request: ServerRequest,
    response: ServerResponse,
  ): Promise<void>;

  /** Ask the owning node to destroy its transport for the session. */
  destroyRemote(key: TransportKey, reason?: string): Promise<void>;
}

/* --------------------------------- API ---------------------------------- */

export interface Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  destroy(reason?: string): Promise<void>;

  ping(timeoutMs?: number): Promise<boolean>;

  /**
   * Whether this transport has already been initialized via the MCP initialize handshake.
   */
  readonly isInitialized: boolean;

  /**
   * Marks this transport as pre-initialized for session recreation.
   * This is needed when recreating a transport from Redis because the
   * original initialize request was processed by a different transport instance.
   */
  markAsInitialized(): void;

  /**
   * Resets initialization state to allow re-initialization.
   * Used when a client retries initialize on an already-initialized transport
   * (e.g., after reconnect following session termination).
   */
  resetForReinitialization(): void;

  /**
   * Re-register the MCP server with the notification service after re-initialization.
   * Called after resetForReinitialization() to restore the server mapping
   * that was removed by terminateSession during DELETE.
   */
  reregisterServer(): void;
}

export interface TransportRegistryOptions {
  distributed?: boolean;
  bus?: TransportBus;
}

export type TransportTokenBucket = Map<string, Transporter>; // sessionHash -> Transporter
export type TransportTypeBucket = Map<string, TransportTokenBucket>; // tokenHash   -> TokenBucket
export type TransportRegistryBucket = Map<TransportType, TransportTypeBucket>; // tokenHash   -> TokenBucket
