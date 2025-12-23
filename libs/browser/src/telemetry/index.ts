// file: libs/browser/src/telemetry/index.ts
/**
 * Telemetry Module
 *
 * Browser telemetry for event capture, PII filtering, and MCP integration.
 *
 * @example Basic setup
 * ```typescript
 * import {
 *   createEventCollector,
 *   createInteractionCapture,
 *   createNetworkCapture,
 *   createErrorCapture,
 *   createBuiltInPiiFilter,
 *   createPiiFilterChain,
 * } from '@frontmcp/browser/telemetry';
 *
 * // Create PII filter
 * const piiFilter = createPiiFilterChain({
 *   filters: [createBuiltInPiiFilter()],
 * });
 *
 * // Create collector with filter
 * const collector = createEventCollector({
 *   onFlush: async (events) => {
 *     const filtered = events.map(piiFilter);
 *     await sendToBackend(filtered);
 *   },
 * });
 *
 * // Start capture modules
 * const captures = [
 *   createInteractionCapture({ collector }),
 *   createNetworkCapture({ collector }),
 *   createErrorCapture({ collector }),
 * ];
 *
 * captures.forEach((c) => c.start());
 * ```
 *
 * @example React integration
 * ```tsx
 * import { TelemetryProvider, useTelemetry } from '@frontmcp/browser/telemetry';
 *
 * function App() {
 *   return (
 *     <TelemetryProvider
 *       enabled={true}
 *       onFlush={sendToBackend}
 *     >
 *       <MyApp />
 *     </TelemetryProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { recordCustom } = useTelemetry();
 *
 *   return (
 *     <button onClick={() => recordCustom('click', { id: 'btn' })}>
 *       Click
 *     </button>
 *   );
 * }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  TelemetryEvent,
  TelemetryCategory,
  TelemetrySignificance,
  FlushTrigger,
  SamplingConfig,
  TelemetryStats,

  // Event types
  BaseTelemetryEvent,
  InteractionEvent,
  NetworkEvent,
  ErrorEvent,
  LogEvent,
  CustomTelemetryEvent,
  NavigationEvent,
  PerformanceEvent,

  // Module types
  EventCollector,
  EventCollectorOptions,
  CaptureModule,
  CaptureModuleOptions,

  // Filter types
  PiiFilter,
  PiiPattern,
  PiiFilterChainOptions,

  // Capture types
  InteractionType,
  NetworkType,
  ErrorType,
  LogType,
} from './types';

// =============================================================================
// Collector
// =============================================================================

export { createEventCollector, createNoopCollector } from './collector';

// =============================================================================
// Capture Modules
// =============================================================================

export { createInteractionCapture, type InteractionCaptureOptions } from './capture/interaction-capture';

export { createNetworkCapture, type NetworkCaptureOptions } from './capture/network-capture';

export { createErrorCapture, captureError, type ErrorCaptureOptions } from './capture/error-capture';

export { createLogCapture, type LogCaptureOptions } from './capture/log-capture';

// =============================================================================
// PII Filters
// =============================================================================

// Filter chain
export {
  createPiiFilterChain,
  applyPattern,
  deepApplyPatterns,
  createPatternFilter,
  composePiiFilters,
} from './filters/pii-filter-chain';

// Built-in patterns
export {
  EMAIL_PATTERN,
  CREDIT_CARD_PATTERN,
  SSN_PATTERN,
  PHONE_PATTERN,
  API_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  JWT_PATTERN,
  IPV4_PATTERN,
  IPV6_PATTERN,
  PASSWORD_PATTERN,
  AUTH_HEADER_PATTERN,
  AWS_KEY_PATTERN,
  PRIVATE_KEY_PATTERN,
  BUILTIN_PATTERNS,
  getBuiltinPattern,
  getBuiltinPatterns,
  getPatternNames,
} from './filters/built-in-patterns';

// Filter plugins
export {
  createBuiltInPiiFilter,
  createCategoryPiiFilter,
  type BuiltInPiiFilterOptions,
} from './filters/built-in-filter.plugin';

export {
  createPiiFilterPlugin,
  createMultiPatternFilter,
  createFieldRemovalFilter,
  createConditionalFilter,
  type PiiFilterPluginOptions,
  type MultiPatternFilterOptions,
} from './filters/pii-filter.plugin';

// =============================================================================
// MCP Integration
// =============================================================================

export {
  // Resources
  createTelemetryResources,
  createEventQueryResource,
  createEventTypeResource,
  createRecentEventsResource,
  type TelemetryResourcesOptions,
  type TelemetryResource,

  // Notifications
  createEventNotifier,
  connectNotifierToCollector,
  createSimpleNotificationHandler,
  type NotificationTransport,
  type EventNotifierOptions,
  type EventNotifier,
  type EventNotificationPayload,
} from './mcp';

// =============================================================================
// React Integration
// =============================================================================

export {
  // Context
  TelemetryContext,
  useTelemetryContext,
  useTelemetryContextSafe,
  type TelemetryContextValue,

  // Provider
  TelemetryProvider,
  type TelemetryProviderProps,

  // Core hooks
  useTelemetry,
  useTelemetrySafe,
  useRecordEvent,
  useRecordEventSafe,
  type UseTelemetryResult,

  // Event hooks
  useEvents,
  useEventsSafe,
  useTelemetryStats,
  useLatestEvent,
  useEventCounts,
  type UseEventsOptions,
} from './react';
