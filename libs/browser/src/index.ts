// file: libs/browser/src/index.ts
/**
 * @frontmcp/browser - Browser-native MCP server implementation
 *
 * This package provides browser-specific implementations of the MCP (Model Context Protocol)
 * server. It extends @frontmcp/sdk with browser-compatible transports, reactive state management
 * using Valtio, and component/renderer registries for UI generation.
 *
 * @example Basic usage
 * ```typescript
 * import { initializeConfig, generateUUID } from '@frontmcp/sdk/core';
 * import { BrowserMcpServer, EventTransportAdapter, createSimpleEmitter } from '@frontmcp/browser';
 *
 * // Initialize runtime config (required in browser)
 * initializeConfig({
 *   debug: location.hostname === 'localhost',
 *   isDevelopment: location.hostname === 'localhost',
 *   machineId: generateUUID(),
 * });
 *
 * // Create transport
 * const emitter = createSimpleEmitter();
 * const transport = new EventTransportAdapter(emitter);
 *
 * // Create browser MCP server
 * const server = new BrowserMcpServer({
 *   transport,
 *   tools: [...],
 *   resources: [...],
 * });
 *
 * await server.start();
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Re-export platform-agnostic SDK types from /core
// =============================================================================

export {
  // Crypto utilities
  generateUUID,
  getRandomBytes,
  getRandomHex,
  sha256,
  sha256Sync,
  simpleHash,
  // Config
  initializeConfig,
  getConfig,
  getConfigValue,
  isConfigInitialized,
  resetConfig,
  isBrowserEnvironment,
  isNodeEnvironment,
  isWebWorkerEnvironment,
  // Registries
  RegistryAbstract,
  // Entries
  ToolEntry,
  ResourceEntry,
  PromptEntry,
  BaseEntry,
  // Transport base
  TransportAdapterBase,
  // Host adapters
  NoOpHostAdapter,
  HostServerAdapter,
  // Errors
  McpError,
  PublicMcpError,
  InternalMcpError,
  ToolNotFoundError,
  ResourceNotFoundError,
  ResourceReadError,
  InvalidResourceUriError,
  InvalidInputError,
  InvalidOutputError,
  InvalidMethodError,
  ToolExecutionError,
  RateLimitError,
  QuotaExceededError,
  UnauthorizedError,
  GenericServerError,
  DependencyNotFoundError,
  InvalidHookFlowError,
  PromptNotFoundError,
  PromptExecutionError,
  isPublicError,
  toMcpError,
  formatMcpErrorResponse,
  MCP_ERROR_CODES,
  // URI utilities
  isValidMcpUri,
  extractUriScheme,
  isValidMcpUriTemplate,
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
  // Scope
  Scope,
  // Plugin system (SDK exports)
  Plugin,
  FrontMcpPlugin,
  DynamicPlugin,
  PluginEntry,
  PluginKind,
  ToolHookStage,
} from '@frontmcp/sdk/core';

// Re-export types
export type {
  RuntimeConfig,
  RegistryBuildMapResult,
  TransportAdapterBaseOptions,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  MessageHandler,
  ConnectionState,
  McpErrorCode,
  ToolMetadata,
  ToolInputType,
  ToolOutputType,
  ToolRecord,
  ResourceMetadata,
  ResourceTemplateMetadata,
  ResourceRecord,
  ResourceTemplateRecord,
  AnyResourceRecord,
  PromptMetadata,
  PromptRecord,
  GetPromptResult,
  // Platform types
  PlatformCrypto,
  PlatformStorage,
  PlatformContextStorage,
  PlatformConfig,
  PlatformLogger,
  // Provider types
  Token,
  Type,
  Ctor,
  Reference,
  ProviderInterface,
  ProviderType,
  ProviderRecord,
  ProviderViews,
  ProviderRegistryInterface,
  RegistryKind,
  EntryOwnerRef,
  EntryOwnerKind,
  EntryLineage,
  // Plugin types
  PluginMetadata,
  PluginInterface,
  PluginType,
  PluginRecord,
  HookMetadata,
  HookStageType,
  HookOptions,
} from '@frontmcp/sdk/core';

// Re-export provider enums
export { ProviderScope, ProviderKind } from '@frontmcp/sdk/core';

// =============================================================================
// Browser-specific exports
// =============================================================================

// Platform adapters (browser implementations of SDK platform interfaces)
export * from './platform';

// Entry classes
export * from './entries';

// Transport layer
export * from './transport';

// Registries (Component and Renderer)
export * from './registry';

// Server implementation
export * from './server';

// Browser Scope (SDK-compatible scope for browser)
export * from './scope';

// UI Resource utilities
export * from './ui-resource';

// Event system
export * from './events';

// Form state management
export * from './forms';

// Human-in-the-Loop
export * from './hitl';

// Web Components
export * from './web-components';

// =============================================================================
// MODULAR IMPORTS - Use separate entry points for these modules:
// =============================================================================
// Store (Valtio-based):     import { ... } from '@frontmcp/browser/store'
// Telemetry:                import { ... } from '@frontmcp/browser/telemetry'
// Accessibility:            import { ... } from '@frontmcp/browser/a11y'
// Plugins:                  import { ... } from '@frontmcp/browser/plugins'
// UI Components:            import { ... } from '@frontmcp/browser/components'
// Theme:                    import { ... } from '@frontmcp/browser/theme'
// React integration:        import { ... } from '@frontmcp/browser/react'
// Host/App embedding:       import { ... } from '@frontmcp/browser/host'
// Polyfill:                 import '@frontmcp/browser/polyfill'
