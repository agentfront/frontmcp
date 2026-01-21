/**
 * @file client/index.ts
 * @description MCP Test Client exports
 */

export { McpTestClient } from './mcp-test-client';
export { McpTestClientBuilder } from './mcp-test-client.builder';
export type {
  McpTestClientConfig,
  McpResponse,
  McpErrorInfo,
  TestTransportType,
  TestAuthConfig,
  ToolResultWrapper,
  ResourceContentWrapper,
  PromptResultWrapper,
  LogEntry,
  LogLevel,
  RequestTrace,
  NotificationEntry,
  ProgressUpdate,
  SessionInfo,
  AuthState,
  TransportState,
  // JSON-RPC types
  JSONRPCRequest,
  JSONRPCResponse,
  // Elicitation types
  ElicitationCreateRequest,
  ElicitResponse,
  ElicitationHandler,
  // Re-exports from MCP SDK
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
} from './mcp-test-client.types';
