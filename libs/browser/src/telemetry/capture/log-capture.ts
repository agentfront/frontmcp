// file: libs/browser/src/telemetry/capture/log-capture.ts
/**
 * Log Capture Module
 *
 * Captures console.log, console.warn, console.error calls.
 */

import type { CaptureModule, CaptureModuleOptions, TelemetryCategory, TelemetrySignificance, LogType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Log capture options.
 */
export interface LogCaptureOptions extends CaptureModuleOptions {
  /** Log levels to capture */
  levels?: LogType[];

  /** Maximum message length */
  maxMessageLength?: number;

  /** Maximum number of arguments to capture */
  maxArgs?: number;

  /** Patterns to ignore (regex on message) */
  ignore?: RegExp[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_LEVELS: LogType[] = ['log', 'info', 'warn', 'error'];
const DEFAULT_MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_MAX_ARGS = 5;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Safely stringify a value for logging.
 */
function safeStringify(value: unknown, maxLength: number): string {
  try {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value.slice(0, maxLength);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return '[Function]';
    if (value instanceof Error) return `${value.name}: ${value.message}`;

    const json = JSON.stringify(value);
    return json.slice(0, maxLength);
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Get significance for log level.
 */
function getSignificance(level: LogType): TelemetrySignificance {
  switch (level) {
    case 'error':
      return 'high' as TelemetrySignificance;
    case 'warn':
      return 'medium' as TelemetrySignificance;
    default:
      return 'low' as TelemetrySignificance;
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a log capture module.
 */
export function createLogCapture(options: LogCaptureOptions): CaptureModule {
  const {
    collector,
    levels = DEFAULT_LEVELS,
    maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH,
    maxArgs = DEFAULT_MAX_ARGS,
    ignore = [],
    debug = false,
  } = options;

  let active = false;
  const originalMethods: Partial<Record<LogType, typeof console.log>> = {};

  // Don't log from within log capture to avoid infinite loops
  const debugLog = debug
    ? (...args: unknown[]) => {
        if (originalMethods.log) {
          originalMethods.log('[LogCapture]', ...args);
        }
      }
    : () => {};

  /**
   * Check if message should be ignored.
   */
  const shouldIgnore = (message: string): boolean => {
    // Always ignore our own debug logs
    if (message.includes('[LogCapture]') || message.includes('[Telemetry]')) {
      return true;
    }
    return ignore.some((pattern) => pattern.test(message));
  };

  /**
   * Create a patched console method.
   */
  const createPatchedMethod = (level: LogType): typeof console.log => {
    const original = console[level];
    originalMethods[level] = original;

    return function (...args: unknown[]): void {
      // Call original first
      original.apply(console, args);

      // Build message from first arg
      const firstArg = args[0];
      const message = safeStringify(firstArg, maxMessageLength);

      if (shouldIgnore(message)) {
        return;
      }

      // Serialize remaining args
      const capturedArgs = args.slice(0, maxArgs).map((arg) => safeStringify(arg, maxMessageLength));

      collector.record({
        category: 'log' as TelemetryCategory,
        type: level,
        significance: getSignificance(level),
        message,
        args: capturedArgs.length > 1 ? capturedArgs : undefined,
      } as Parameters<typeof collector.record>[0]);

      debugLog(`Captured ${level}:`, message);
    };
  };

  return {
    name: 'log',

    start(): void {
      if (active) return;
      if (typeof console === 'undefined') return;

      for (const level of levels) {
        if (typeof console[level] === 'function') {
          console[level] = createPatchedMethod(level);
        }
      }

      active = true;
      debugLog('Started');
    },

    stop(): void {
      if (!active) return;

      // Restore original methods
      for (const [level, original] of Object.entries(originalMethods)) {
        if (original) {
          console[level as LogType] = original;
        }
      }

      // Clear stored originals
      for (const key of Object.keys(originalMethods)) {
        delete originalMethods[key as LogType];
      }

      active = false;
      debugLog('Stopped');
    },

    isActive(): boolean {
      return active;
    },

    dispose(): void {
      this.stop();
    },
  };
}
