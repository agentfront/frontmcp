import { InternalMcpError, PublicMcpError } from './mcp.error';

/**
 * Thrown when a method is not implemented (abstract/placeholder).
 */
export class MethodNotImplementedError extends InternalMcpError {
  constructor(className?: string, methodName?: string) {
    const msg =
      className && methodName
        ? `${className}.${methodName}() is not implemented`
        : methodName
          ? `${methodName}() is not implemented`
          : 'Method not implemented';
    super(msg, 'METHOD_NOT_IMPLEMENTED');
  }
}

/**
 * Thrown when an unsupported transport type is specified.
 */
export class UnsupportedTransportTypeError extends InternalMcpError {
  constructor(transportType: string) {
    super(`Unsupported transport type: "${transportType}"`, 'UNSUPPORTED_TRANSPORT_TYPE');
  }
}

/**
 * Thrown when a transport bus is required but not provided.
 */
export class TransportBusRequiredError extends InternalMcpError {
  constructor() {
    super('Transport bus is required', 'TRANSPORT_BUS_REQUIRED');
  }
}

/**
 * Thrown when a transport session is invalid or missing.
 */
export class InvalidTransportSessionError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'INVALID_TRANSPORT_SESSION');
  }
}

/**
 * Thrown when a transport is not connected.
 */
export class TransportNotConnectedError extends InternalMcpError {
  constructor(context?: string) {
    super(context ? `Transport not connected: ${context}` : 'Transport not connected', 'TRANSPORT_NOT_CONNECTED');
  }
}

/**
 * Thrown when a transport is already started.
 */
export class TransportAlreadyStartedError extends InternalMcpError {
  constructor(message?: string) {
    super(message || 'Transport already started', 'TRANSPORT_ALREADY_STARTED');
  }
}

/**
 * Thrown when a request has an unsupported Content-Type header.
 * This is a public error (400) since it represents a client-side issue.
 */
export class UnsupportedContentTypeError extends PublicMcpError {
  readonly contentType: string;

  constructor(contentType: string) {
    super(`Unsupported content-type: ${contentType}`, 'UNSUPPORTED_CONTENT_TYPE', 400);
    this.contentType = contentType;
  }
}

/**
 * Thrown when the transport service is required but not available on the scope.
 */
export class TransportServiceNotAvailableError extends InternalMcpError {
  constructor() {
    super('Transport service not available', 'TRANSPORT_SERVICE_NOT_AVAILABLE');
  }
}

/**
 * Thrown when an HA session takeover fails because the session is already claimed by another pod.
 */
export class SessionClaimConflictError extends InternalMcpError {
  constructor(sessionId: string) {
    super(`Session ${sessionId} claimed by another pod`, 'SESSION_CLAIM_CONFLICT');
  }
}

/**
 * Thrown when a request for an MCP session owned by another live instance of a distributed
 * deployment cannot be relayed to that instance (it does not listen on its relay channel, does
 * not acknowledge the request, or stops while serving it).
 *
 * Public (503) and retryable: the client retries after `retryAfterSeconds`. If the owner has
 * stopped, its heartbeat expires within that time and the next request takes the session over.
 */
export class SessionOwnerUnreachableError extends PublicMcpError {
  /** Seconds after which a retry can succeed (the owner's heartbeat TTL). */
  readonly retryAfterSeconds: number;
  /** Instance that owns the session. Logged, never sent to the client. */
  readonly ownerNodeId: string;
  /** Why the relay failed. Logged, never sent to the client. */
  readonly reason: string;

  constructor(ownerNodeId: string, retryAfterSeconds: number, reason: string) {
    const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
    super(
      'This MCP session is served by another instance of the server, which did not answer the relayed ' +
        `request. Retry after ${retryAfter}s; if that instance has stopped, the session is taken over by ` +
        'another instance once its heartbeat expires.',
      'SESSION_OWNER_UNREACHABLE',
      503,
    );
    this.retryAfterSeconds = retryAfter;
    this.ownerNodeId = ownerNodeId;
    this.reason = reason;
  }
}

function octalMode(mode: number): string {
  return `0${(mode & 0o7777).toString(8)}`;
}

/**
 * Thrown at startup when another user could replace a Unix socket in its directory: the directory
 * belongs to another user (not root), or the group or others can write to it and it has no sticky bit.
 */
export class UnsafeSocketDirectoryError extends InternalMcpError {
  constructor(directory: string, mode: number, ownerUid?: number) {
    const reason =
      ownerUid === undefined
        ? 'the group or others can write to it and it has no sticky bit'
        : `it belongs to another user (uid ${ownerUid})`;
    super(
      `Refusing to create a Unix socket in ${directory} (mode ${octalMode(mode)}): ${reason}. ` +
        'Use a directory only you can write to, such as ~/.frontmcp/sockets.',
      'UNSAFE_SOCKET_DIRECTORY',
    );
  }
}

/** Thrown at startup when a server is already listening on the Unix socket path. */
export class SocketInUseError extends InternalMcpError {
  constructor(socketPath: string) {
    super(`Unix socket ${socketPath} is already in use by a running server.`, 'SOCKET_IN_USE');
  }
}

/** Thrown at startup when the Unix socket path holds something the server must not remove. */
export class SocketPathConflictError extends InternalMcpError {
  constructor(socketPath: string, reason: string) {
    super(`Refusing to replace ${socketPath}: ${reason}.`, 'SOCKET_PATH_CONFLICT');
  }
}

/** Thrown at startup when a Unix socket cannot be made owner-only (0600). */
export class SocketPermissionError extends InternalMcpError {
  constructor(socketPath: string, detail: string) {
    super(`Could not make Unix socket ${socketPath} owner-only (0600): ${detail}.`, 'SOCKET_PERMISSION');
  }
}
