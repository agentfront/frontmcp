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
