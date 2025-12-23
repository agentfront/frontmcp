// file: libs/browser/src/telemetry/capture/error-capture.ts
/**
 * Error Capture Module
 *
 * Captures JavaScript errors and unhandled promise rejections.
 */

import type {
  CaptureModule,
  CaptureModuleOptions,
  TelemetryCategory,
  TelemetrySignificance,
  ErrorType,
} from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Error capture options.
 */
export interface ErrorCaptureOptions extends CaptureModuleOptions {
  /** Capture window.onerror events */
  captureErrors?: boolean;

  /** Capture unhandled promise rejections */
  captureRejections?: boolean;

  /** Maximum stack trace length */
  maxStackLength?: number;

  /** Error patterns to ignore (regex on message) */
  ignore?: RegExp[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_STACK_LENGTH = 2000;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an error capture module.
 */
export function createErrorCapture(options: ErrorCaptureOptions): CaptureModule {
  const {
    collector,
    captureErrors = true,
    captureRejections = true,
    maxStackLength = DEFAULT_MAX_STACK_LENGTH,
    ignore = [],
    debug = false,
  } = options;

  let active = false;
  let errorHandler: OnErrorEventHandler | null = null;
  let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;
  let originalOnError: OnErrorEventHandler | null = null;
  let originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[ErrorCapture] ${message}`, data ?? '');
    }
  };

  /**
   * Check if error should be ignored.
   */
  const shouldIgnore = (message: string): boolean => {
    return ignore.some((pattern) => pattern.test(message));
  };

  /**
   * Truncate stack trace.
   */
  const truncateStack = (stack: string | undefined): string | undefined => {
    if (!stack) return undefined;
    return stack.slice(0, maxStackLength);
  };

  /**
   * Record an error event.
   */
  const recordError = (data: {
    type: ErrorType;
    message: string;
    name?: string;
    stack?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    handled?: boolean;
  }) => {
    if (shouldIgnore(data.message)) {
      log(`Ignored error: ${data.message}`);
      return;
    }

    collector.record({
      category: 'error' as TelemetryCategory,
      significance: 'high' as TelemetrySignificance,
      ...data,
      stack: truncateStack(data.stack),
    } as Parameters<typeof collector.record>[0]);

    log(`Captured ${data.type}: ${data.message}`);
  };

  /**
   * Handle window.onerror.
   */
  const handleError: OnErrorEventHandler = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ): boolean | void => {
    const messageStr = typeof message === 'string' ? message : message?.type ?? 'Unknown error';

    recordError({
      type: 'error',
      message: messageStr,
      name: error?.name,
      stack: error?.stack,
      filename: source,
      lineno,
      colno,
      handled: false,
    });

    // Call original handler if exists
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
  };

  /**
   * Handle unhandled promise rejections.
   */
  const handleRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    let message: string;
    let name: string | undefined;
    let stack: string | undefined;

    if (reason instanceof Error) {
      message = reason.message;
      name = reason.name;
      stack = reason.stack;
    } else if (typeof reason === 'string') {
      message = reason;
    } else {
      message = String(reason);
    }

    recordError({
      type: 'unhandledrejection',
      message,
      name,
      stack,
      handled: false,
    });

    // Call original handler if exists
    if (originalOnUnhandledRejection) {
      originalOnUnhandledRejection(event);
    }
  };

  return {
    name: 'error',

    start(): void {
      if (active) return;
      if (typeof window === 'undefined') return;

      if (captureErrors) {
        originalOnError = window.onerror;
        errorHandler = handleError;
        window.onerror = errorHandler;
      }

      if (captureRejections) {
        originalOnUnhandledRejection = window.onunhandledrejection as typeof rejectionHandler;
        rejectionHandler = handleRejection;
        window.addEventListener('unhandledrejection', rejectionHandler);
      }

      active = true;
      log('Started');
    },

    stop(): void {
      if (!active) return;

      if (captureErrors && errorHandler) {
        window.onerror = originalOnError;
        errorHandler = null;
        originalOnError = null;
      }

      if (captureRejections && rejectionHandler) {
        window.removeEventListener('unhandledrejection', rejectionHandler);
        rejectionHandler = null;
        originalOnUnhandledRejection = null;
      }

      active = false;
      log('Stopped');
    },

    isActive(): boolean {
      return active;
    },

    dispose(): void {
      this.stop();
    },
  };
}

/**
 * Manually capture an error.
 *
 * Use this for caught errors you want to track.
 */
export function captureError(
  collector: { record: (event: Record<string, unknown>) => void },
  error: Error | string,
  context?: Record<string, unknown>,
): void {
  const isError = error instanceof Error;

  collector.record({
    category: 'error' as TelemetryCategory,
    type: 'error',
    significance: 'high' as TelemetrySignificance,
    message: isError ? error.message : error,
    name: isError ? error.name : undefined,
    stack: isError ? error.stack : undefined,
    handled: true,
    metadata: context,
  });
}
