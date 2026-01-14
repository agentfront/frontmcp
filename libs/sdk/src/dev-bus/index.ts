/**
 * Dev Event Bus - Development dashboard event system
 *
 * This module provides a centralized event bus for capturing SDK events
 * during development. It's used by the CLI dashboard to display real-time
 * information about tool calls, sessions, and server status.
 *
 * @example
 * ```typescript
 * import { DevEventBus, isDevBusEnabled } from '@frontmcp/sdk/dev-bus';
 *
 * if (isDevBusEnabled()) {
 *   const bus = new DevEventBus();
 *   bus.activate(scope);
 *   bus.subscribe((event) => {
 *     console.log(`[${event.type}]`, event.data);
 *   });
 * }
 * ```
 */

// Event types
export type {
  DevEvent,
  DevEventBase,
  DevEventCategory,
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
  ConfigEvent,
  ConfigEventType,
  ConfigEventData,
  ServerEvent,
  ServerEventType,
  ServerEventData,
  ScopeGraphEvent,
  ScopeGraphEventType,
  ScopeGraphNode,
  ScopeGraphEventData,
  DevEventMessage,
} from './dev-event.types';

export { DEV_EVENT_MAGIC, isDevEventMessage } from './dev-event.types';

// Options
export type { DevEventBusOptions, DevEventBusOptionsInput } from './dev-event-bus.options';
export { devEventBusOptionsSchema, parseDevEventBusOptions, isDevBusEnabled } from './dev-event-bus.options';

// Main bus class
export { DevEventBus } from './dev-event-bus';
export type { DevEventListener } from './dev-event-bus';
