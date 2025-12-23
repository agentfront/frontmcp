// file: libs/browser/src/telemetry/capture/network-capture.ts
/**
 * Network Capture Module
 *
 * Captures network events from fetch and XMLHttpRequest.
 */

import type { CaptureModule, CaptureModuleOptions, TelemetryCategory, NetworkType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Network capture options.
 */
export interface NetworkCaptureOptions extends CaptureModuleOptions {
  /** Capture fetch requests */
  captureFetch?: boolean;

  /** Capture XHR requests */
  captureXhr?: boolean;

  /** URL patterns to include (regex) */
  include?: RegExp[];

  /** URL patterns to exclude (regex) */
  exclude?: RegExp[];

  /** Capture request/response headers */
  captureHeaders?: boolean;

  /** Headers to redact */
  redactHeaders?: string[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if URL matches any pattern.
 */
function matchesPatterns(url: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(url));
}

/**
 * Extract and redact headers.
 */
function extractHeaders(
  headers: Headers | Record<string, string> | undefined,
  redactList: string[],
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const result: Record<string, string> = {};
  const redactSet = new Set(redactList.map((h) => h.toLowerCase()));

  const iterate = (key: string, value: string) => {
    const lowerKey = key.toLowerCase();
    result[key] = redactSet.has(lowerKey) ? '[REDACTED]' : value;
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => iterate(key, value));
  } else {
    for (const [key, value] of Object.entries(headers)) {
      iterate(key, value);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a network capture module.
 */
export function createNetworkCapture(options: NetworkCaptureOptions): CaptureModule {
  const {
    collector,
    captureFetch = true,
    captureXhr = true,
    include,
    exclude,
    captureHeaders = false,
    redactHeaders = DEFAULT_REDACT_HEADERS,
    debug = false,
  } = options;

  let active = false;
  let originalFetch: typeof fetch | null = null;
  let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[NetworkCapture] ${message}`, data ?? '');
    }
  };

  /**
   * Check if URL should be captured.
   */
  const shouldCapture = (url: string): boolean => {
    if (exclude && matchesPatterns(url, exclude)) return false;
    if (include && !matchesPatterns(url, include)) return false;
    return true;
  };

  /**
   * Record a network event.
   */
  const recordNetworkEvent = (data: {
    type: NetworkType;
    method: string;
    url: string;
    status?: number;
    statusText?: string;
    duration?: number;
    success: boolean;
    error?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
  }) => {
    collector.record({
      category: 'network' as TelemetryCategory,
      ...data,
    } as Parameters<typeof collector.record>[0]);
  };

  /**
   * Patch fetch.
   */
  const patchFetch = () => {
    if (!captureFetch || typeof window === 'undefined' || !window.fetch) return;

    originalFetch = window.fetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const startTime = performance.now();

      if (!shouldCapture(url)) {
        return originalFetch!.call(this, input, init);
      }

      try {
        const response = await originalFetch!.call(this, input, init);
        const duration = performance.now() - startTime;

        recordNetworkEvent({
          type: 'fetch',
          method: method.toUpperCase(),
          url,
          status: response.status,
          statusText: response.statusText,
          duration: Math.round(duration),
          success: response.ok,
          requestHeaders: captureHeaders
            ? extractHeaders(init?.headers as Record<string, string>, redactHeaders)
            : undefined,
          responseHeaders: captureHeaders ? extractHeaders(response.headers, redactHeaders) : undefined,
        });

        log(`Fetch: ${method} ${url} -> ${response.status}`);
        return response;
      } catch (error) {
        const duration = performance.now() - startTime;

        recordNetworkEvent({
          type: 'fetch',
          method: method.toUpperCase(),
          url,
          duration: Math.round(duration),
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        log(`Fetch error: ${method} ${url}`, error);
        throw error;
      }
    };
  };

  /**
   * Restore fetch.
   */
  const restoreFetch = () => {
    if (originalFetch && typeof window !== 'undefined') {
      window.fetch = originalFetch;
      originalFetch = null;
    }
  };

  /**
   * Patch XMLHttpRequest.
   */
  const patchXhr = () => {
    if (!captureXhr || typeof window === 'undefined' || !window.XMLHttpRequest) return;

    originalXhrOpen = XMLHttpRequest.prototype.open;
    originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null,
    ): void {
      const urlStr = url instanceof URL ? url.href : url;

      // Store request info
      (this as XMLHttpRequest & { _telemetry?: { method: string; url: string; startTime?: number } })._telemetry = {
        method: method.toUpperCase(),
        url: urlStr,
      };

      return originalXhrOpen!.call(this, method, url, async, username, password);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
      const xhr = this as XMLHttpRequest & { _telemetry?: { method: string; url: string; startTime?: number } };
      const telemetryData = xhr._telemetry;

      if (!telemetryData || !shouldCapture(telemetryData.url)) {
        return originalXhrSend!.call(this, body as XMLHttpRequestBodyInit | null | undefined);
      }

      telemetryData.startTime = performance.now();

      const handleLoad = () => {
        const duration = telemetryData.startTime ? performance.now() - telemetryData.startTime : undefined;

        recordNetworkEvent({
          type: 'xhr',
          method: telemetryData.method,
          url: telemetryData.url,
          status: xhr.status,
          statusText: xhr.statusText,
          duration: duration ? Math.round(duration) : undefined,
          success: xhr.status >= 200 && xhr.status < 400,
        });

        log(`XHR: ${telemetryData.method} ${telemetryData.url} -> ${xhr.status}`);
      };

      const handleError = () => {
        const duration = telemetryData.startTime ? performance.now() - telemetryData.startTime : undefined;

        recordNetworkEvent({
          type: 'xhr',
          method: telemetryData.method,
          url: telemetryData.url,
          duration: duration ? Math.round(duration) : undefined,
          success: false,
          error: 'XHR request failed',
        });

        log(`XHR error: ${telemetryData.method} ${telemetryData.url}`);
      };

      xhr.addEventListener('load', handleLoad);
      xhr.addEventListener('error', handleError);
      xhr.addEventListener('abort', handleError);

      return originalXhrSend!.call(this, body as XMLHttpRequestBodyInit | null | undefined);
    };
  };

  /**
   * Restore XMLHttpRequest.
   */
  const restoreXhr = () => {
    if (originalXhrOpen && typeof window !== 'undefined') {
      XMLHttpRequest.prototype.open = originalXhrOpen;
      originalXhrOpen = null;
    }
    if (originalXhrSend && typeof window !== 'undefined') {
      XMLHttpRequest.prototype.send = originalXhrSend;
      originalXhrSend = null;
    }
  };

  return {
    name: 'network',

    start(): void {
      if (active) return;

      patchFetch();
      patchXhr();
      active = true;
      log('Started');
    },

    stop(): void {
      if (!active) return;

      restoreFetch();
      restoreXhr();
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
