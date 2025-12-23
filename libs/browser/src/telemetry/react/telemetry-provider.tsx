// file: libs/browser/src/telemetry/react/telemetry-provider.tsx
/**
 * Telemetry Provider
 *
 * React provider for telemetry functionality.
 *
 * @example Basic usage
 * ```tsx
 * import { TelemetryProvider, useTelemetry } from '@frontmcp/browser/telemetry';
 *
 * function App() {
 *   return (
 *     <TelemetryProvider
 *       enabled={true}
 *       onFlush={async (events) => {
 *         await fetch('/api/telemetry', {
 *           method: 'POST',
 *           body: JSON.stringify(events),
 *         });
 *       }}
 *     >
 *       <MyApp />
 *     </TelemetryProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { recordCustom } = useTelemetry();
 *
 *   const handleClick = () => {
 *     recordCustom('button-click', { buttonId: 'submit' });
 *   };
 *
 *   return <button onClick={handleClick}>Submit</button>;
 * }
 * ```
 *
 * @example With PII filtering
 * ```tsx
 * import {
 *   TelemetryProvider,
 *   createBuiltInPiiFilter,
 *   createPiiFilterChain,
 * } from '@frontmcp/browser/telemetry';
 *
 * const piiFilter = createPiiFilterChain({
 *   filters: [
 *     createBuiltInPiiFilter(),
 *     createPiiFilterPlugin({
 *       name: 'custom',
 *       pattern: /secret-\d+/g,
 *       replacement: '[SECRET]',
 *     }),
 *   ],
 * });
 *
 * function App() {
 *   return (
 *     <TelemetryProvider
 *       piiFilter={piiFilter}
 *       onFlush={sendToBackend}
 *     >
 *       <MyApp />
 *     </TelemetryProvider>
 *   );
 * }
 * ```
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { TelemetryContext, type TelemetryContextValue } from './telemetry-context';
import { createEventCollector, createNoopCollector } from '../collector';
import type {
  EventCollector,
  EventCollectorOptions,
  TelemetryEvent,
  TelemetryStats,
  FlushTrigger,
  PiiFilter,
} from '../types';

/**
 * Props for TelemetryProvider.
 */
export interface TelemetryProviderProps {
  /**
   * Whether telemetry is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Sampling rate (0-1) or per-category sampling.
   * @default 1 (100% of events)
   */
  sampling?: number | Record<string, number>;

  /**
   * Maximum buffer size.
   * @default 1000
   */
  maxBufferSize?: number;

  /**
   * Flush interval in milliseconds.
   * @default 5000
   */
  flushInterval?: number;

  /**
   * Session ID (auto-generated if not provided).
   */
  sessionId?: string;

  /**
   * PII filter function to apply to events before storage/flush.
   */
  piiFilter?: (event: TelemetryEvent) => TelemetryEvent;

  /**
   * Callback when events are flushed.
   */
  onFlush?: (events: TelemetryEvent[], trigger: FlushTrigger) => Promise<void> | void;

  /**
   * Callback when an event is recorded.
   */
  onEvent?: (event: TelemetryEvent) => void;

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean;

  /**
   * Child components.
   */
  children: ReactNode;
}

/**
 * TelemetryProvider component.
 */
export function TelemetryProvider({
  enabled: enabledProp = true,
  sampling = 1,
  maxBufferSize = 1000,
  flushInterval = 5000,
  sessionId,
  piiFilter,
  onFlush,
  onEvent,
  debug = false,
  children,
}: TelemetryProviderProps): React.ReactElement {
  // Track enabled state
  const [enabled, setEnabled] = useState(enabledProp);

  // Subscribers for events
  const subscribersRef = useRef<Set<(event: TelemetryEvent) => void>>(new Set());

  // PII filter ref (to avoid recreating collector on filter change)
  const piiFilterRef = useRef(piiFilter);
  piiFilterRef.current = piiFilter;

  // Create collector (memoized)
  const collector = useMemo(() => {
    if (!enabledProp) {
      return createNoopCollector();
    }

    const options: EventCollectorOptions = {
      maxBufferSize,
      flushInterval,
      sampling,
      enabled: enabledProp,
      sessionId,
      debug,
      onFlush: async (events, trigger) => {
        // Apply PII filter if provided
        const filteredEvents = piiFilterRef.current ? events.map((e) => piiFilterRef.current!(e)) : events;

        // Call user's onFlush
        if (onFlush) {
          await onFlush(filteredEvents, trigger);
        }
      },
      onEvent: (event) => {
        // Notify subscribers
        subscribersRef.current.forEach((callback) => {
          try {
            callback(event);
          } catch (error) {
            if (debug) {
              console.error('[TelemetryProvider] Subscriber error:', error);
            }
          }
        });

        // Call user's onEvent
        if (onEvent) {
          onEvent(event);
        }
      },
    };

    return createEventCollector(options);
  }, [enabledProp, maxBufferSize, flushInterval, sampling, sessionId, debug]);

  // Sync enabled state with prop
  useEffect(() => {
    if (enabledProp !== enabled) {
      setEnabled(enabledProp);
      if (enabledProp) {
        collector.enable();
      } else {
        collector.disable();
      }
    }
  }, [enabledProp, enabled, collector]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      collector.dispose();
    };
  }, [collector]);

  // Context methods
  const enable = useCallback(() => {
    setEnabled(true);
    collector.enable();
  }, [collector]);

  const disable = useCallback(() => {
    setEnabled(false);
    collector.disable();
  }, [collector]);

  const recordCustom = useCallback(
    (name: string, data?: Record<string, unknown>) => {
      collector.recordCustom(name, data);
    },
    [collector],
  );

  const record = useCallback(
    (event: Omit<TelemetryEvent, 'id' | 'timestamp' | 'sessionId'>) => {
      collector.record(event);
    },
    [collector],
  );

  const flush = useCallback(async () => {
    await collector.flush();
  }, [collector]);

  const getStats = useCallback((): TelemetryStats => {
    return collector.getStats();
  }, [collector]);

  const getBuffer = useCallback((): readonly TelemetryEvent[] => {
    return collector.getBuffer();
  }, [collector]);

  const subscribe = useCallback((callback: (event: TelemetryEvent) => void): (() => void) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  // Build context value
  const contextValue = useMemo(
    (): TelemetryContextValue => ({
      collector,
      enabled,
      enable,
      disable,
      recordCustom,
      record,
      flush,
      getStats,
      getBuffer,
      subscribe,
    }),
    [collector, enabled, enable, disable, recordCustom, record, flush, getStats, getBuffer, subscribe],
  );

  return <TelemetryContext.Provider value={contextValue}>{children}</TelemetryContext.Provider>;
}
