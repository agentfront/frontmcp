// file: libs/sdk/src/transport/adapters/index.ts
/**
 * Transport adapters for MCP communication.
 */

// Base adapter (platform-agnostic)
export {
  TransportAdapterBase,
  type TransportAdapterBaseOptions,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCNotification,
  type MessageHandler,
  type ConnectionState,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
} from './transport.base.adapter';

// HTTP transport adapters (Node.js only)
export { LocalTransportAdapter } from './transport.local.adapter';
export { TransportStreamableHttpAdapter } from './transport.streamable-http.adapter';
export { TransportSSEAdapter } from './transport.sse.adapter';
