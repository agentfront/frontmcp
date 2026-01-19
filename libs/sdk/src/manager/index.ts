// Manager Service
export { ManagerService } from './manager.service';

// Options and configuration
export {
  parseManagerOptions,
  isManagerEnabled,
  resolveSocketPath,
  managerOptionsSchema,
  unixTransportOptionsSchema,
  tcpTransportOptionsSchema,
  websocketTransportOptionsSchema,
  DEV_MANAGER_OPTIONS,
  PROD_MANAGER_OPTIONS,
  type ManagerOptions,
  type ManagerOptionsInput,
  type UnixTransportOptions,
  type TcpTransportOptions,
  type WebsocketTransportOptions,
} from './manager.options';

// Types
export type {
  // Event categories and base
  ManagerEventCategory,
  ManagerEventBase,
  ManagerEvent,

  // Specific event types
  SessionEvent,
  SessionEventType,
  SessionEventData,
  RequestEvent,
  RequestEventType,
  RequestEventData,
  RequestFlowType,
  RegistryEvent,
  RegistryEventType,
  RegistryEventData,
  LogEvent,
  LogEventType,
  LogEventData,
  ServerEvent,
  ServerEventType,
  ServerEventData,
  ScopeGraphEvent,
  ScopeGraphEventType,
  ScopeGraphNode,
  ScopeGraphEventData,

  // Messages
  ManagerEventMessage,
  ManagerStateMessage,
  ManagerStateSnapshot,
  ManagerResponseMessage,
  ManagerWelcomeMessage,
  ManagerServerMessage,
  ManagerClientMessage,

  // Commands
  ManagerCommandBase,
  ManagerCommand,
  ManagerCommandMessage,
  GetStateCommand,
  SubscribeCommand,
  UnsubscribeCommand,
  PingCommand,
  SimulateClientCommand,
  ListToolsCommand,
  CallToolCommand,

  // Client
  ManagerClientInfo,
} from './manager.types';

export { MANAGER_PROTOCOL_VERSION } from './manager.types';

// Log Transport
export {
  ManagerLogTransport,
  getManagerLogTransport,
  resetManagerLogTransport,
  type ManagerLogTransportOptions,
} from './manager.log-transport';

// Transports
export {
  ManagerTransport,
  TransportManager,
  UnixSocketTransport,
  TcpSocketTransport,
  WebSocketTransport,
  type ManagerTransportEvents,
} from './transports';
