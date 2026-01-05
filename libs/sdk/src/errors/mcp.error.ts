// errors/mcp.error.ts
import { randomBytes, bytesToHex } from '@frontmcp/utils';

/**
 * MCP-specific error codes per JSON-RPC specification.
 * These codes are used in the JSON-RPC error response format.
 */
export const MCP_ERROR_CODES = {
  /** Unauthorized - missing credentials (-32001) */
  UNAUTHORIZED: -32001,
  /** Resource not found (-32002) */
  RESOURCE_NOT_FOUND: -32002,
  /** Forbidden - invalid or insufficient credentials (-32003) */
  FORBIDDEN: -32003,
  /** Invalid request (-32600) */
  INVALID_REQUEST: -32600,
  /** Method not found (-32601) */
  METHOD_NOT_FOUND: -32601,
  /** Invalid params (-32602) */
  INVALID_PARAMS: -32602,
  /** Internal error (-32603) */
  INTERNAL_ERROR: -32603,
  /** Parse error (-32700) */
  PARSE_ERROR: -32700,
} as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES];

/**
 * Base class for all MCP-related errors
 */
export abstract class McpError extends Error {
  /**
   * Unique error ID for tracking in logs
   */
  errorId: string;

  /**
   * Whether this error should expose details to the client
   */
  abstract readonly isPublic: boolean;

  /**
   * HTTP status code equivalent (for reference)
   */
  abstract readonly statusCode: number;

  /**
   * Error code for categorization
   */
  abstract readonly code: string;

  protected constructor(message: string, errorId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.errorId = errorId || this.generateErrorId();
    Error.captureStackTrace(this, this.constructor);
  }

  private generateErrorId(): string {
    return `err_${bytesToHex(randomBytes(8))}`;
  }

  /**
   * Get the public-facing error message
   */
  abstract getPublicMessage(): string;

  /**
   * Get the internal error message (for logging)
   */
  getInternalMessage(): string {
    return this.message;
  }

  /**
   * Convert to MCP error response format
   */
  toMcpError(isDevelopment = false): {
    content: Array<{ type: 'text'; text: string }>;
    isError: true;
    _meta?: {
      errorId: string;
      code: string;
      timestamp: string;
      stack?: string;
    };
  } {
    const message = isDevelopment ? this.getInternalMessage() : this.getPublicMessage();

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
      _meta: {
        errorId: this.errorId,
        code: this.code,
        timestamp: new Date().toISOString(),
        ...(isDevelopment && { stack: this.stack }),
      },
    };
  }
}

/**
 * Public errors - safe to expose to clients
 * These include validation errors, not found errors, etc.
 */
export class PublicMcpError extends McpError {
  readonly isPublic = true;
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code = 'PUBLIC_ERROR', statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }

  getPublicMessage(): string {
    return this.message;
  }
}

/**
 * Internal errors - should not expose details to clients
 * These are server errors, unexpected failures, etc.
 */
export class InternalMcpError extends McpError {
  readonly isPublic = false;
  readonly statusCode = 500;
  readonly code: string;

  constructor(message: string, code = 'INTERNAL_ERROR') {
    super(message);
    this.code = code;
  }

  getPublicMessage(): string {
    return `Internal FrontMCP error. Please contact support with error ID: ${this.errorId}`;
  }
}

// ============================================================================
// Specific Error Classes
// ============================================================================

/**
 * Tool not found error
 */
export class ToolNotFoundError extends PublicMcpError {
  constructor(toolName: string) {
    super(`Tool "${toolName}" not found`, 'TOOL_NOT_FOUND', 404);
  }
}

/**
 * Resource not found error
 */
export class ResourceNotFoundError extends PublicMcpError {
  readonly uri: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.RESOURCE_NOT_FOUND;

  constructor(uri: string) {
    super(`Resource not found: ${uri}`, 'RESOURCE_NOT_FOUND', 404);
    this.uri = uri;
  }

  /**
   * Convert to JSON-RPC error format per MCP specification.
   *
   * @example
   * {
   *   "code": -32002,
   *   "message": "Resource not found: file:///missing.txt",
   *   "data": { "uri": "file:///missing.txt" }
   * }
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data?: { uri: string };
  } {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: { uri: this.uri },
    };
  }
}

/**
 * Resource read error (internal)
 */
export class ResourceReadError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(uri: string, originalError?: Error) {
    super(`Resource "${uri}" read failed: ${originalError?.message || 'Unknown error'}`, 'RESOURCE_READ_ERROR');
    this.originalError = originalError;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

/**
 * Invalid resource URI error
 */
export class InvalidResourceUriError extends PublicMcpError {
  constructor(uri: string, reason?: string) {
    super(`Invalid resource URI: ${uri}${reason ? ` (${reason})` : ''}`, 'INVALID_RESOURCE_URI', 400);
  }
}

/**
 * Invalid input validation error
 */
export class InvalidInputError extends PublicMcpError {
  readonly validationErrors?: any;

  constructor(message = 'Invalid input: validation failed', validationErrors?: any) {
    super(message, 'INVALID_INPUT', 400);
    this.validationErrors = validationErrors;
  }

  override getInternalMessage(): string {
    return this.message + (this.validationErrors ? `\nDetails: ${JSON.stringify(this.validationErrors, null, 2)}` : '');
  }
  override getPublicMessage(): string {
    if (this.validationErrors) {
      return `${this.message}\nDetails: ${JSON.stringify(this.validationErrors, null, 2)}`;
    }
    return this.message;
  }
}

/**
 * Invalid output validation error (internal - don't expose schema details)
 */
export class InvalidOutputError extends InternalMcpError {
  private readonly hasCustomErrorId: boolean;

  constructor(errorId?: string) {
    super('Tool output validation failed', 'INVALID_OUTPUT');
    this.hasCustomErrorId = !!errorId;
    if (errorId) {
      this.errorId = errorId;
    }
  }

  override getPublicMessage(): string {
    // If a custom errorId was provided (e.g., request ID), include it for correlation
    // Otherwise, use a simpler message since the auto-generated ID isn't meaningful to users
    if (this.hasCustomErrorId) {
      return `Output validation failed. Please contact support with error ID: ${this.errorId}`;
    }
    return 'Output validation failed. Please contact support.';
  }
}

/**
 * Invalid method error
 */
export class InvalidMethodError extends PublicMcpError {
  constructor(method: string, expected: string) {
    super(`Invalid method "${method}". Expected "${expected}"`, 'INVALID_METHOD', 400);
  }
}

/**
 * Tool execution error (internal)
 */
export class ToolExecutionError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(toolName: string, originalError?: Error) {
    super(`Tool "${toolName}" execution failed: ${originalError?.message || 'Unknown error'}`, 'TOOL_EXECUTION_ERROR');
    this.originalError = originalError;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends PublicMcpError {
  constructor(retryAfter?: number) {
    const message = retryAfter ? `Rate limit exceeded. Retry after ${retryAfter} seconds` : 'Rate limit exceeded';
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
  }
}

/**
 * Quota exceeded error
 */
export class QuotaExceededError extends PublicMcpError {
  constructor(quotaType = 'usage') {
    super(`${quotaType} quota exceeded`, 'QUOTA_EXCEEDED', 429);
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends PublicMcpError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/**
 * Generic server error wrapper
 */
export class GenericServerError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message, 'SERVER_ERROR');
    this.originalError = originalError;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

/**
 * Dependency not found error (internal) - thrown when a required dependency
 * is not found in a registry during initialization.
 */
export class DependencyNotFoundError extends InternalMcpError {
  constructor(registryName: string, dependencyName: string) {
    super(`Dependency "${dependencyName}" not found in ${registryName}`, 'DEPENDENCY_NOT_FOUND');
  }
}

/**
 * Invalid hook flow error - thrown when a hook is registered with a flow
 * that is not supported by the entry type (e.g., tool hook on resource class).
 */
export class InvalidHookFlowError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'INVALID_HOOK_FLOW');
  }
}

/**
 * Invalid plugin scope error - thrown when a plugin with scope='server'
 * is used in a standalone app, which is not allowed.
 */
export class InvalidPluginScopeError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'INVALID_PLUGIN_SCOPE');
  }
}

/**
 * Request context not available error - thrown when code attempts to access
 * RequestContext outside of a request scope (i.e., without AsyncLocalStorage context).
 */
export class RequestContextNotAvailableError extends InternalMcpError {
  constructor(
    message = 'RequestContext not available. Ensure execution runs within a request scope created by RequestContextStorage.run().',
  ) {
    super(message, 'REQUEST_CONTEXT_NOT_AVAILABLE');
  }
}

/**
 * Auth configuration error - thrown when auth configuration is invalid
 * (e.g., transparent mode on parent with multiple child providers).
 */
export class AuthConfigurationError extends PublicMcpError {
  readonly errors: string[];
  readonly suggestion?: string;

  constructor(message: string, options?: { errors?: string[]; suggestion?: string }) {
    super(message, 'AUTH_CONFIGURATION_ERROR', 500);
    this.errors = options?.errors ?? [message];
    this.suggestion = options?.suggestion;
  }

  override getPublicMessage(): string {
    let msg = this.message;
    if (this.suggestion) {
      msg += `\n\nTo fix this issue:\n${this.suggestion}`;
    }
    return msg;
  }
}

// ============================================================================
// Prompt Errors
// ============================================================================

/**
 * Prompt not found error.
 */
export class PromptNotFoundError extends PublicMcpError {
  constructor(promptName: string) {
    super(`Prompt not found: ${promptName}`, 'PROMPT_NOT_FOUND', 404);
  }
}

/**
 * Prompt execution error - wraps errors during prompt execution.
 */
export class PromptExecutionError extends InternalMcpError {
  readonly promptName: string;
  readonly originalError?: Error;

  constructor(promptName: string, cause?: Error) {
    super(
      cause ? `Prompt execution failed: ${cause.message}` : `Prompt execution failed: ${promptName}`,
      'PROMPT_EXECUTION_FAILED',
    );
    this.promptName = promptName;
    this.originalError = cause;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

// ============================================================================
// Session & Client Errors
// ============================================================================

/**
 * Session missing error - thrown when a request is made without a valid session.
 * This is a public error as the client needs to know they need to authenticate.
 */
export class SessionMissingError extends PublicMcpError {
  constructor(message = 'Unauthorized: missing session') {
    super(message, 'SESSION_MISSING', 401);
  }
}

/**
 * Unsupported client version error - thrown when a client connects with
 * an unsupported protocol version.
 */
export class UnsupportedClientVersionError extends PublicMcpError {
  readonly clientVersion: string;

  constructor(version: string) {
    super(`Unsupported client version: ${version}`, 'UNSUPPORTED_CLIENT_VERSION', 400);
    this.clientVersion = version;
  }

  /**
   * Factory method for creating from a version string.
   */
  static fromVersion(version: string): UnsupportedClientVersionError {
    return new UnsupportedClientVersionError(version);
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

/**
 * Global configuration not found error - thrown when a plugin requires
 * global configuration that is not defined in @FrontMcp decorator.
 */
export class GlobalConfigNotFoundError extends PublicMcpError {
  readonly pluginName: string;
  readonly configKey: string;

  constructor(pluginName: string, configKey: string) {
    super(
      `Plugin "${pluginName}" requires global "${configKey}" configuration. ` +
        `Add "${configKey}" to your @FrontMcp decorator options.`,
      'GLOBAL_CONFIG_NOT_FOUND',
      500,
    );
    this.pluginName = pluginName;
    this.configKey = configKey;
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Check if the error is a public error that can be safely shown to users
 */
export function isPublicError(error: any): error is PublicMcpError {
  return error instanceof McpError && error.isPublic;
}

/**
 * Convert any error to an MCP error
 */
export function toMcpError(error: any): McpError {
  if (error instanceof McpError) {
    return error;
  }

  if (error instanceof Error) {
    return new GenericServerError(error.message, error);
  }

  return new GenericServerError(String(error));
}

/**
 * Format error for MCP response
 */
export function formatMcpErrorResponse(error: any, isDevelopment: boolean = process.env['NODE_ENV'] !== 'production') {
  const mcpError = toMcpError(error);
  return mcpError.toMcpError(isDevelopment);
}
