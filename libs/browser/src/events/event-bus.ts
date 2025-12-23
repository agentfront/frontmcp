// file: libs/browser/src/events/event-bus.ts
/**
 * Event Bus for Component Events
 *
 * Provides a typed event system for component communication and lifecycle events.
 * Supports event bubbling, namespacing, and wildcard subscriptions.
 *
 * @example Basic usage
 * ```typescript
 * import { createEventBus, EventType } from '@frontmcp/browser';
 *
 * const bus = createEventBus();
 *
 * // Subscribe to events
 * bus.on(EventType.COMPONENT_MOUNTED, (event) => {
 *   console.log('Component mounted:', event.instanceId);
 * });
 *
 * // Emit events
 * bus.emit(EventType.COMPONENT_MOUNTED, {
 *   instanceId: 'button-1',
 *   componentName: 'Button',
 * });
 * ```
 *
 * @example Wildcard subscriptions
 * ```typescript
 * // Listen to all component events
 * bus.on('component:*', (event) => {
 *   console.log('Component event:', event.type);
 * });
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';

/**
 * Event types enum
 */
export enum EventType {
  // Component lifecycle
  COMPONENT_MOUNTED = 'component:mounted',
  COMPONENT_UPDATED = 'component:updated',
  COMPONENT_UNMOUNTED = 'component:unmounted',
  COMPONENT_ERROR = 'component:error',

  // Instance events
  INSTANCE_CREATED = 'instance:created',
  INSTANCE_DESTROYED = 'instance:destroyed',
  INSTANCE_STATE_CHANGED = 'instance:state-changed',

  // Form events
  FORM_SUBMIT = 'form:submit',
  FORM_VALIDATE = 'form:validate',
  FORM_RESET = 'form:reset',
  FORM_FIELD_CHANGED = 'form:field-changed',
  FORM_FIELD_BLUR = 'form:field-blur',
  FORM_FIELD_FOCUS = 'form:field-focus',

  // UI events
  UI_CLICK = 'ui:click',
  UI_HOVER = 'ui:hover',
  UI_FOCUS = 'ui:focus',
  UI_BLUR = 'ui:blur',
  UI_KEYDOWN = 'ui:keydown',
  UI_SCROLL = 'ui:scroll',

  // Navigation events
  NAV_NAVIGATE = 'nav:navigate',
  NAV_BACK = 'nav:back',
  NAV_FORWARD = 'nav:forward',

  // Custom events
  CUSTOM = 'custom',
}

/**
 * Base event interface
 */
export interface BaseEvent {
  /** Event type */
  type: EventType | string;
  /** Event timestamp */
  timestamp: number;
  /** Event ID */
  id: string;
  /** Source instance ID (if applicable) */
  instanceId?: string;
  /** Component name (if applicable) */
  componentName?: string;
  /** Stop event propagation */
  stopPropagation?: () => void;
  /** Prevent default behavior */
  preventDefault?: () => void;
  /** Whether propagation was stopped */
  propagationStopped?: boolean;
  /** Whether default was prevented */
  defaultPrevented?: boolean;
}

/**
 * Component lifecycle event
 */
export interface ComponentLifecycleEvent extends BaseEvent {
  type:
    | EventType.COMPONENT_MOUNTED
    | EventType.COMPONENT_UPDATED
    | EventType.COMPONENT_UNMOUNTED
    | EventType.COMPONENT_ERROR;
  instanceId: string;
  componentName: string;
  props?: Record<string, unknown>;
  error?: Error;
}

/**
 * Instance event
 */
export interface InstanceEvent extends BaseEvent {
  type: EventType.INSTANCE_CREATED | EventType.INSTANCE_DESTROYED | EventType.INSTANCE_STATE_CHANGED;
  instanceId: string;
  componentName: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
}

/**
 * Form event
 */
export interface FormEvent extends BaseEvent {
  type:
    | EventType.FORM_SUBMIT
    | EventType.FORM_VALIDATE
    | EventType.FORM_RESET
    | EventType.FORM_FIELD_CHANGED
    | EventType.FORM_FIELD_BLUR
    | EventType.FORM_FIELD_FOCUS;
  formId: string;
  fieldName?: string;
  fieldValue?: unknown;
  values?: Record<string, unknown>;
  errors?: Record<string, string[]>;
  isValid?: boolean;
}

/**
 * UI event
 */
export interface UIEvent extends BaseEvent {
  type:
    | EventType.UI_CLICK
    | EventType.UI_HOVER
    | EventType.UI_FOCUS
    | EventType.UI_BLUR
    | EventType.UI_KEYDOWN
    | EventType.UI_SCROLL;
  targetId?: string;
  targetElement?: string;
  position?: { x: number; y: number };
  key?: string;
  modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };
}

/**
 * Custom event
 */
export interface CustomEvent extends BaseEvent {
  type: EventType.CUSTOM | string;
  name: string;
  data?: unknown;
}

/**
 * Union of all event types
 */
export type BusEvent = ComponentLifecycleEvent | InstanceEvent | FormEvent | UIEvent | CustomEvent | BaseEvent;

/**
 * Event handler function type
 */
export type EventHandler<T extends BusEvent = BusEvent> = (event: T) => void | Promise<void>;

/**
 * Event subscription
 */
export interface EventSubscription {
  /** Subscription ID */
  id: string;
  /** Event type or pattern */
  type: string;
  /** Handler function */
  handler: EventHandler;
  /** Priority (higher = called first) */
  priority: number;
  /** Once flag (unsubscribe after first call) */
  once: boolean;
}

/**
 * Event bus options
 */
export interface EventBusOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum listeners per event type (0 = unlimited) */
  maxListeners?: number;
  /** Enable async event handling */
  async?: boolean;
}

/**
 * Event Bus implementation
 */
export class EventBus {
  private subscriptions = new Map<string, EventSubscription[]>();
  private wildcardSubscriptions: EventSubscription[] = [];
  private readonly debug: boolean;
  private readonly maxListeners: number;
  private readonly async: boolean;

  constructor(options: EventBusOptions = {}) {
    this.debug = options.debug ?? false;
    this.maxListeners = options.maxListeners ?? 0;
    this.async = options.async ?? true;
  }

  /**
   * Subscribe to an event type
   *
   * @param type - Event type or pattern (use * for wildcard)
   * @param handler - Event handler function
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  on<T extends BusEvent = BusEvent>(
    type: EventType | string,
    handler: EventHandler<T>,
    options: { priority?: number; once?: boolean } = {},
  ): () => void {
    const subscription: EventSubscription = {
      id: generateUUID(),
      type,
      handler: handler as EventHandler,
      priority: options.priority ?? 0,
      once: options.once ?? false,
    };

    if (type.includes('*')) {
      // Wildcard subscription
      this.wildcardSubscriptions.push(subscription);
      this.wildcardSubscriptions.sort((a, b) => b.priority - a.priority);
    } else {
      // Exact match subscription
      const subs = this.subscriptions.get(type) ?? [];

      if (this.maxListeners > 0 && subs.length >= this.maxListeners) {
        console.warn(`EventBus: Max listeners (${this.maxListeners}) reached for event "${type}"`);
      }

      subs.push(subscription);
      subs.sort((a, b) => b.priority - a.priority);
      this.subscriptions.set(type, subs);
    }

    if (this.debug) {
      console.debug(`[EventBus] Subscribed to "${type}"`, { subscriptionId: subscription.id });
    }

    // Return unsubscribe function
    return () => this.off(subscription.id);
  }

  /**
   * Subscribe to an event type (once only)
   */
  once<T extends BusEvent = BusEvent>(
    type: EventType | string,
    handler: EventHandler<T>,
    options: { priority?: number } = {},
  ): () => void {
    return this.on(type, handler, { ...options, once: true });
  }

  /**
   * Unsubscribe by subscription ID
   */
  off(subscriptionId: string): boolean {
    // Check wildcard subscriptions
    const wildcardIndex = this.wildcardSubscriptions.findIndex((s) => s.id === subscriptionId);
    if (wildcardIndex >= 0) {
      this.wildcardSubscriptions.splice(wildcardIndex, 1);
      return true;
    }

    // Check regular subscriptions
    for (const [type, subs] of this.subscriptions) {
      const index = subs.findIndex((s) => s.id === subscriptionId);
      if (index >= 0) {
        subs.splice(index, 1);
        if (subs.length === 0) {
          this.subscriptions.delete(type);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Remove all handlers for an event type
   */
  offAll(type?: EventType | string): void {
    if (type) {
      this.subscriptions.delete(type);
      this.wildcardSubscriptions = this.wildcardSubscriptions.filter((s) => s.type !== type);
    } else {
      this.subscriptions.clear();
      this.wildcardSubscriptions = [];
    }
  }

  /**
   * Emit an event
   *
   * @param type - Event type
   * @param data - Event data (excluding type, timestamp, id)
   */
  emit<T extends BusEvent = BusEvent>(type: EventType | string, data: Omit<T, 'type' | 'timestamp' | 'id'>): void {
    let propagationStopped = false;
    let defaultPrevented = false;

    const event: BusEvent = {
      ...(data as Record<string, unknown>),
      type,
      timestamp: Date.now(),
      id: generateUUID(),
      stopPropagation: () => {
        propagationStopped = true;
      },
      preventDefault: () => {
        defaultPrevented = true;
      },
      get propagationStopped() {
        return propagationStopped;
      },
      get defaultPrevented() {
        return defaultPrevented;
      },
    } as BusEvent;

    if (this.debug) {
      console.debug(`[EventBus] Emitting "${type}"`, event);
    }

    // Get matching handlers
    const handlers = this.getMatchingHandlers(type);

    // Execute handlers
    const executeHandler = async (sub: EventSubscription) => {
      if (propagationStopped) return;

      try {
        await sub.handler(event);
      } catch (error) {
        console.error(`[EventBus] Handler error for "${type}":`, error);
      }

      // Remove if once
      if (sub.once) {
        this.off(sub.id);
      }
    };

    if (this.async) {
      // Async execution
      Promise.all(handlers.map(executeHandler)).catch((err) => {
        console.error('[EventBus] Async handler error:', err);
      });
    } else {
      // Sync execution
      for (const handler of handlers) {
        if (propagationStopped) break;
        try {
          const result = handler.handler(event);
          if (result instanceof Promise) {
            result.catch((err) => console.error('[EventBus] Handler error:', err));
          }
        } catch (error) {
          console.error(`[EventBus] Handler error for "${type}":`, error);
        }
        if (handler.once) {
          this.off(handler.id);
        }
      }
    }
  }

  /**
   * Get all handlers matching an event type
   */
  private getMatchingHandlers(type: string): EventSubscription[] {
    const handlers: EventSubscription[] = [];

    // Exact match
    const exact = this.subscriptions.get(type) ?? [];
    handlers.push(...exact);

    // Wildcard matches
    for (const sub of this.wildcardSubscriptions) {
      if (this.matchesWildcard(type, sub.type)) {
        handlers.push(sub);
      }
    }

    // Sort by priority
    handlers.sort((a, b) => b.priority - a.priority);

    return handlers;
  }

  /**
   * Check if event type matches wildcard pattern
   */
  private matchesWildcard(type: string, pattern: string): boolean {
    if (pattern === '*') return true;

    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(type);
  }

  /**
   * Get listener count for an event type
   */
  listenerCount(type?: EventType | string): number {
    if (type) {
      const exact = this.subscriptions.get(type)?.length ?? 0;
      const wildcard = this.wildcardSubscriptions.filter((s) => this.matchesWildcard(type, s.type)).length;
      return exact + wildcard;
    }

    let total = 0;
    for (const subs of this.subscriptions.values()) {
      total += subs.length;
    }
    total += this.wildcardSubscriptions.length;
    return total;
  }

  /**
   * Get all registered event types
   */
  eventTypes(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscriptions.clear();
    this.wildcardSubscriptions = [];
  }
}

/**
 * Create a new event bus instance
 */
export function createEventBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}

/**
 * Global event bus instance (singleton)
 */
let globalEventBus: EventBus | null = null;

/**
 * Get or create the global event bus
 */
export function getGlobalEventBus(options?: EventBusOptions): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus(options);
  }
  return globalEventBus;
}

/**
 * Reset the global event bus (for testing)
 */
export function resetGlobalEventBus(): void {
  globalEventBus?.clear();
  globalEventBus = null;
}
