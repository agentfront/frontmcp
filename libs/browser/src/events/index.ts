// file: libs/browser/src/events/index.ts
/**
 * Event system for browser MCP components.
 *
 * Provides typed event bus for component communication,
 * lifecycle events, form events, and custom events.
 */

export {
  EventBus,
  createEventBus,
  getGlobalEventBus,
  resetGlobalEventBus,
  EventType,
  type EventBusOptions,
  type BaseEvent,
  type ComponentLifecycleEvent,
  type InstanceEvent,
  type FormEvent,
  type UIEvent,
  type CustomEvent,
  type BusEvent,
  type EventHandler,
  type EventSubscription,
} from './event-bus';
