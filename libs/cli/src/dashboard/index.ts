/**
 * FrontMCP Dev Dashboard
 *
 * Terminal-based UI for development mode that displays:
 * - Real-time SDK events
 * - Active sessions
 * - Tool calls and API requests
 * - Configuration status
 * - Scope graph visualization
 */

// Events
export * from './events/types.js';
export { DevEventClient } from './events/dev-event-client.js';
export type { DevEventClientListener, DevEventClientOptions } from './events/dev-event-client.js';

// Store
export { createDashboardStore } from './store/index.js';
export type {
  DashboardState,
  DashboardActions,
  DashboardStore,
  TabName,
  LogLevel,
  SessionInfo,
  RequestInfo,
  LogEntry,
  ServerStatus,
  WatchStatus,
  TypeCheckStatus,
  RegistryStats,
  ConfigStatus,
} from './store/index.js';

// Utils
export { RingBuffer } from './utils/ring-buffer.js';
export {
  renderAsciiTree,
  renderAsciiTreeString,
  countNodes,
  countNodesByType,
  findNodeById,
  getNodesByType,
} from './utils/ascii-tree.js';
export type { RenderOptions } from './utils/ascii-tree.js';
