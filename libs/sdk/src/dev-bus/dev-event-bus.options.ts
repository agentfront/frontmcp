import { z } from 'zod';

/**
 * DevEventBus configuration options.
 * Controls how dev events are captured and emitted.
 */
export const devEventBusOptionsSchema = z.object({
  /**
   * Enable dev event bus.
   * When true, SDK events are captured and emitted for dashboard consumption.
   * Default: auto-detect from FRONTMCP_DEV_MODE environment variable
   */
  enabled: z.boolean().optional(),

  /**
   * Maximum number of events to buffer for late subscribers.
   * Oldest events are dropped when buffer is full.
   * Default: 1000
   */
  bufferSize: z.number().int().positive().default(1000),

  /**
   * Sampling rate for high-frequency events (0-1).
   * 1.0 = capture all events, 0.5 = capture 50% of events.
   * Default: 1.0
   */
  samplingRate: z.number().min(0).max(1).default(1.0),

  /**
   * Event types to exclude from capture.
   * Useful for filtering out noisy events.
   * Default: []
   */
  excludeTypes: z.array(z.string()).default([]),

  /**
   * Capture request bodies in request events.
   * May contain sensitive data - disable for privacy.
   * Default: true
   */
  captureRequestBodies: z.boolean().default(true),

  /**
   * Capture response bodies in request events.
   * May contain sensitive data - disable for privacy.
   * Default: true
   */
  captureResponseBodies: z.boolean().default(true),

  /**
   * Sanitize headers by removing sensitive values.
   * Removes Authorization, Cookie, Set-Cookie headers.
   * Default: true
   */
  sanitizeHeaders: z.boolean().default(true),

  /**
   * Headers to redact (case-insensitive).
   * Default: ['authorization', 'cookie', 'set-cookie', 'x-api-key']
   */
  redactHeaders: z.array(z.string()).default(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']),

  /**
   * Transport mode for sending events to dashboard.
   * - 'ipc': Use Node.js IPC channel (process.send)
   * - 'stderr': Write JSON to stderr with magic prefix
   * - 'auto': Try IPC first, fall back to stderr
   * Default: 'auto'
   */
  transport: z.enum(['ipc', 'stderr', 'auto']).default('auto'),
});

export type DevEventBusOptions = z.infer<typeof devEventBusOptionsSchema>;
export type DevEventBusOptionsInput = z.input<typeof devEventBusOptionsSchema>;

/**
 * Parse and validate DevEventBus options with defaults.
 */
export function parseDevEventBusOptions(input?: DevEventBusOptionsInput): DevEventBusOptions {
  return devEventBusOptionsSchema.parse(input ?? {});
}

/**
 * Check if dev event bus should be enabled.
 * Returns true if:
 * 1. options.enabled is explicitly true, OR
 * 2. options.enabled is undefined AND FRONTMCP_DEV_MODE=true
 */
export function isDevBusEnabled(options?: DevEventBusOptionsInput): boolean {
  if (options?.enabled !== undefined) {
    return options.enabled;
  }
  return process.env['FRONTMCP_DEV_MODE'] === 'true';
}
