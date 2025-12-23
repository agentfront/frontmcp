// file: libs/browser/src/telemetry/react/telemetry-context.ts
/**
 * Telemetry Context
 *
 * React context for telemetry functionality.
 */

import { createContext, useContext } from 'react';
import type { EventCollector, TelemetryEvent, TelemetryStats, PiiFilter } from '../types';

/**
 * Telemetry context value.
 */
export interface TelemetryContextValue {
  /**
   * Event collector instance.
   */
  collector: EventCollector;

  /**
   * Whether telemetry is enabled.
   */
  enabled: boolean;

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

  /**
   * Subscribe to events.
   */
  subscribe: (callback: (event: TelemetryEvent) => void) => () => void;
}

/**
 * Telemetry context.
 */
export const TelemetryContext = createContext<TelemetryContextValue | null>(null);

/**
 * Hook to access telemetry context.
 *
 * @throws Error if used outside TelemetryProvider
 */
export function useTelemetryContext(): TelemetryContextValue {
  const context = useContext(TelemetryContext);

  if (!context) {
    throw new Error('useTelemetryContext must be used within a TelemetryProvider');
  }

  return context;
}

/**
 * Hook to access telemetry context (nullable, won't throw).
 */
export function useTelemetryContextSafe(): TelemetryContextValue | null {
  return useContext(TelemetryContext);
}
