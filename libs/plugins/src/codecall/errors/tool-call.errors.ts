// file: libs/plugins/src/codecall/errors/tool-call.errors.ts

/**
 * Error codes exposed to AgentScript via result-based error handling.
 * These are the ONLY error codes scripts can see - no internal details.
 */
export const TOOL_CALL_ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  EXECUTION: 'EXECUTION',
  TIMEOUT: 'TIMEOUT',
  ACCESS_DENIED: 'ACCESS_DENIED',
  SELF_REFERENCE: 'SELF_REFERENCE',
} as const;

export type ToolCallErrorCode = (typeof TOOL_CALL_ERROR_CODES)[keyof typeof TOOL_CALL_ERROR_CODES];

/**
 * Sanitized error structure exposed to AgentScript.
 * Contains NO stack traces, NO internal details, NO sensitive information.
 */
export interface ToolCallError {
  readonly code: ToolCallErrorCode;
  readonly message: string;
  readonly toolName: string;
}

/**
 * Result type for callTool when throwOnError is false.
 */
export type ToolCallResult<T> = { success: true; data: T } | { success: false; error: ToolCallError };

/**
 * Options for callTool behavior.
 */
export interface CallToolOptions {
  /**
   * When true (default), errors are thrown and can be caught.
   * When false, errors are returned as { success: false, error: ToolCallError }.
   *
   * SECURITY: Even when throwOnError is true, only sanitized errors are thrown.
   * Internal security guard errors are NEVER exposed to scripts.
   */
  throwOnError?: boolean;
}

/**
 * Creates a sanitized ToolCallError for script consumption.
 * This function ensures no internal details leak to AgentScript.
 */
export function createToolCallError(code: ToolCallErrorCode, toolName: string, rawMessage?: string): ToolCallError {
  // Sanitize message - remove any potentially sensitive information
  const sanitizedMessage = getSanitizedMessage(code, toolName, rawMessage);

  return Object.freeze({
    code,
    message: sanitizedMessage,
    toolName,
  });
}

/**
 * Get a safe, generic message for each error code.
 * Internal details are NEVER included.
 */
function getSanitizedMessage(code: ToolCallErrorCode, toolName: string, rawMessage?: string): string {
  switch (code) {
    case TOOL_CALL_ERROR_CODES.NOT_FOUND:
      return `Tool "${toolName}" was not found`;

    case TOOL_CALL_ERROR_CODES.VALIDATION:
      // For validation, we can include a sanitized version of the message
      // but strip any internal paths or stack traces
      return rawMessage ? sanitizeValidationMessage(rawMessage) : `Input validation failed for tool "${toolName}"`;

    case TOOL_CALL_ERROR_CODES.EXECUTION:
      return `Tool "${toolName}" execution failed`;

    case TOOL_CALL_ERROR_CODES.TIMEOUT:
      return `Tool "${toolName}" execution timed out`;

    case TOOL_CALL_ERROR_CODES.ACCESS_DENIED:
      return `Access denied for tool "${toolName}"`;

    case TOOL_CALL_ERROR_CODES.SELF_REFERENCE:
      return `Cannot call CodeCall tools from within AgentScript`;

    default:
      return `An error occurred while calling "${toolName}"`;
  }
}

/**
 * Sanitize validation error messages to remove internal details.
 */
function sanitizeValidationMessage(message: string): string {
  // Remove file paths (Unix and Windows)
  let sanitized = message.replace(/(?:\/[\w.-]+)+|(?:[A-Za-z]:\\[\w\\.-]+)+/g, '[path]');

  // Remove line numbers and stack traces
  sanitized = sanitized.replace(/\bat line \d+/gi, '');
  sanitized = sanitized.replace(/\bline \d+/gi, '');
  sanitized = sanitized.replace(/:\d+:\d+/g, '');

  // Remove "at" stack trace lines
  sanitized = sanitized.replace(/\n\s*at .*/g, '');

  // Truncate if too long (prevent information disclosure via long messages)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }

  return sanitized.trim();
}

/**
 * FATAL: Self-reference attack detected.
 * This error is thrown internally and causes immediate execution termination.
 * The script NEVER sees this error - it only sees the sanitized version.
 */
export class SelfReferenceError extends Error {
  readonly code = TOOL_CALL_ERROR_CODES.SELF_REFERENCE;
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Self-reference attack: Attempted to call CodeCall tool "${toolName}" from within AgentScript`);
    this.name = 'SelfReferenceError';
    this.toolName = toolName;
    Object.freeze(this);
  }
}

/**
 * Internal error for tool access denial.
 * Only the sanitized version is exposed to scripts.
 */
export class ToolAccessDeniedError extends Error {
  readonly code = TOOL_CALL_ERROR_CODES.ACCESS_DENIED;
  readonly toolName: string;
  readonly reason: string;

  constructor(toolName: string, reason: string) {
    super(`Access denied for tool "${toolName}": ${reason}`);
    this.name = 'ToolAccessDeniedError';
    this.toolName = toolName;
    this.reason = reason;
    Object.freeze(this);
  }
}

/**
 * Internal error for tool not found.
 * Only the sanitized version is exposed to scripts.
 */
export class ToolNotFoundError extends Error {
  readonly code = TOOL_CALL_ERROR_CODES.NOT_FOUND;
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool "${toolName}" not found`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
    Object.freeze(this);
  }
}
