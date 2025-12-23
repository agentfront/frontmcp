// file: libs/browser/src/telemetry/types.ts
/**
 * Telemetry Types
 *
 * Core type definitions for the browser telemetry system.
 */

// =============================================================================
// Event Categories
// =============================================================================

/**
 * Telemetry event categories.
 */
export enum TelemetryCategory {
  /** User interaction events (clicks, inputs, form submissions) */
  INTERACTION = 'interaction',

  /** Network events (fetch, XHR requests) */
  NETWORK = 'network',

  /** Error events (exceptions, unhandled rejections) */
  ERROR = 'error',

  /** Console log events */
  LOG = 'log',

  /** Navigation/page view events */
  NAVIGATION = 'navigation',

  /** Performance metrics */
  PERFORMANCE = 'performance',

  /** Custom application events */
  CUSTOM = 'custom',
}

/**
 * Significance level for events.
 */
export enum TelemetrySignificance {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// =============================================================================
// Base Event Types
// =============================================================================

/**
 * Base telemetry event interface.
 */
export interface BaseTelemetryEvent {
  /** Unique event ID */
  id: string;

  /** Event category */
  category: TelemetryCategory | string;

  /** Event type within category */
  type: string;

  /** Unix timestamp (ms) */
  timestamp: number;

  /** Session ID */
  sessionId: string;

  /** Event significance level */
  significance?: TelemetrySignificance;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Interaction Events
// =============================================================================

/**
 * Interaction event types.
 */
export type InteractionType = 'click' | 'input' | 'change' | 'submit' | 'focus' | 'blur' | 'scroll' | 'keydown';

/**
 * Interaction event.
 */
export interface InteractionEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.INTERACTION;
  type: InteractionType;

  /** Target element selector */
  target?: string;

  /** Target element tag name */
  tagName?: string;

  /** Target element ID */
  targetId?: string;

  /** Target element classes */
  targetClasses?: string[];

  /** Input value (sanitized) */
  value?: string;

  /** Position for click events */
  position?: { x: number; y: number };
}

// =============================================================================
// Network Events
// =============================================================================

/**
 * Network event types.
 */
export type NetworkType = 'fetch' | 'xhr' | 'websocket';

/**
 * Network event.
 */
export interface NetworkEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.NETWORK;
  type: NetworkType;

  /** Request method */
  method: string;

  /** Request URL */
  url: string;

  /** Response status code */
  status?: number;

  /** Response status text */
  statusText?: string;

  /** Request duration (ms) */
  duration?: number;

  /** Request size (bytes) */
  requestSize?: number;

  /** Response size (bytes) */
  responseSize?: number;

  /** Request headers (sanitized) */
  requestHeaders?: Record<string, string>;

  /** Response headers (sanitized) */
  responseHeaders?: Record<string, string>;

  /** Whether request succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Error Events
// =============================================================================

/**
 * Error event types.
 */
export type ErrorType = 'error' | 'unhandledrejection' | 'console-error';

/**
 * Error event.
 */
export interface ErrorEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.ERROR;
  type: ErrorType;

  /** Error message */
  message: string;

  /** Error name/type */
  name?: string;

  /** Stack trace */
  stack?: string;

  /** Source file */
  filename?: string;

  /** Line number */
  lineno?: number;

  /** Column number */
  colno?: number;

  /** Whether error was handled */
  handled?: boolean;
}

// =============================================================================
// Log Events
// =============================================================================

/**
 * Log event types.
 */
export type LogType = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';

/**
 * Log event.
 */
export interface LogEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.LOG;
  type: LogType;

  /** Log message */
  message: string;

  /** Log arguments (serialized) */
  args?: unknown[];
}

// =============================================================================
// Navigation Events
// =============================================================================

/**
 * Navigation event types.
 */
export type NavigationType = 'pageview' | 'navigate' | 'popstate' | 'hashchange';

/**
 * Navigation event.
 */
export interface NavigationEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.NAVIGATION;
  type: NavigationType;

  /** Current URL */
  url: string;

  /** Previous URL */
  referrer?: string;

  /** Page title */
  title?: string;

  /** Navigation type (reload, back, forward, navigate) */
  navigationType?: 'reload' | 'back_forward' | 'navigate' | 'prerender';
}

// =============================================================================
// Performance Events
// =============================================================================

/**
 * Performance event types.
 */
export type PerformanceType = 'timing' | 'paint' | 'longtask' | 'resource' | 'measure';

/**
 * Performance event.
 */
export interface PerformanceEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.PERFORMANCE;
  type: PerformanceType;

  /** Metric name */
  name: string;

  /** Metric value */
  value: number;

  /** Metric unit */
  unit?: 'ms' | 'bytes' | 'count';

  /** Entry type for performance entries */
  entryType?: string;
}

// =============================================================================
// Custom Events
// =============================================================================

/**
 * Custom telemetry event.
 */
export interface CustomTelemetryEvent extends BaseTelemetryEvent {
  category: TelemetryCategory.CUSTOM;

  /** Custom event name */
  name: string;

  /** Custom event data */
  data?: Record<string, unknown>;
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Any telemetry event.
 */
export type TelemetryEvent =
  | InteractionEvent
  | NetworkEvent
  | ErrorEvent
  | LogEvent
  | NavigationEvent
  | PerformanceEvent
  | CustomTelemetryEvent
  | BaseTelemetryEvent;

// =============================================================================
// Collector Types
// =============================================================================

/**
 * Sampling configuration.
 */
export type SamplingConfig = number | Partial<Record<TelemetryCategory | string, number>>;

/**
 * Flush trigger type.
 */
export type FlushTrigger = 'interval' | 'size' | 'manual' | 'unload';

/**
 * Event collector options.
 */
export interface EventCollectorOptions {
  /** Maximum buffer size before auto-flush */
  maxBufferSize?: number;

  /** Flush interval in ms */
  flushInterval?: number;

  /** Sampling rate (0-1) or per-category */
  sampling?: SamplingConfig;

  /** Whether telemetry is enabled */
  enabled?: boolean;

  /** Session ID (auto-generated if not provided) */
  sessionId?: string;

  /** Callback when events are flushed */
  onFlush?: (events: TelemetryEvent[], trigger: FlushTrigger) => void | Promise<void>;

  /** Callback when an event is recorded */
  onEvent?: (event: TelemetryEvent) => void;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Event collector interface.
 */
export interface EventCollector {
  /** Session ID */
  readonly sessionId: string;

  /** Whether collector is enabled */
  readonly enabled: boolean;

  /** Current buffer size */
  readonly bufferSize: number;

  /** Record an event */
  record(event: Omit<TelemetryEvent, 'id' | 'timestamp' | 'sessionId'>): void;

  /** Record a custom event */
  recordCustom(name: string, data?: Record<string, unknown>): void;

  /** Flush buffered events */
  flush(trigger?: FlushTrigger): Promise<void>;

  /** Enable the collector */
  enable(): void;

  /** Disable the collector */
  disable(): void;

  /** Clear the buffer without flushing */
  clear(): void;

  /** Get current buffer contents */
  getBuffer(): readonly TelemetryEvent[];

  /** Get collector statistics */
  getStats(): TelemetryStats;

  /** Dispose of the collector */
  dispose(): void;
}

/**
 * Telemetry statistics.
 */
export interface TelemetryStats {
  /** Total events recorded */
  totalEvents: number;

  /** Events by category */
  byCategory: Record<string, number>;

  /** Events dropped due to sampling */
  droppedBySampling: number;

  /** Events dropped due to buffer overflow */
  droppedByOverflow: number;

  /** Number of flushes */
  flushCount: number;

  /** Session start time */
  sessionStart: number;
}

// =============================================================================
// Capture Module Types
// =============================================================================

/**
 * Capture module interface.
 */
export interface CaptureModule {
  /** Module name */
  readonly name: string;

  /** Start capturing */
  start(): void;

  /** Stop capturing */
  stop(): void;

  /** Whether module is active */
  isActive(): boolean;

  /** Dispose of the module */
  dispose(): void;
}

/**
 * Capture module options.
 */
export interface CaptureModuleOptions {
  /** Event collector to record to */
  collector: EventCollector;

  /** Categories to capture (default: all supported by module) */
  categories?: TelemetryCategory[];

  /** Sampling rate override */
  sampling?: number;

  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// PII Filter Types
// =============================================================================

/**
 * PII pattern definition.
 */
export interface PiiPattern {
  /** Pattern name */
  name: string;

  /** Regular expression */
  pattern: RegExp;

  /** Replacement string (default: '[REDACTED]') */
  replacement?: string;

  /** Fields to apply to (default: all) */
  fields?: string[];
}

/**
 * PII filter interface.
 */
export interface PiiFilter {
  /** Filter name */
  readonly name: string;

  /** Filter priority (higher = earlier execution) */
  readonly priority: number;

  /** Filter an event */
  filter(event: TelemetryEvent): TelemetryEvent;
}

/**
 * PII filter chain options.
 */
export interface PiiFilterChainOptions {
  /** Filters to apply */
  filters: PiiFilter[];

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Built-in PII filter options.
 */
export interface BuiltInPiiFilterOptions {
  /** Pattern names to enable (default: all) */
  patterns?: string[];

  /** Pattern names to disable */
  exclude?: string[];

  /** Field paths to allowlist (never filter) */
  allowlist?: string[];

  /** Custom replacement string */
  replacement?: string;
}

// =============================================================================
// MCP Integration Types
// =============================================================================

/**
 * Telemetry resource options.
 */
export interface TelemetryResourceOptions {
  /** Event collector */
  collector: EventCollector;

  /** Maximum events to return */
  maxEvents?: number;

  /** Enable subscriptions */
  subscribe?: boolean;
}

/**
 * Telemetry notification options.
 */
export interface TelemetryNotificationOptions {
  /** Event collector */
  collector: EventCollector;

  /** Minimum significance to notify */
  minSignificance?: TelemetrySignificance;

  /** Batch notifications */
  batchInterval?: number;
}

// =============================================================================
// React Integration Types
// =============================================================================

/**
 * Telemetry provider props.
 */
export interface TelemetryProviderProps {
  /** Children */
  children: React.ReactNode;

  /** Collector options */
  options?: EventCollectorOptions;

  /** PII filters */
  filters?: PiiFilter[];

  /** Capture modules to enable */
  capture?: {
    interaction?: boolean;
    network?: boolean;
    error?: boolean;
    log?: boolean;
    navigation?: boolean;
  };

  /** Whether provider is enabled */
  enabled?: boolean;
}

/**
 * Telemetry context value.
 */
export interface TelemetryContextValue {
  /** Event collector */
  collector: EventCollector | null;

  /** Whether telemetry is enabled */
  enabled: boolean;

  /** Record a custom event */
  recordEvent: (name: string, data?: Record<string, unknown>) => void;

  /** Get collector stats */
  getStats: () => TelemetryStats | null;

  /** Enable telemetry */
  enable: () => void;

  /** Disable telemetry */
  disable: () => void;
}

/**
 * Use events hook options.
 */
export interface UseEventsOptions {
  /** Categories to filter */
  categories?: TelemetryCategory[];

  /** Maximum events to return */
  limit?: number;

  /** Include live updates */
  live?: boolean;
}
