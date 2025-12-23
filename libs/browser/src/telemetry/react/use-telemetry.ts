// file: libs/browser/src/telemetry/react/use-telemetry.ts
/**
 * useTelemetry Hook
 *
 * Hook for accessing telemetry functionality in React components.
 *
 * @example Basic usage
 * ```tsx
 * import { useTelemetry } from '@frontmcp/browser/telemetry';
 *
 * function MyComponent() {
 *   const { recordCustom, enabled } = useTelemetry();
 *
 *   const handleClick = () => {
 *     recordCustom('button-click', { buttonId: 'submit' });
 *   };
 *
 *   return (
 *     <div>
 *       <p>Telemetry: {enabled ? 'ON' : 'OFF'}</p>
 *       <button onClick={handleClick}>Submit</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With stats
 * ```tsx
 * function TelemetryStats() {
 *   const { getStats } = useTelemetry();
 *   const [stats, setStats] = React.useState(getStats());
 *
 *   // Refresh stats every second
 *   React.useEffect(() => {
 *     const interval = setInterval(() => {
 *       setStats(getStats());
 *     }, 1000);
 *     return () => clearInterval(interval);
 *   }, [getStats]);
 *
 *   return (
 *     <div>
 *       <p>Total events: {stats.totalEvents}</p>
 *       <p>Buffer size: {stats.bufferSize}</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback } from 'react';
import { useTelemetryContext, useTelemetryContextSafe } from './telemetry-context';
import type { TelemetryEvent, TelemetryStats } from '../types';

/**
 * Return type for useTelemetry hook.
 */
export interface UseTelemetryResult {
  /**
   * Whether telemetry is enabled.
   */
  enabled: boolean;

  /**
   * Session ID.
   */
  sessionId: string;

  /**
   * Current buffer size.
   */
  bufferSize: number;

  /**
   * Enable telemetry.
   */
  enable: () => void;

  /**
   * Disable telemetry.
   */
  disable: () => void;

  /**
   * Record a custom event.
   */
  recordCustom: (name: string, data?: Record<string, unknown>) => void;

  /**
   * Record a raw event.
   */
  record: (event: Omit<TelemetryEvent, 'id' | 'timestamp' | 'sessionId'>) => void;

  /**
   * Manually flush events.
   */
  flush: () => Promise<void>;

  /**
   * Get current stats.
   */
  getStats: () => TelemetryStats;

  /**
   * Get current buffer.
   */
  getBuffer: () => readonly TelemetryEvent[];
}

/**
 * Hook to access telemetry functionality.
 *
 * Must be used within a TelemetryProvider.
 *
 * @returns Telemetry methods and state
 * @throws Error if used outside TelemetryProvider
 */
export function useTelemetry(): UseTelemetryResult {
  const context = useTelemetryContext();

  return {
    enabled: context.enabled,
    sessionId: context.collector.sessionId,
    bufferSize: context.collector.bufferSize,
    enable: context.enable,
    disable: context.disable,
    recordCustom: context.recordCustom,
    record: context.record,
    flush: context.flush,
    getStats: context.getStats,
    getBuffer: context.getBuffer,
  };
}

/**
 * Hook to access telemetry (nullable, won't throw).
 *
 * Useful for components that may be used outside TelemetryProvider.
 *
 * @returns Telemetry methods and state, or null if not in provider
 */
export function useTelemetrySafe(): UseTelemetryResult | null {
  const context = useTelemetryContextSafe();

  if (!context) {
    return null;
  }

  return {
    enabled: context.enabled,
    sessionId: context.collector.sessionId,
    bufferSize: context.collector.bufferSize,
    enable: context.enable,
    disable: context.disable,
    recordCustom: context.recordCustom,
    record: context.record,
    flush: context.flush,
    getStats: context.getStats,
    getBuffer: context.getBuffer,
  };
}

/**
 * Hook for quick custom event recording.
 *
 * Convenience hook that returns just the recordCustom function.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const record = useRecordEvent();
 *
 *   return (
 *     <button onClick={() => record('click', { id: 'btn' })}>
 *       Click me
 *     </button>
 *   );
 * }
 * ```
 */
export function useRecordEvent(): (name: string, data?: Record<string, unknown>) => void {
  const context = useTelemetryContext();
  return useCallback(
    (name: string, data?: Record<string, unknown>) => {
      context.recordCustom(name, data);
    },
    [context],
  );
}

/**
 * Hook for quick custom event recording (safe version).
 *
 * Returns a no-op function if not in TelemetryProvider.
 */
export function useRecordEventSafe(): (name: string, data?: Record<string, unknown>) => void {
  const context = useTelemetryContextSafe();
  return useCallback(
    (name: string, data?: Record<string, unknown>) => {
      context?.recordCustom(name, data);
    },
    [context],
  );
}
