import { Type } from '@frontmcp/di';
import { LogLevel } from '../types';

/**
 * Standard log record for regular log messages.
 */
export interface LogRecord {
  level: LogLevel;
  levelName: string;
  message: string;
  args: unknown[];
  timestamp: Date;
  prefix: string;
}

/**
 * Trace event types for TUI state construction.
 */
export type TraceEventType =
  // Sessions
  | 'session:connect'
  | 'session:disconnect'
  | 'session:idle'
  | 'session:active'
  // Requests
  | 'request:start'
  | 'request:complete'
  | 'request:error'
  // Flows
  | 'flow:start'
  | 'flow:stage'
  | 'flow:complete'
  | 'flow:error'
  // Tools/Resources/Prompts
  | 'tool:execute'
  | 'tool:complete'
  | 'resource:read'
  | 'prompt:get'
  // Registry - Tools
  | 'registry:tool:added'
  | 'registry:tool:removed'
  | 'registry:tool:updated'
  | 'registry:tool:reset'
  // Registry - Resources
  | 'registry:resource:added'
  | 'registry:resource:removed'
  | 'registry:resource:updated'
  | 'registry:resource:reset'
  // Registry - Prompts
  | 'registry:prompt:added'
  | 'registry:prompt:removed'
  | 'registry:prompt:updated'
  | 'registry:prompt:reset'
  // Registry - Plugins
  | 'registry:plugin:added'
  | 'registry:plugin:removed'
  | 'registry:plugin:reset'
  // Registry - Adapters
  | 'registry:adapter:added'
  | 'registry:adapter:removed'
  | 'registry:adapter:reset'
  // Server
  | 'server:starting'
  | 'server:ready'
  | 'server:shutdown'
  // Config
  | 'config:loaded'
  | 'config:error';

/**
 * Extended log record for trace events (TUI structured events).
 */
export interface TraceLogRecord extends LogRecord {
  /** The trace event type for TUI categorization */
  eventType: TraceEventType;
  /** Structured data for the event */
  data: Record<string, unknown>;
}

export type LogFn = (msg?: any, ...args: any[]) => void;

export abstract class LogTransportInterface {
  abstract log(rec: LogRecord): void;
}

export type LogTransportType<T = any> = Type<T>;

export abstract class FrontMcpLogger {
  abstract child(prefix: string): FrontMcpLogger;

  /**
   * Trace — structured events for TUI/dashboard state construction.
   * Always emitted to ManagerLogTransport regardless of configured log level.
   *
   * @param eventType - The type of trace event (e.g., 'session:connect', 'request:start')
   * @param data - Structured data for the event
   */
  abstract trace(eventType: TraceEventType, data?: Record<string, unknown>): void;

  /**
   * Verbose — extremely granular, high-volume logs useful when diagnosing tricky bugs
   * (function entry/exit, detailed branches, low-level I/O). Disable in most environments.
   */
  abstract get verbose(): (...args: any[]) => void;

  /**
   * Debug — development-focused diagnostics (state changes, computed values, API request params),
   * still fairly verbose but less noisy than TRACE. Typically disabled in production.
   */
  abstract get debug(): (...args: any[]) => void;

  /**
   * Info — key milestones in normal operation (server start, feature toggles, user actions,
   * successful requests). Safe to keep enabled in production.
   */
  abstract get info(): (...args: any[]) => void;

  /**
   * Warn — unexpected or suboptimal situations that the system handled and continued
   * (fallbacks, retries, partial failures). Worth investigating but not service-breaking.
   */
  abstract get warn(): (...args: any[]) => void;

  /**
   * Error — failures where an operation could not complete or data is invalid,
   */
  abstract get error(): (...args: any[]) => void;
}
