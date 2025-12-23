// file: libs/browser/src/telemetry/collector/event-collector.ts
/**
 * Event Collector
 *
 * Core telemetry event collection with buffering, sampling, and flush strategies.
 *
 * @example Basic usage
 * ```typescript
 * const collector = createEventCollector({
 *   maxBufferSize: 100,
 *   flushInterval: 5000,
 *   onFlush: (events) => {
 *     sendToAnalytics(events);
 *   },
 * });
 *
 * collector.record({
 *   category: TelemetryCategory.INTERACTION,
 *   type: 'click',
 *   target: '#submit-btn',
 * });
 *
 * collector.recordCustom('purchase', { amount: 99.99 });
 * ```
 *
 * @example With sampling
 * ```typescript
 * const collector = createEventCollector({
 *   // 10% of all events
 *   sampling: 0.1,
 *
 *   // Or per-category sampling
 *   sampling: {
 *     interaction: 0.5,  // 50% of interactions
 *     network: 1.0,      // 100% of network
 *     error: 1.0,        // 100% of errors
 *   },
 * });
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  EventCollector,
  EventCollectorOptions,
  TelemetryEvent,
  TelemetryCategory,
  TelemetryStats,
  FlushTrigger,
  SamplingConfig,
  TelemetrySignificance,
  CustomTelemetryEvent,
} from '../types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_BUFFER_SIZE = 1000;
const DEFAULT_FLUSH_INTERVAL = 5000;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Internal collector state.
 */
interface CollectorState {
  buffer: TelemetryEvent[];
  enabled: boolean;
  stats: TelemetryStats;
  flushTimer: ReturnType<typeof setInterval> | null;
  disposed: boolean;
}

/**
 * Check if an event should be sampled (included).
 */
function shouldSample(category: string, sampling: SamplingConfig): boolean {
  let rate: number;

  if (typeof sampling === 'number') {
    rate = sampling;
  } else {
    rate = sampling[category as TelemetryCategory] ?? sampling['*'] ?? 1;
  }

  // 1 = always include, 0 = never include
  if (rate >= 1) return true;
  if (rate <= 0) return false;

  return Math.random() < rate;
}

/**
 * Create a telemetry event collector.
 *
 * @param options - Collector options
 * @returns Event collector instance
 */
export function createEventCollector(options: EventCollectorOptions = {}): EventCollector {
  const {
    maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
    flushInterval = DEFAULT_FLUSH_INTERVAL,
    sampling = 1,
    enabled: initialEnabled = true,
    sessionId: providedSessionId,
    onFlush,
    onEvent,
    debug = false,
  } = options;

  const sessionId = providedSessionId ?? generateUUID();

  // Internal state
  const state: CollectorState = {
    buffer: [],
    enabled: initialEnabled,
    stats: {
      totalEvents: 0,
      byCategory: {},
      droppedBySampling: 0,
      droppedByOverflow: 0,
      flushCount: 0,
      sessionStart: Date.now(),
    },
    flushTimer: null,
    disposed: false,
  };

  // Debug logging helper
  const log = (message: string, data?: unknown) => {
    if (debug) {
      if (data !== undefined) {
        console.log(`[Telemetry] ${message}`, data);
      } else {
        console.log(`[Telemetry] ${message}`);
      }
    }
  };

  // Start flush interval
  const startFlushInterval = () => {
    if (state.flushTimer) return;

    state.flushTimer = setInterval(() => {
      if (state.buffer.length > 0) {
        flush('interval');
      }
    }, flushInterval);
  };

  // Stop flush interval
  const stopFlushInterval = () => {
    if (state.flushTimer) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }
  };

  // Flush implementation
  const flush = async (trigger: FlushTrigger = 'manual'): Promise<void> => {
    if (state.disposed || state.buffer.length === 0) return;

    const events = [...state.buffer];
    state.buffer = [];
    state.stats.flushCount++;

    log(`Flushing ${events.length} events (trigger: ${trigger})`);

    if (onFlush) {
      try {
        await onFlush(events, trigger);
      } catch (error) {
        // Put events back in buffer on failure
        state.buffer = [...events, ...state.buffer];
        log('Flush failed, events restored to buffer', error);
        throw error;
      }
    }
  };

  // Record implementation
  const record = (event: Omit<TelemetryEvent, 'id' | 'timestamp' | 'sessionId'>): void => {
    if (state.disposed || !state.enabled) return;

    const category = event.category;

    // Apply sampling
    if (!shouldSample(category, sampling)) {
      state.stats.droppedBySampling++;
      log(`Event sampled out: ${category}/${event.type}`);
      return;
    }

    // Create full event
    const fullEvent: TelemetryEvent = {
      ...event,
      id: generateUUID(),
      timestamp: Date.now(),
      sessionId,
    } as TelemetryEvent;

    // Check buffer overflow
    if (state.buffer.length >= maxBufferSize) {
      // Remove oldest event
      state.buffer.shift();
      state.stats.droppedByOverflow++;
      log('Buffer overflow, oldest event dropped');
    }

    // Add to buffer
    state.buffer.push(fullEvent);
    state.stats.totalEvents++;
    state.stats.byCategory[category] = (state.stats.byCategory[category] ?? 0) + 1;

    log(`Event recorded: ${category}/${event.type}`, fullEvent);

    // Callback
    if (onEvent) {
      onEvent(fullEvent);
    }

    // Auto-flush if buffer is full
    if (state.buffer.length >= maxBufferSize) {
      flush('size');
    }
  };

  // Record custom event
  const recordCustom = (name: string, data?: Record<string, unknown>): void => {
    record({
      category: 'custom',
      type: 'custom',
      name,
      data,
    } as Omit<CustomTelemetryEvent, 'id' | 'timestamp' | 'sessionId'>);
  };

  // Start flush interval if enabled
  if (initialEnabled && flushInterval > 0) {
    startFlushInterval();
  }

  // Handle page unload
  if (typeof window !== 'undefined') {
    const handleUnload = () => {
      if (state.buffer.length > 0 && onFlush) {
        // Use sendBeacon for reliable delivery on unload
        const events = [...state.buffer];
        state.buffer = [];

        // Try to flush synchronously
        try {
          onFlush(events, 'unload');
        } catch {
          // Best effort
        }
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
  }

  // Build collector object
  const collector: EventCollector = {
    get sessionId() {
      return sessionId;
    },

    get enabled() {
      return state.enabled;
    },

    get bufferSize() {
      return state.buffer.length;
    },

    record,
    recordCustom,

    async flush(trigger: FlushTrigger = 'manual'): Promise<void> {
      return flush(trigger);
    },

    enable(): void {
      if (state.disposed) return;
      state.enabled = true;
      if (flushInterval > 0) {
        startFlushInterval();
      }
      log('Collector enabled');
    },

    disable(): void {
      state.enabled = false;
      stopFlushInterval();
      log('Collector disabled');
    },

    clear(): void {
      state.buffer = [];
      log('Buffer cleared');
    },

    getBuffer(): readonly TelemetryEvent[] {
      return [...state.buffer];
    },

    getStats(): TelemetryStats {
      return { ...state.stats };
    },

    dispose(): void {
      if (state.disposed) return;

      state.disposed = true;
      stopFlushInterval();
      state.buffer = [];
      log('Collector disposed');
    },
  };

  return collector;
}

/**
 * Create a no-op collector for testing or disabled telemetry.
 */
export function createNoopCollector(): EventCollector {
  const noopStats: TelemetryStats = {
    totalEvents: 0,
    byCategory: {},
    droppedBySampling: 0,
    droppedByOverflow: 0,
    flushCount: 0,
    sessionStart: Date.now(),
  };

  return {
    sessionId: 'noop',
    enabled: false,
    bufferSize: 0,
    record: () => {},
    recordCustom: () => {},
    flush: async () => {},
    enable: () => {},
    disable: () => {},
    clear: () => {},
    getBuffer: () => [],
    getStats: () => noopStats,
    dispose: () => {},
  };
}
