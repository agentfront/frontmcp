/**
 * @file http-mock.ts
 * @description HTTP request mocking implementation for offline MCP server testing
 *
 * This module intercepts fetch() and XMLHttpRequest calls, allowing tools to be
 * tested without making real HTTP requests.
 *
 * @example
 * ```typescript
 * import { httpMock } from '@frontmcp/testing';
 *
 * // Enable HTTP mocking
 * const interceptor = httpMock.interceptor();
 *
 * // Mock a GET request
 * interceptor.get('https://api.example.com/users', {
 *   body: [{ id: 1, name: 'John' }],
 * });
 *
 * // Mock a POST request with pattern matching
 * interceptor.post(/api\.example\.com\/users/, {
 *   status: 201,
 *   body: { id: 2, name: 'Jane' },
 * });
 *
 * // Now run your MCP server test - HTTP calls will be intercepted
 * const result = await mcp.tools.call('fetch-users', {});
 *
 * // Verify all mocks were used
 * interceptor.assertDone();
 *
 * // Restore original fetch
 * interceptor.restore();
 * ```
 */

import type {
  HttpMethod,
  HttpRequestMatcher,
  HttpMockResponse,
  HttpMockDefinition,
  HttpRequestInfo,
  HttpMockHandle,
  HttpInterceptor,
  HttpMockManager,
} from './http-mock.types';

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════

/** Original fetch function */
let originalFetch: typeof globalThis.fetch | null = null;

/** Whether mocking is enabled */
let mockingEnabled = false;

/** All active interceptors */
const activeInterceptors: HttpInterceptorImpl[] = [];

// ═══════════════════════════════════════════════════════════════════
// HTTP INTERCEPTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

interface MockEntry {
  definition: HttpMockDefinition;
  callCount: number;
  calls: HttpRequestInfo[];
  remainingUses: number;
}

class HttpInterceptorImpl implements HttpInterceptor {
  private mocks: MockEntry[] = [];
  private _allowPassthrough = false;
  private _isActive = true;

  mock(definition: HttpMockDefinition): HttpMockHandle {
    const entry: MockEntry = {
      definition,
      callCount: 0,
      calls: [],
      remainingUses: definition.times ?? Infinity,
    };

    this.mocks.push(entry);

    return {
      remove: () => {
        const index = this.mocks.indexOf(entry);
        if (index !== -1) {
          this.mocks.splice(index, 1);
        }
      },
      callCount: () => entry.callCount,
      calls: () => [...entry.calls],
      waitForCalls: async (count: number, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (entry.callCount >= count) {
            return entry.calls.slice(0, count);
          }
          await sleep(50);
        }
        throw new Error(`Timeout waiting for ${count} calls, got ${entry.callCount}`);
      },
    };
  }

  get(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle {
    return this.mock({
      match: { url, method: 'GET' },
      response: normalizeResponse(response),
    });
  }

  post(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle {
    return this.mock({
      match: { url, method: 'POST' },
      response: normalizeResponse(response),
    });
  }

  put(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle {
    return this.mock({
      match: { url, method: 'PUT' },
      response: normalizeResponse(response),
    });
  }

  delete(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle {
    return this.mock({
      match: { url, method: 'DELETE' },
      response: normalizeResponse(response),
    });
  }

  any(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle {
    return this.mock({
      match: { url },
      response: normalizeResponse(response),
    });
  }

  clear(): void {
    this.mocks = [];
  }

  pending(): HttpMockDefinition[] {
    return this.mocks.filter((m) => m.remainingUses > 0).map((m) => m.definition);
  }

  isDone(): boolean {
    return this.mocks.every((m) => m.remainingUses <= 0 || m.definition.times === undefined);
  }

  assertDone(): void {
    const pending = this.pending().filter((m) => m.times !== undefined);
    if (pending.length > 0) {
      const descriptions = pending.map((m) => {
        const url = m.match.url instanceof RegExp ? m.match.url.toString() : m.match.url;
        return `  - ${m.match.method ?? 'ANY'} ${url}`;
      });
      throw new Error(`Unused HTTP mocks:\n${descriptions.join('\n')}`);
    }
  }

  allowPassthrough(allow: boolean): void {
    this._allowPassthrough = allow;
  }

  restore(): void {
    this._isActive = false;
    const index = activeInterceptors.indexOf(this);
    if (index !== -1) {
      activeInterceptors.splice(index, 1);
    }
  }

  // Internal methods

  isActive(): boolean {
    return this._isActive;
  }

  canPassthrough(): boolean {
    return this._allowPassthrough;
  }

  /**
   * Try to match a request against mocks in this scope
   */
  async matchRequest(info: HttpRequestInfo): Promise<Response | null> {
    if (!this._isActive) return null;

    for (const entry of this.mocks) {
      if (entry.remainingUses <= 0) continue;

      if (this.requestMatches(info, entry.definition.match)) {
        // Found a match
        entry.callCount++;
        entry.calls.push(info);
        entry.remainingUses--;

        // Get response
        let mockResponse: HttpMockResponse;
        if (typeof entry.definition.response === 'function') {
          mockResponse = await entry.definition.response(info);
        } else {
          mockResponse = entry.definition.response;
        }

        // Apply delay
        if (mockResponse.delay && mockResponse.delay > 0) {
          await sleep(mockResponse.delay);
        }

        return createMockResponse(mockResponse);
      }
    }

    return null;
  }

  private requestMatches(info: HttpRequestInfo, matcher: HttpRequestMatcher): boolean {
    // Check URL
    if (!this.urlMatches(info.url, matcher.url)) {
      return false;
    }

    // Check method
    if (matcher.method) {
      const methods = Array.isArray(matcher.method) ? matcher.method : [matcher.method];
      if (!methods.includes(info.method)) {
        return false;
      }
    }

    // Check headers
    if (matcher.headers) {
      for (const [key, expected] of Object.entries(matcher.headers)) {
        const actual = info.headers[key.toLowerCase()];
        if (!actual) return false;
        if (expected instanceof RegExp) {
          if (!expected.test(actual)) return false;
        } else if (actual !== expected) {
          return false;
        }
      }
    }

    // Check body
    if (matcher.body !== undefined) {
      if (!this.bodyMatches(info.body, matcher.body)) {
        return false;
      }
    }

    return true;
  }

  private urlMatches(url: string, matcher: string | RegExp | ((url: string) => boolean)): boolean {
    if (typeof matcher === 'string') {
      // Exact match or contains
      return url === matcher || url.includes(matcher);
    } else if (matcher instanceof RegExp) {
      return matcher.test(url);
    } else {
      return matcher(url);
    }
  }

  private bodyMatches(
    actual: unknown,
    expected: string | RegExp | Record<string, unknown> | ((body: unknown) => boolean),
  ): boolean {
    if (typeof expected === 'function') {
      return expected(actual);
    }

    if (typeof expected === 'string') {
      const actualStr = typeof actual === 'string' ? actual : JSON.stringify(actual);
      return actualStr === expected || actualStr.includes(expected);
    }

    if (expected instanceof RegExp) {
      const actualStr = typeof actual === 'string' ? actual : JSON.stringify(actual);
      return expected.test(actualStr);
    }

    // Object comparison - check that all expected keys match
    if (typeof actual !== 'object' || actual === null) {
      return false;
    }

    for (const [key, value] of Object.entries(expected)) {
      const actualValue = (actual as Record<string, unknown>)[key];
      if (typeof value === 'object' && value !== null) {
        if (!this.bodyMatches(actualValue, value as Record<string, unknown>)) {
          return false;
        }
      } else if (actualValue !== value) {
        return false;
      }
    }

    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FETCH INTERCEPTOR
// ═══════════════════════════════════════════════════════════════════

async function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Build request info
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = ((init?.method ?? 'GET') as HttpMethod).toUpperCase() as HttpMethod;

  // Parse headers
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key.toLowerCase()] = value;
      }
    } else {
      for (const [key, value] of Object.entries(init.headers)) {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  // Parse body
  let body: unknown;
  let rawBody: string | undefined;
  if (init?.body) {
    if (typeof init.body === 'string') {
      rawBody = init.body;
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init.body instanceof ArrayBuffer || init.body instanceof Uint8Array) {
      rawBody = new TextDecoder().decode(init.body);
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    } else {
      body = init.body;
    }
  }

  const requestInfo: HttpRequestInfo = {
    url,
    method,
    headers,
    body,
    rawBody,
  };

  // Try to match against active interceptors (in reverse order - last added first)
  for (let i = activeInterceptors.length - 1; i >= 0; i--) {
    const interceptor = activeInterceptors[i];
    if (!interceptor.isActive()) continue;

    const mockResponse = await interceptor.matchRequest(requestInfo);
    if (mockResponse) {
      return mockResponse;
    }
  }

  // No match found - check if passthrough is allowed
  for (const interceptor of activeInterceptors) {
    if (interceptor.isActive() && interceptor.canPassthrough()) {
      // Passthrough to real fetch
      if (originalFetch) {
        return originalFetch(input, init);
      }
    }
  }

  // No match and no passthrough - throw error
  throw new Error(
    `No HTTP mock found for ${method} ${url}\n` +
      `Add a mock using httpMock.interceptor().${method.toLowerCase()}('${url}', { body: ... })`,
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function normalizeResponse(response: HttpMockResponse | Record<string, unknown>): HttpMockResponse {
  // If it looks like a plain object (response body), wrap it
  if (!('status' in response) && !('body' in response) && !('headers' in response)) {
    return { body: response as Record<string, unknown> };
  }
  return response as HttpMockResponse;
}

function createMockResponse(mock: HttpMockResponse): Response {
  const status = mock.status ?? 200;
  const statusText = mock.statusText ?? 'OK';

  // Build headers
  const headers = new Headers(mock.headers ?? {});

  // Build body
  let body: BodyInit | null = null;
  if (mock.body !== undefined) {
    if (typeof mock.body === 'string') {
      body = mock.body;
      if (!headers.has('content-type')) {
        headers.set('content-type', 'text/plain');
      }
    } else if (mock.body instanceof ArrayBuffer) {
      body = mock.body;
    } else if (Buffer.isBuffer(mock.body)) {
      // Convert Buffer to ArrayBuffer for Response compatibility
      body = new Uint8Array(mock.body).buffer;
    } else {
      body = JSON.stringify(mock.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Response(body, { status, statusText, headers });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════
// MANAGER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

class HttpMockManagerImpl implements HttpMockManager {
  interceptor(): HttpInterceptor {
    // Auto-enable mocking when creating an interceptor
    if (!mockingEnabled) {
      this.enable();
    }

    const interceptor = new HttpInterceptorImpl();
    activeInterceptors.push(interceptor);
    return interceptor;
  }

  enable(): void {
    if (mockingEnabled) return;

    // Store original fetch
    if (typeof globalThis.fetch === 'function') {
      originalFetch = globalThis.fetch;
      globalThis.fetch = interceptedFetch;
    }

    mockingEnabled = true;
  }

  disable(): void {
    if (!mockingEnabled) return;

    // Restore original fetch
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }

    // Clear all interceptors
    activeInterceptors.length = 0;
    mockingEnabled = false;
  }

  isEnabled(): boolean {
    return mockingEnabled;
  }

  clearAll(): void {
    for (const interceptor of activeInterceptors) {
      interceptor.clear();
    }
    activeInterceptors.length = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Global HTTP mock manager
 *
 * @example
 * ```typescript
 * import { httpMock } from '@frontmcp/testing';
 *
 * // Create an HTTP interceptor
 * const interceptor = httpMock.interceptor();
 *
 * // Mock requests
 * interceptor.get('https://api.example.com/data', { id: 1, name: 'Test' });
 *
 * // Run tests...
 *
 * // Clean up
 * interceptor.restore();
 * ```
 */
export const httpMock: HttpMockManager = new HttpMockManagerImpl();

/**
 * Helper to create mock responses
 */
export const httpResponse = {
  /** Create a JSON response */
  json<T>(data: T, status = 200): HttpMockResponse {
    return {
      status,
      headers: { 'content-type': 'application/json' },
      body: data as Record<string, unknown>,
    };
  },

  /** Create a text response */
  text(data: string, status = 200): HttpMockResponse {
    return {
      status,
      headers: { 'content-type': 'text/plain' },
      body: data,
    };
  },

  /** Create an HTML response */
  html(data: string, status = 200): HttpMockResponse {
    return {
      status,
      headers: { 'content-type': 'text/html' },
      body: data,
    };
  },

  /** Create an error response */
  error(status: number, message?: string): HttpMockResponse {
    return {
      status,
      statusText: message ?? getStatusText(status),
      body: message ? { error: message } : undefined,
    };
  },

  /** Create a 404 Not Found response */
  notFound(message = 'Not Found'): HttpMockResponse {
    return httpResponse.error(404, message);
  },

  /** Create a 500 Internal Server Error response */
  serverError(message = 'Internal Server Error'): HttpMockResponse {
    return httpResponse.error(500, message);
  },

  /** Create a 401 Unauthorized response */
  unauthorized(message = 'Unauthorized'): HttpMockResponse {
    return httpResponse.error(401, message);
  },

  /** Create a 403 Forbidden response */
  forbidden(message = 'Forbidden'): HttpMockResponse {
    return httpResponse.error(403, message);
  },

  /** Create a network error (throws instead of returning response) */
  networkError(message = 'Network error'): HttpMockResponse {
    return {
      status: 0,
      body: { _networkError: true, message },
    };
  },

  /** Create a delayed response */
  delayed<T>(data: T, delayMs: number, status = 200): HttpMockResponse {
    return {
      status,
      body: data as Record<string, unknown>,
      delay: delayMs,
    };
  },
};

function getStatusText(status: number): string {
  const texts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return texts[status] ?? 'Unknown';
}
