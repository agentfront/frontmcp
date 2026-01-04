/**
 * @file remote/index.ts
 * @description Barrel exports for the remote MCP module
 *
 * This module provides functionality for connecting to remote MCP servers
 * and exposing their capabilities (tools, resources, prompts) as proxy entries
 * that integrate with the FrontMCP hook system.
 */

// MCP Client Service
export { McpClientService } from './mcp-client.service';

// Types
export type {
  // Connection types
  McpClientConnection,
  McpConnectionStatus,
  McpConnectionInfo,
  // Transport types
  McpTransportType,
  McpHttpTransportOptions,
  McpWorkerTransportOptions,
  McpEsmTransportOptions,
  McpTransportOptions,
  // Auth types
  McpStaticCredentials,
  McpRemoteAuthConfig,
  McpRemoteAuthContext,
  // Capability types
  McpRemoteCapabilities,
  McpCapabilityChangeEvent,
  // Service types
  McpClientServiceOptions,
  McpConnectRequest,
  McpRemoteCallToolResult,
  McpRemoteReadResourceResult,
  McpRemoteGetPromptResult,
  // Callback types
  McpCapabilityChangeCallback,
  McpConnectionChangeCallback,
  McpUnsubscribeFn,
} from './mcp-client.types';

// Proxy entries
export {
  ProxyToolEntry,
  ProxyToolContext,
  createProxyToolEntry,
  type ProxyToolRecord,
} from './entries/proxy-tool.entry';

export {
  ProxyResourceEntry,
  ProxyResourceContext,
  createProxyResourceEntry,
  type ProxyResourceRecord,
} from './entries/proxy-resource.entry';

export {
  ProxyPromptEntry,
  ProxyPromptContext,
  createProxyPromptEntry,
  type ProxyPromptRecord,
} from './entries/proxy-prompt.entry';
