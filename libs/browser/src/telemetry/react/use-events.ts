// file: libs/browser/src/telemetry/react/use-events.ts
/**
 * useEvents Hook
 *
 * Hook for subscribing to and filtering telemetry events.
 *
 * @example Subscribe to all events
 * ```tsx
 * import { useEvents } from '@frontmcp/browser/telemetry';
 *
 * function EventLog() {
 *   const events = useEvents({ limit: 10 });
 *
 *   return (
 *     <ul>
 *       {events.map((event) => (
 *         <li key={event.id}>{event.category}: {event.type}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example Filter by category
 * ```tsx
 * function ErrorLog() {
 *   const errors = useEvents({
 *     category: 'error',
 *     limit: 5,
 *   });
 *
 *   return (
 *     <div>
 *       {errors.map((error) => (
 *         <div key={error.id}>{error.message}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With custom filter
 * ```tsx
 * function HighPriorityEvents() {
 *   const events = useEvents({
 *     filter: (event) => event.significance === 'high',
 *   });
 *
 *   return <EventList events={events} />;
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTelemetryContext, useTelemetryContextSafe } from './telemetry-context';
import type { TelemetryEvent, TelemetryCategory, TelemetrySignificance, TelemetryStats } from '../types';

/**
 * Options for useEvents hook.
 */
export interface UseEventsOptions {
  /**
   * Filter by category.
   */
  category?: TelemetryCategory;

  /**
   * Filter by event type.
   */
  type?: string;

  /**
   * Minimum significance level.
   */
  minSignificance?: TelemetrySignificance;

  /**
   * Custom filter function.
   */
  filter?: (event: TelemetryEvent) => boolean;

  /**
   * Maximum number of events to keep.
   * @default 100
   */
  limit?: number;

  /**
   * Include events from buffer on mount.
   * @default true
   */
  includeBuffer?: boolean;
}

/**
 * Significance level values for comparison.
 */
const SIGNIFICANCE_VALUES: Record<TelemetrySignificance, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Hook to subscribe to telemetry events.
 *
 * @param options - Filtering and display options
 * @returns Array of matching events
 */
export function useEvents(options: UseEventsOptions = {}): readonly TelemetryEvent[] {
  const { category, type, minSignificance, filter: customFilter, limit = 100, includeBuffer = true } = options;

  const context = useTelemetryContext();
  const [events, setEvents] = useState<TelemetryEvent[]>([]);

  // Build filter function
  const matchesFilter = useCallback(
    (event: TelemetryEvent): boolean => {
      // Category filter
      if (category && event.category !== category) {
        return false;
      }

      // Type filter
      if (type && event.type !== type) {
        return false;
      }

      // Significance filter
      if (minSignificance && event.significance) {
        const eventLevel = SIGNIFICANCE_VALUES[event.significance] ?? 0;
        const minLevel = SIGNIFICANCE_VALUES[minSignificance];
        if (eventLevel < minLevel) {
          return false;
        }
      }

      // Custom filter
      if (customFilter && !customFilter(event)) {
        return false;
      }

      return true;
    },
    [category, type, minSignificance, customFilter],
  );

  // Initialize with buffer events
  useEffect(() => {
    if (includeBuffer) {
      const bufferEvents = context.getBuffer().filter(matchesFilter);
      setEvents(bufferEvents.slice(-limit));
    }
  }, [context, includeBuffer, matchesFilter, limit]);

  // Subscribe to new events
  useEffect(() => {
    const unsubscribe = context.subscribe((event) => {
      if (matchesFilter(event)) {
        setEvents((prev) => {
          const next = [...prev, event];
          // Keep only the last N events
          if (next.length > limit) {
            return next.slice(-limit);
          }
          return next;
        });
      }
    });

    return unsubscribe;
  }, [context, matchesFilter, limit]);

  return events;
}

/**
 * Hook to subscribe to telemetry events (safe version).
 *
 * Returns empty array if not in TelemetryProvider.
 */
export function useEventsSafe(options: UseEventsOptions = {}): readonly TelemetryEvent[] {
  const context = useTelemetryContextSafe();

  // Use the regular hook if context exists, otherwise return empty
  if (!context) {
    return [];
  }

  // We can't call useEvents conditionally, so we implement the logic here
  const { category, type, minSignificance, filter: customFilter, limit = 100, includeBuffer = true } = options;

  const [events, setEvents] = useState<TelemetryEvent[]>([]);

  const matchesFilter = useCallback(
    (event: TelemetryEvent): boolean => {
      if (category && event.category !== category) return false;
      if (type && event.type !== type) return false;
      if (minSignificance && event.significance) {
        const eventLevel = SIGNIFICANCE_VALUES[event.significance] ?? 0;
        const minLevel = SIGNIFICANCE_VALUES[minSignificance];
        if (eventLevel < minLevel) return false;
      }
      if (customFilter && !customFilter(event)) return false;
      return true;
    },
    [category, type, minSignificance, customFilter],
  );

  useEffect(() => {
    if (!context) return;
    if (includeBuffer) {
      const bufferEvents = context.getBuffer().filter(matchesFilter);
      setEvents(bufferEvents.slice(-limit));
    }
  }, [context, includeBuffer, matchesFilter, limit]);

  useEffect(() => {
    if (!context) return;
    return context.subscribe((event) => {
      if (matchesFilter(event)) {
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > limit ? next.slice(-limit) : next;
        });
      }
    });
  }, [context, matchesFilter, limit]);

  return events;
}

/**
 * Hook to get real-time telemetry stats.
 *
 * @param refreshInterval - How often to refresh stats (ms)
 * @returns Current telemetry stats
 */
export function useTelemetryStats(refreshInterval = 1000): TelemetryStats {
  const context = useTelemetryContext();
  const [stats, setStats] = useState<TelemetryStats>(() => context.getStats());

  useEffect(() => {
    // Update immediately
    setStats(context.getStats());

    // Set up interval
    const interval = setInterval(() => {
      setStats(context.getStats());
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [context, refreshInterval]);

  return stats;
}

/**
 * Hook to get the latest event of a specific type.
 *
 * @param category - Category to filter
 * @param type - Optional type to filter
 * @returns Latest matching event or null
 */
export function useLatestEvent(category: TelemetryCategory, type?: string): TelemetryEvent | null {
  const events = useEvents({ category, type, limit: 1 });
  return events[0] ?? null;
}

/**
 * Hook to count events by category.
 *
 * @param refreshInterval - How often to refresh (ms)
 * @returns Record of category to count
 */
export function useEventCounts(refreshInterval = 1000): Record<TelemetryCategory, number> {
  const stats = useTelemetryStats(refreshInterval);
  return stats.byCategory as Record<TelemetryCategory, number>;
}
