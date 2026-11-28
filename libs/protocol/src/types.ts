// MCP protocol types and schemas from the official MCP SDK v2: the zod schemas from `@modelcontextprotocol/core`,
// the types and the runtime constants and guards from `@modelcontextprotocol/server`.
export * from '@modelcontextprotocol/core';
export type * from '@modelcontextprotocol/server';
export {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META_KEY,
  RELATED_TASK_META_KEY,
  SUPPORTED_PROTOCOL_VERSIONS,
  isCallToolResult,
  isInitializeRequest,
  isInitializedNotification,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCResultResponse,
  isTaskAugmentedRequestParams,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  SdkError,
  SdkErrorCode,
  UrlElicitationRequiredError,
} from '@modelcontextprotocol/server';

// v2's server exports its high-level `ResourceTemplate` class under the spec type's name; the spec type is
// `ResourceTemplateType` there. FrontMCP means the spec type, as on v1.
export type { ResourceTemplateType as ResourceTemplate } from '@modelcontextprotocol/server';

// The v1 names and shapes FrontMCP still uses
export { ErrorCode, McpError } from './compat-errors';
export {
  CallToolResultSchema,
  JSONRPCErrorSchema,
  type CallToolResult,
  type JSONRPCError,
  type MessageExtraInfo,
  type RequestHandlerExtra,
  type RequestInfo,
} from './compat-types';
