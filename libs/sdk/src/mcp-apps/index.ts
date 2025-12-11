/**
 * @file index.ts
 * @description MCP Apps module barrel exports.
 *
 * Provides support for the MCP Apps extension specification:
 * https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx
 *
 * @example
 * ```typescript
 * import {
 *   generateMcpAppsTemplate,
 *   buildCSPHeader,
 *   MCP_APPS_MIME_TYPE,
 *   type McpAppsHostContext,
 * } from '@frontmcp/sdk/mcp-apps';
 * ```
 *
 * @module @frontmcp/sdk/mcp-apps
 */

// Types
export {
  // MIME types
  MCP_APPS_MIME_TYPE,
  type McpAppsMimeType,

  // UI Resource types
  type McpAppsCSP,
  type UIResourceMeta,
  type UIResource,

  // Host context types
  type McpAppsDisplayMode,
  type McpAppsPlatform,
  type DeviceCapabilities,
  type SafeAreaInsets,
  type ViewportInfo,
  type ToolInfo,
  type McpAppsHostContext,

  // JSON-RPC types
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcError,

  // Protocol message types
  type McpUiInitializeParams,
  type McpUiInitializeResult,
  type McpUiToolInputParams,
  type McpUiToolInputPartialParams,
  type McpUiToolResultParams,
  type McpUiToolCancelledParams,
  type McpUiSizeChangeParams,
  type McpUiHostContextChangeParams,
  type McpUiOpenLinkParams,
  type McpUiMessageParams,

  // Extension types
  type McpAppsExtensionCapability,
  type McpClientExtensions,
  type ToolUIMeta,
  type McpAppsToolResultMeta,

  // Method names
  MCP_APPS_METHODS,

  // Protocol version
  MCP_APPS_PROTOCOL_VERSION,
} from './types';

// Schemas
export {
  // Basic schemas
  McpAppsMimeTypeSchema,
  McpAppsDisplayModeSchema,
  McpAppsPlatformSchema,
  ThemeSchema,
  McpAppsCSPSchema,

  // Resource schemas
  UIResourceMetaSchema,
  UIResourceSchema,

  // Context schemas
  DeviceCapabilitiesSchema,
  SafeAreaInsetsSchema,
  ViewportInfoSchema,
  ToolInfoSchema,
  McpAppsHostContextSchema,

  // JSON-RPC schemas
  JsonRpcErrorSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  JsonRpcNotificationSchema,

  // Protocol message schemas
  McpUiInitializeParamsSchema,
  McpUiInitializeResultSchema,
  McpUiToolInputParamsSchema,
  McpUiToolInputPartialParamsSchema,
  McpUiToolResultParamsSchema,
  McpUiToolCancelledParamsSchema,
  McpUiSizeChangeParamsSchema,
  McpUiHostContextChangeParamsSchema,
  McpUiOpenLinkParamsSchema,
  McpUiMessageParamsSchema,

  // Extension schemas
  McpAppsExtensionCapabilitySchema,
  ToolUIMetaSchema,

  // Validation helpers
  isValidUIResourceUri,
  isValidProtocolVersion,
  parseUIResource,
  parseHostContext,
  DEFAULT_PROTOCOL_VERSION,
} from './schemas';

// CSP
export {
  type CSPDirective,
  type CSPConfig,
  DEFAULT_CSP_DIRECTIVES,
  SANDBOX_PERMISSIONS,
  EXTENDED_SANDBOX_PERMISSIONS,
  buildCSPHeader,
  buildCSPDirectives,
  buildSandboxAttribute,
  buildCSPMetaTag,
  isDomainAllowed,
  mergeCSP,
  parseCSPHeader,
} from './csp';

// Template
export {
  type McpAppsTemplateOptions,
  type McpAppsBridgeConfig,
  generateMcpAppsTemplate,
  wrapInMcpAppsTemplate,
  createSimpleMcpAppsTemplate,
  extractBodyContent,
} from './template';
