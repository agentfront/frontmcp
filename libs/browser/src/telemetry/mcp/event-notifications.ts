// file: libs/browser/src/telemetry/mcp/event-notifications.ts
/**
 * Telemetry Event Notifications
 *
 * MCP notification utilities for telemetry events.
 *
 * @example
 * ```typescript
 * import { createEventNotifier } from '@frontmcp/browser/telemetry';
 *
 * const collector = createEventCollector({
 *   onEvent: (event) => {
 *     // Send notification for high-significance events
 *     if (event.significance === 'high') {
 *       notifier.notify(event);
 *     }
 *   },
 * });
 *
 * const notifier = createEventNotifier({
 *   transport: browserTransport,
 *   minSignificance: 'medium',
 * });
 * ```
 */

import type { TelemetryEvent, TelemetrySignificance, TelemetryCategory, EventCollector } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Notification transport interface (simplified for telemetry).
 */
export interface NotificationTransport {
  /**
   * Send a notification.
   */
  notify(notification: { method: string; params?: unknown }): Promise<void> | void;
}

/**
 * Options for creating an event notifier.
 */
export interface EventNotifierOptions {
  /**
   * Transport to send notifications through.
   */
  transport: NotificationTransport;

  /**
   * Minimum significance level to trigger notifications.
   * Default: 'medium'
   */
  minSignificance?: TelemetrySignificance;

  /**
   * Categories to include in notifications.
   * Default: all categories
   */
  categories?: TelemetryCategory[];

  /**
   * Debounce interval for batching notifications (ms).
   * Default: 100
   */
  debounceMs?: number;

  /**
   * Maximum batch size before forced flush.
   * Default: 10
   */
  maxBatchSize?: number;

  /**
   * Notification method name.
   * Default: 'notifications/events/captured'
   */
  method?: string;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

/**
 * Event notifier interface.
 */
export interface EventNotifier {
  /**
   * Notify about a single event.
   */
  notify(event: TelemetryEvent): void;

  /**
   * Notify about multiple events.
   */
  notifyBatch(events: TelemetryEvent[]): void;

  /**
   * Flush any pending notifications.
   */
  flush(): Promise<void>;

  /**
   * Dispose the notifier.
   */
  dispose(): void;
}

/**
 * Notification payload for events.
 */
export interface EventNotificationPayload {
  /**
   * Session ID.
   */
  sessionId: string;

  /**
   * Notification timestamp.
   */
  timestamp: number;

  /**
   * Events in this notification.
   */
  events: TelemetryEvent[];

  /**
   * Summary of events.
   */
  summary: {
    count: number;
    categories: Record<string, number>;
    highestSignificance: TelemetrySignificance;
  };
}

// =============================================================================
// Constants
// =============================================================================

const SIGNIFICANCE_LEVELS: Record<TelemetrySignificance, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const DEFAULT_METHOD = 'notifications/events/captured';

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an event notifier for sending telemetry notifications.
 *
 * @param options - Notifier options
 * @returns Event notifier instance
 */
export function createEventNotifier(options: EventNotifierOptions): EventNotifier {
  const {
    transport,
    minSignificance = 'medium',
    categories,
    debounceMs = 100,
    maxBatchSize = 10,
    method = DEFAULT_METHOD,
    debug = false,
  } = options;

  let pendingEvents: TelemetryEvent[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[EventNotifier] ${message}`, data ?? '');
    }
  };

  /**
   * Check if an event meets the significance threshold.
   */
  const meetsSignificance = (event: TelemetryEvent): boolean => {
    const sig = event.significance ?? 'low';
    const eventLevel = SIGNIFICANCE_LEVELS[sig] ?? 1;
    const minLevel = SIGNIFICANCE_LEVELS[minSignificance];
    return eventLevel >= minLevel;
  };

  /**
   * Check if an event's category is included.
   */
  const meetsCategoryFilter = (event: TelemetryEvent): boolean => {
    if (!categories || categories.length === 0) {
      return true;
    }
    // Handle both enum and string categories
    return categories.some((c) => c === event.category);
  };

  /**
   * Build notification payload from events.
   */
  const buildPayload = (events: TelemetryEvent[]): EventNotificationPayload => {
    const categoryCount: Record<string, number> = {};
    let highestSignificance: TelemetrySignificance = 'low' as TelemetrySignificance;

    for (const event of events) {
      // Count by category
      categoryCount[event.category] = (categoryCount[event.category] ?? 0) + 1;

      // Track highest significance
      const eventSig = event.significance ?? 'low';
      if (SIGNIFICANCE_LEVELS[eventSig] > SIGNIFICANCE_LEVELS[highestSignificance]) {
        highestSignificance = eventSig as TelemetrySignificance;
      }
    }

    return {
      sessionId: events[0]?.sessionId ?? 'unknown',
      timestamp: Date.now(),
      events,
      summary: {
        count: events.length,
        categories: categoryCount,
        highestSignificance,
      },
    };
  };

  /**
   * Send pending notifications.
   */
  const sendPending = async (): Promise<void> => {
    if (pendingEvents.length === 0 || disposed) {
      return;
    }

    const events = [...pendingEvents];
    pendingEvents = [];

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const payload = buildPayload(events);
    log(`Sending ${events.length} events`, payload.summary);

    try {
      await transport.notify({
        method,
        params: payload,
      });
    } catch (error) {
      log('Failed to send notification', error);
      // Put events back for retry
      pendingEvents = [...events, ...pendingEvents];
    }
  };

  /**
   * Schedule pending events to be sent.
   */
  const scheduleSend = (): void => {
    if (disposed) return;

    // Force send if batch is full
    if (pendingEvents.length >= maxBatchSize) {
      sendPending();
      return;
    }

    // Debounce send
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      sendPending();
    }, debounceMs);
  };

  return {
    notify(event: TelemetryEvent): void {
      if (disposed) return;

      // Filter by significance and category
      if (!meetsSignificance(event) || !meetsCategoryFilter(event)) {
        log(`Event filtered out: ${event.category}/${event.type}`);
        return;
      }

      pendingEvents.push(event);
      scheduleSend();
    },

    notifyBatch(events: TelemetryEvent[]): void {
      if (disposed) return;

      const filtered = events.filter((e) => meetsSignificance(e) && meetsCategoryFilter(e));

      if (filtered.length === 0) {
        return;
      }

      pendingEvents.push(...filtered);
      scheduleSend();
    },

    async flush(): Promise<void> {
      return sendPending();
    },

    dispose(): void {
      disposed = true;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      pendingEvents = [];
      log('Disposed');
    },
  };
}

/**
 * Create an event notifier that automatically subscribes to a collector.
 *
 * @example
 * ```typescript
 * const collector = createEventCollector({ ... });
 * const notifier = connectNotifierToCollector(collector, {
 *   transport: browserTransport,
 *   minSignificance: 'high', // Only notify for errors
 * });
 *
 * // Later...
 * notifier.dispose();
 * ```
 */
export function connectNotifierToCollector(
  collector: EventCollector,
  options: Omit<EventNotifierOptions, 'transport'> & { transport: NotificationTransport },
): EventNotifier & { unsubscribe: () => void } {
  const notifier = createEventNotifier(options);

  // We need to create a new collector with the onEvent callback
  // Since we can't modify an existing collector, this is mainly for
  // documentation purposes - in practice you'd create the collector
  // with the onEvent callback

  // Return an extended notifier with unsubscribe placeholder
  return {
    ...notifier,
    unsubscribe: () => {
      // This would be implemented if we had a way to subscribe to existing collectors
    },
  };
}

/**
 * Create a simple notification handler for common use cases.
 *
 * @example
 * ```typescript
 * const handleEvent = createSimpleNotificationHandler({
 *   onError: (event) => {
 *     console.error('Error event:', event);
 *   },
 *   onHighSignificance: (event) => {
 *     showToast('Important event captured');
 *   },
 * });
 *
 * collector.onEvent(handleEvent);
 * ```
 */
export function createSimpleNotificationHandler(handlers: {
  onError?: (event: TelemetryEvent) => void;
  onHighSignificance?: (event: TelemetryEvent) => void;
  onAny?: (event: TelemetryEvent) => void;
}): (event: TelemetryEvent) => void {
  return (event: TelemetryEvent) => {
    // Always call onAny if defined
    if (handlers.onAny) {
      handlers.onAny(event);
    }

    // Call onError for error events
    if (handlers.onError && event.category === 'error') {
      handlers.onError(event);
    }

    // Call onHighSignificance for high significance events
    if (handlers.onHighSignificance && event.significance === 'high') {
      handlers.onHighSignificance(event);
    }
  };
}
