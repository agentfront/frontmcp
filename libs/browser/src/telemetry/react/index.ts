// file: libs/browser/src/telemetry/react/index.ts
/**
 * Telemetry React Integration
 *
 * React context, provider, and hooks for telemetry.
 */

// Context
export {
  TelemetryContext,
  useTelemetryContext,
  useTelemetryContextSafe,
  type TelemetryContextValue,
} from './telemetry-context';

// Provider
export { TelemetryProvider, type TelemetryProviderProps } from './telemetry-provider';

// Core hooks
export {
  useTelemetry,
  useTelemetrySafe,
  useRecordEvent,
  useRecordEventSafe,
  type UseTelemetryResult,
} from './use-telemetry';

// Event hooks
export {
  useEvents,
  useEventsSafe,
  useTelemetryStats,
  useLatestEvent,
  useEventCounts,
  type UseEventsOptions,
} from './use-events';
