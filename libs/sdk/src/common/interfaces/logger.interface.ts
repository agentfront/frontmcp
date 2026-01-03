import { Type } from '@frontmcp/di';
import { LogLevel } from '../types';

export interface LogRecord {
  level: LogLevel;
  levelName: string;
  message: string;
  args: unknown[];
  timestamp: Date;
  prefix: string;
}

export type LogFn = (msg?: any, ...args: any[]) => void;

export abstract class LogTransportInterface {
  abstract log(rec: LogRecord): void;
}

export type LogTransportType<T = any> = Type<T>;

export abstract class FrontMcpLogger {
  abstract child(prefix: string): FrontMcpLogger;

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
