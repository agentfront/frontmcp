/**
 * @file mcp-test-client.types.ts
 * @description Type definitions for the MCP Test Client
 */

import type {
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from '@modelcontextprotocol/sdk/types.js';

// ═══════════════════════════════════════════════════════════════════
// JSON-RPC TYPES (simplified for testing)
// ═══════════════════════════════════════════════════════════════════

/**
 * Simplified JSON-RPC request type for testing
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Simplified JSON-RPC response type for testing
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT TYPES
// ═══════════════════════════════════════════════════════════════════

export type TestTransportType = 'sse' | 'streamable-http';

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

// ═══════════════════════════════════════════════════════════════════
// AUTH TYPES
// ═══════════════════════════════════════════════════════════════════

export interface TestAuthConfig {
  /** Bearer token for authentication */
  token?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface McpTestClientConfig {
  /** Base URL of the MCP server */
  baseUrl: string;
  /** Transport type to use (default: 'streamable-http') */
  transport?: TestTransportType;
  /** Authentication configuration */
  auth?: TestAuthConfig;
  /**
   * Enable public mode - skip authentication entirely.
   * When true, no Authorization header is sent and anonymous token is not requested.
   * Use this for testing public/unauthenticated endpoints in CI/CD pipelines.
   */
  publicMode?: boolean;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** MCP protocol version to request (default: '2024-11-05') */
  protocolVersion?: string;
  /** Client info to send during initialization */
  clientInfo?: {
    name: string;
    version: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface McpResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (if successful) */
  data?: T;
  /** Error information (if failed) */
  error?: McpErrorInfo;
  /** Request duration in milliseconds */
  durationMs: number;
  /** Request ID used for this request */
  requestId: string | number;
}

export interface McpErrorInfo {
  /** JSON-RPC error code */
  code: number;
  /** Error message */
  message: string;
  /** Additional error data */
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL RESULT WRAPPER
// ═══════════════════════════════════════════════════════════════════

export interface ToolResultWrapper {
  /** Raw CallToolResult from MCP */
  raw: CallToolResult;
  /** Whether the tool call was successful (no isError flag) */
  isSuccess: boolean;
  /** Whether the tool call failed */
  isError: boolean;
  /** Error information if failed */
  error?: McpErrorInfo;
  /** Duration of the tool call in ms */
  durationMs: number;
  /** Parse text content as JSON */
  json<T = unknown>(): T;
  /** Get first text content */
  text(): string | undefined;
  /** Check if response has text content */
  hasTextContent(): boolean;
  /** Check if response has image content */
  hasImageContent(): boolean;
  /** Check if response has resource content */
  hasResourceContent(): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// RESOURCE CONTENT WRAPPER
// ═══════════════════════════════════════════════════════════════════

export interface ResourceContentWrapper {
  /** Raw ReadResourceResult from MCP */
  raw: ReadResourceResult;
  /** Whether the read was successful */
  isSuccess: boolean;
  /** Whether the read failed */
  isError: boolean;
  /** Error information if failed */
  error?: McpErrorInfo;
  /** Duration in ms */
  durationMs: number;
  /** Parse text content as JSON */
  json<T = unknown>(): T;
  /** Get text content */
  text(): string | undefined;
  /** Get MIME type */
  mimeType(): string | undefined;
  /** Check if has specific MIME type */
  hasMimeType(type: string): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT RESULT WRAPPER
// ═══════════════════════════════════════════════════════════════════

export interface PromptResultWrapper {
  /** Raw GetPromptResult from MCP */
  raw: GetPromptResult;
  /** Whether the get was successful */
  isSuccess: boolean;
  /** Whether the get failed */
  isError: boolean;
  /** Error information if failed */
  error?: McpErrorInfo;
  /** Duration in ms */
  durationMs: number;
  /** Messages in the prompt */
  messages: GetPromptResult['messages'];
  /** Description from prompt result */
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════
// LOGGING TYPES
// ═══════════════════════════════════════════════════════════════════

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Timestamp */
  timestamp: Date;
  /** Additional data */
  data?: unknown;
}

export interface RequestTrace {
  /** Request that was sent */
  request: {
    method: string;
    params?: unknown;
    id: string | number;
  };
  /** Response that was received */
  response: {
    result?: unknown;
    error?: McpErrorInfo;
  };
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp of the request */
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface NotificationEntry {
  /** Notification method */
  method: string;
  /** Notification params */
  params?: unknown;
  /** Timestamp received */
  timestamp: Date;
}

export interface ProgressUpdate {
  /** Progress value (0-100 or custom) */
  progress: number;
  /** Total value */
  total?: number;
  /** Progress token */
  progressToken?: string | number;
  /** Timestamp */
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════
// SESSION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SessionInfo {
  /** Session ID */
  id: string;
  /** When the session was created */
  createdAt: Date;
  /** When the last request was made */
  lastActivityAt: Date;
  /** Number of requests made in this session */
  requestCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// AUTH STATE
// ═══════════════════════════════════════════════════════════════════

export interface AuthState {
  /** Whether the user is anonymous (no token) */
  isAnonymous: boolean;
  /** Current token (if any) */
  token?: string;
  /** Scopes from the token */
  scopes: string[];
  /** User information from token */
  user?: {
    sub: string;
    email?: string;
    name?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// RE-EXPORTS FROM MCP SDK
// ═══════════════════════════════════════════════════════════════════

export type {
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
};
