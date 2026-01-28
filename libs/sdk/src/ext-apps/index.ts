/**
 * MCP Apps (ext-apps) Module
 *
 * Server-side support for the MCP Apps Extension protocol (SEP-1865).
 * Provides types and handlers for bidirectional communication between
 * embedded widgets and AI hosts.
 *
 * @packageDocumentation
 */

// Types
export type {
  // Core message params
  ExtAppsCallServerToolParams,
  ExtAppsUpdateModelContextParams,
  ExtAppsOpenLinkParams,
  // Display and lifecycle
  ExtAppsDisplayMode,
  ExtAppsSetDisplayModeParams,
  ExtAppsCloseParams,
  // Logging
  ExtAppsLogLevel,
  ExtAppsLogParams,
  // Widget-defined tools
  ExtAppsRegisterToolParams,
  ExtAppsUnregisterToolParams,
  // Capabilities
  ExtAppsHostCapabilities,
  ExtAppsWidgetCapabilities,
  // Initialization
  ExtAppsAppInfo,
  ExtAppsHostContext,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  // Notifications
  ExtAppsToolInputNotification,
  ExtAppsToolResultNotification,
  ExtAppsHostContextChangedNotification,
  ExtAppsCancelledNotification,
  // JSON-RPC
  ExtAppsJsonRpcRequest,
  ExtAppsJsonRpcResponse,
  ExtAppsJsonRpcNotification,
  ExtAppsJsonRpcMessage,
  ExtAppsErrorCode,
} from './ext-apps.types';

export { EXT_APPS_ERROR_CODES } from './ext-apps.types';

// Handler
export {
  ExtAppsMessageHandler,
  createExtAppsMessageHandler,
  // Handler context
  type ExtAppsHandlerContext,
  type ExtAppsMessageHandlerOptions,
  // Errors
  ExtAppsError,
  ExtAppsMethodNotFoundError,
  ExtAppsInvalidParamsError,
  ExtAppsNotSupportedError,
  ExtAppsToolNotFoundError,
} from './ext-apps.handler';
