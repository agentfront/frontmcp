/**
 * createFetchClient — wraps a plain fetch function into the HttpClient interface.
 *
 * Useful for developers who want the generic HttpClient interface but still
 * use fetch under the hood.
 */

import type { HttpClient, HttpRequestConfig, HttpResponse } from './api.types';

export function createFetchClient(fetchFn?: typeof globalThis.fetch): HttpClient {
  const fn = fetchFn ?? globalThis.fetch.bind(globalThis);

  return {
    async request(config: HttpRequestConfig): Promise<HttpResponse> {
      const fetchOptions: RequestInit = {
        method: config.method,
        headers: config.headers,
      };

      if (config.body !== undefined) {
        fetchOptions.body = JSON.stringify(config.body);
        // Ensure Content-Type is set when sending a JSON body
        const headers = fetchOptions.headers as Record<string, string> | undefined;
        if (headers && !headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      const response = await fn(config.url, fetchOptions);
      const responseText = await response.text();

      let data: unknown;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = responseText;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        data,
      };
    },
  };
}
