/**
 * The error API of the MCP SDK v1 (`McpError`, `ErrorCode`), kept on top of the v2 `ProtocolError`.
 *
 * v2 renamed `McpError` to `ProtocolError`, moved the transport codes (connection closed, request timeout) to
 * `SdkError` with string codes, and dropped the `MCP error <code>: ` prefix from the message. FrontMCP's handlers
 * still throw `McpError`, so this class keeps the v1 message and code, and matches every v2 `ProtocolError`.
 */
import { ProtocolError, ProtocolErrorCode, SdkError, SdkErrorCode } from '@modelcontextprotocol/server';

/** The v1 `ErrorCode` enum: the JSON-RPC codes plus the SDK's own -32000 and -32001. */
export const ErrorCode = {
  ConnectionClosed: -32000,
  RequestTimeout: -32001,
  ParseError: ProtocolErrorCode.ParseError,
  InvalidRequest: ProtocolErrorCode.InvalidRequest,
  MethodNotFound: ProtocolErrorCode.MethodNotFound,
  InvalidParams: ProtocolErrorCode.InvalidParams,
  InternalError: ProtocolErrorCode.InternalError,
  UrlElicitationRequired: ProtocolErrorCode.UrlElicitationRequired,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** A protocol error with the v1 message (`MCP error <code>: <message>`). `instanceof` matches any v2 `ProtocolError`. */
export class McpError extends ProtocolError {
  constructor(code: number, message: string, data?: unknown) {
    super(code, `MCP error ${code}: ${message}`, data);
    this.name = 'McpError';
  }

  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === McpError
      ? value instanceof ProtocolError
      : Function.prototype[Symbol.hasInstance].call(this, value);
  }

  static override fromError(code: number, message: string, data?: unknown): McpError {
    return ProtocolError.fromError(code, message, data) as McpError;
  }
}

/**
 * v1 failed a request that timed out or whose connection closed with `McpError(-32001)` or `McpError(-32000)`; v2
 * fails it with an `SdkError` whose code is a string. FrontMCP checks for v1's codes (an elicitation that times out
 * becomes `ElicitationTimeoutError`), so requests the compat server sends fail as on v1.
 */
export function toV1RequestError(error: unknown): unknown {
  if (!SdkError.isInstance(error)) return error;
  const code =
    error.code === SdkErrorCode.RequestTimeout
      ? ErrorCode.RequestTimeout
      : error.code === SdkErrorCode.ConnectionClosed
        ? ErrorCode.ConnectionClosed
        : undefined;
  if (code === undefined) return error;
  const v1Error = new McpError(code, error.message, error.data);
  v1Error.cause = error;
  return v1Error;
}
