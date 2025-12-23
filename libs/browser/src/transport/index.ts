// file: libs/browser/src/transport/index.ts
/**
 * Browser transport layer.
 *
 * Provides EventEmitter and postMessage based transports for
 * browser-native MCP server communication.
 */

export type {
  MinimalEventEmitter,
  BrowserMessageHandler,
  BrowserConnectionState,
  BrowserTransport,
  RequestTransport,
  PostMessageTransportOptions,
  EventTransportOptions,
  PostMessageTarget,
  WorkerLike,
  // Re-exported from SDK
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from './transport.interface';

// Base class for browser transports
export {
  BrowserTransportAdapterBase,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
  type BrowserTransportBaseOptions,
} from './browser-transport.base';

// Transport adapters
export { EventTransportAdapter } from './event-transport.adapter';
export { PostMessageTransportAdapter } from './postmessage-transport.adapter';

// Chrome Extension transports
export {
  ExtensionServerTransport,
  type ExtensionTransportMode,
  type ExtensionTransportOptions,
  type ExtensionClient,
} from './extension-transport.adapter';

export {
  TabServerTransport,
  type TabTransportMode,
  type TabTransportOptions,
  type TabSession,
} from './tab-transport.adapter';

// Extension Bridge (page <-> extension communication)
export {
  ExtensionBridge,
  createExtensionBridge,
  detectAndCreateBridge,
  type BridgeMode,
  type BridgeMessage,
  type ExtensionBridgeOptions,
} from './extension-bridge';

// Utilities
export { SimpleEmitter, createSimpleEmitter } from './simple-emitter';
