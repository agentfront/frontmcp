/**
 * @file remote.errors.ts
 * @description Error classes for remote MCP server connections and operations
 */

import { PublicMcpError, InternalMcpError, MCP_ERROR_CODES } from './mcp.error';

// ═══════════════════════════════════════════════════════════════════
// CONNECTION ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when connection to a remote MCP server fails
 */
export class RemoteConnectionError extends InternalMcpError {
  readonly appId: string;
  readonly url: string;
  readonly originalError?: Error;

  constructor(appId: string, url: string, originalError?: Error) {
    super(
      `Failed to connect to remote MCP server "${appId}" at ${url}: ${originalError?.message || 'Connection failed'}`,
      'REMOTE_CONNECTION_ERROR',
    );
    this.appId = appId;
    this.url = url;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when a remote MCP server disconnects unexpectedly
 */
export class RemoteDisconnectError extends InternalMcpError {
  readonly appId: string;
  readonly reason?: string;

  constructor(appId: string, reason?: string) {
    super(
      `Remote MCP server "${appId}" disconnected unexpectedly${reason ? `: ${reason}` : ''}`,
      'REMOTE_DISCONNECT_ERROR',
    );
    this.appId = appId;
    this.reason = reason;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TIMEOUT ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when a remote MCP operation times out
 */
export class RemoteTimeoutError extends PublicMcpError {
  readonly appId: string;
  readonly operation: string;
  readonly timeoutMs: number;
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(appId: string, operation: string, timeoutMs: number) {
    super(`Remote operation "${operation}" on "${appId}" timed out after ${timeoutMs}ms`, 'REMOTE_TIMEOUT_ERROR', 504);
    this.appId = appId;
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

// ═══════════════════════════════════════════════════════════════════
// NOT FOUND ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when a tool is not found on the remote server
 */
export class RemoteToolNotFoundError extends PublicMcpError {
  readonly appId: string;
  readonly toolName: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.METHOD_NOT_FOUND;

  constructor(appId: string, toolName: string) {
    super(`Tool "${toolName}" not found on remote server "${appId}"`, 'REMOTE_TOOL_NOT_FOUND', 404);
    this.appId = appId;
    this.toolName = toolName;
  }
}

/**
 * Error thrown when a resource is not found on the remote server
 */
export class RemoteResourceNotFoundError extends PublicMcpError {
  readonly appId: string;
  readonly uri: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.RESOURCE_NOT_FOUND;

  constructor(appId: string, uri: string) {
    super(`Resource "${uri}" not found on remote server "${appId}"`, 'REMOTE_RESOURCE_NOT_FOUND', 404);
    this.appId = appId;
    this.uri = uri;
  }
}

/**
 * Error thrown when a prompt is not found on the remote server
 */
export class RemotePromptNotFoundError extends PublicMcpError {
  readonly appId: string;
  readonly promptName: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.METHOD_NOT_FOUND;

  constructor(appId: string, promptName: string) {
    super(`Prompt "${promptName}" not found on remote server "${appId}"`, 'REMOTE_PROMPT_NOT_FOUND', 404);
    this.appId = appId;
    this.promptName = promptName;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when authentication to a remote server fails (missing credentials)
 */
export class RemoteAuthError extends PublicMcpError {
  readonly appId: string;
  readonly details?: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  constructor(appId: string, details?: string) {
    super(
      `Authentication failed for remote server "${appId}"${details ? `: ${details}` : ''}`,
      'REMOTE_AUTH_ERROR',
      401,
    );
    this.appId = appId;
    this.details = details;
  }
}

/**
 * Error thrown when authorization to a remote resource/tool fails (invalid/insufficient credentials)
 */
export class RemoteAuthorizationError extends PublicMcpError {
  readonly appId: string;
  readonly resource?: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.FORBIDDEN;

  constructor(appId: string, resource?: string) {
    super(
      `Access denied to remote server "${appId}"${resource ? ` for "${resource}"` : ''}`,
      'REMOTE_AUTHORIZATION_ERROR',
      403,
    );
    this.appId = appId;
    this.resource = resource;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTION ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when a remote tool execution fails
 */
export class RemoteToolExecutionError extends PublicMcpError {
  readonly appId: string;
  readonly toolName: string;
  readonly originalError?: Error;
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(appId: string, toolName: string, originalError?: Error) {
    super(
      `Remote tool "${toolName}" on "${appId}" failed: ${originalError?.message || 'Execution error'}`,
      'REMOTE_TOOL_EXECUTION_ERROR',
      500,
    );
    this.appId = appId;
    this.toolName = toolName;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when a remote resource read fails
 */
export class RemoteResourceReadError extends PublicMcpError {
  readonly appId: string;
  readonly uri: string;
  readonly originalError?: Error;
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(appId: string, uri: string, originalError?: Error) {
    super(
      `Remote resource "${uri}" on "${appId}" read failed: ${originalError?.message || 'Read error'}`,
      'REMOTE_RESOURCE_READ_ERROR',
      500,
    );
    this.appId = appId;
    this.uri = uri;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when a remote prompt get fails
 */
export class RemotePromptGetError extends PublicMcpError {
  readonly appId: string;
  readonly promptName: string;
  readonly originalError?: Error;
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(appId: string, promptName: string, originalError?: Error) {
    super(
      `Remote prompt "${promptName}" on "${appId}" get failed: ${originalError?.message || 'Get error'}`,
      'REMOTE_PROMPT_GET_ERROR',
      500,
    );
    this.appId = appId;
    this.promptName = promptName;
    this.originalError = originalError;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when transport initialization fails
 */
export class RemoteTransportError extends InternalMcpError {
  readonly appId: string;
  readonly transportType: string;
  readonly originalError?: Error;

  constructor(appId: string, transportType: string, originalError?: Error) {
    super(
      `Transport "${transportType}" initialization failed for "${appId}": ${originalError?.message || 'Unknown error'}`,
      'REMOTE_TRANSPORT_ERROR',
    );
    this.appId = appId;
    this.transportType = transportType;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when transport type is not supported
 */
export class RemoteUnsupportedTransportError extends PublicMcpError {
  readonly transportType: string;

  constructor(transportType: string) {
    super(`Unsupported remote transport type: "${transportType}"`, 'REMOTE_UNSUPPORTED_TRANSPORT', 400);
    this.transportType = transportType;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CAPABILITY ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when capability discovery fails
 */
export class RemoteCapabilityDiscoveryError extends InternalMcpError {
  readonly appId: string;
  readonly originalError?: Error;

  constructor(appId: string, originalError?: Error) {
    super(
      `Failed to discover capabilities for remote server "${appId}": ${originalError?.message || 'Unknown error'}`,
      'REMOTE_CAPABILITY_DISCOVERY_ERROR',
    );
    this.appId = appId;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when remote server doesn't support required capability
 */
export class RemoteCapabilityNotSupportedError extends PublicMcpError {
  readonly appId: string;
  readonly capability: string;

  constructor(appId: string, capability: string) {
    super(
      `Remote server "${appId}" does not support capability: ${capability}`,
      'REMOTE_CAPABILITY_NOT_SUPPORTED',
      400,
    );
    this.appId = appId;
    this.capability = capability;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when remote app configuration is invalid
 */
export class RemoteConfigurationError extends PublicMcpError {
  readonly appId: string;
  readonly configField?: string;
  readonly details?: string;

  constructor(appId: string, configField?: string, details?: string) {
    const message = configField
      ? `Invalid configuration for remote app "${appId}": field "${configField}"${details ? ` - ${details}` : ''}`
      : `Invalid configuration for remote app "${appId}"${details ? `: ${details}` : ''}`;
    super(message, 'REMOTE_CONFIGURATION_ERROR', 400);
    this.appId = appId;
    this.configField = configField;
    this.details = details;
  }
}

/**
 * Error thrown when remote app is not connected
 */
export class RemoteNotConnectedError extends PublicMcpError {
  readonly appId: string;

  constructor(appId: string) {
    super(`Remote app "${appId}" is not connected`, 'REMOTE_NOT_CONNECTED', 503);
    this.appId = appId;
  }
}
