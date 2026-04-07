/**
 * FetchCredentialMiddleware Tests
 *
 * Tests that the middleware correctly injects upstream provider tokens into
 * outgoing fetch requests and handles all edge cases gracefully.
 */
import { FetchCredentialMiddleware } from '../fetch-credential-middleware';
import type { TokenAccessor, FrontMcpFetchInit } from '../fetch-credential-middleware';

describe('FetchCredentialMiddleware', () => {
  const TEST_URL = 'https://api.github.com/user/repos';
  const TEST_TOKEN = 'gho_abc123_test_token';

  function createMockAccessor(tokens: Record<string, string | null> = {}): TokenAccessor {
    return {
      getToken: jest.fn(async (providerId: string) => tokens[providerId] ?? null),
    };
  }

  describe('provider specified with token available', () => {
    it('should inject Authorization header with Bearer token', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      const headers = new Headers(result.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
      expect(accessor.getToken).toHaveBeenCalledWith('github');
    });

    it('should remove the credentials field from the returned init', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'POST',
        credentials: { provider: 'github' },
        body: JSON.stringify({ query: 'test' }),
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result.credentials).toBeUndefined();
      expect(result.method).toBe('POST');
      expect(result.body).toBe(JSON.stringify({ query: 'test' }));
    });

    it('should resolve the correct provider token', async () => {
      const accessor = createMockAccessor({
        github: 'github-token',
        jira: 'jira-token',
        slack: 'slack-token',
      });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        credentials: { provider: 'jira' },
      };

      const result = await middleware.applyCredentials('https://jira.example.com/api', init);

      const headers = new Headers(result.headers);
      expect(headers.get('Authorization')).toBe('Bearer jira-token');
      expect(accessor.getToken).toHaveBeenCalledWith('jira');
    });
  });

  describe('no credentials', () => {
    it('should return init unchanged when credentials is undefined', async () => {
      const accessor = createMockAccessor();
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result).toBe(init);
      expect(accessor.getToken).not.toHaveBeenCalled();
    });
  });

  describe('standard string credentials', () => {
    it('should pass through "include" unchanged', async () => {
      const accessor = createMockAccessor();
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: 'include',
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result).toBe(init);
      expect(result.credentials).toBe('include');
      expect(accessor.getToken).not.toHaveBeenCalled();
    });

    it('should pass through "same-origin" unchanged', async () => {
      const accessor = createMockAccessor();
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: 'same-origin',
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result).toBe(init);
      expect(result.credentials).toBe('same-origin');
      expect(accessor.getToken).not.toHaveBeenCalled();
    });

    it('should pass through "omit" unchanged', async () => {
      const accessor = createMockAccessor();
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: 'omit',
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result).toBe(init);
      expect(result.credentials).toBe('omit');
      expect(accessor.getToken).not.toHaveBeenCalled();
    });
  });

  describe('provider specified but no token available', () => {
    it('should not inject Authorization header when token is null', async () => {
      const accessor = createMockAccessor({ github: null });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result.headers).toBeUndefined();
      expect(result.credentials).toBeUndefined();
      expect(result.method).toBe('GET');
      expect(accessor.getToken).toHaveBeenCalledWith('github');
    });

    it('should not inject Authorization header when provider is unknown', async () => {
      const accessor = createMockAccessor({});
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        credentials: { provider: 'unknown-provider' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result.headers).toBeUndefined();
      expect(result.credentials).toBeUndefined();
      expect(accessor.getToken).toHaveBeenCalledWith('unknown-provider');
    });

    it('should remove credentials field even when no token is available', async () => {
      const accessor = createMockAccessor({});
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'POST',
        credentials: { provider: 'github' },
        body: 'payload',
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result.credentials).toBeUndefined();
      expect(result.body).toBe('payload');
      expect(result.method).toBe('POST');
    });
  });

  describe('existing headers preserved', () => {
    it('should preserve existing headers when injecting token', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
          'X-Custom-Header': 'custom-value',
        },
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      const headers = new Headers(result.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Accept')).toBe('application/vnd.github.v3+json');
      expect(headers.get('X-Custom-Header')).toBe('custom-value');
    });

    it('should preserve Headers object when injecting token', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const existingHeaders = new Headers();
      existingHeaders.set('X-Request-Id', '12345');

      const init: FrontMcpFetchInit = {
        method: 'GET',
        headers: existingHeaders,
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      const headers = new Headers(result.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
      expect(headers.get('X-Request-Id')).toBe('12345');
    });

    it('should override existing Authorization header with vault token', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const init: FrontMcpFetchInit = {
        method: 'GET',
        headers: {
          Authorization: 'Bearer old-stale-token',
        },
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      const headers = new Headers(result.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
    });
  });

  describe('other init properties', () => {
    it('should preserve all non-credentials init properties', async () => {
      const accessor = createMockAccessor({ github: TEST_TOKEN });
      const middleware = new FetchCredentialMiddleware(accessor);

      const signal = new AbortController().signal;
      const init: FrontMcpFetchInit = {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
        signal,
        credentials: { provider: 'github' },
      };

      const result = await middleware.applyCredentials(TEST_URL, init);

      expect(result.method).toBe('POST');
      expect(result.body).toBe(JSON.stringify({ data: 'test' }));
      expect(result.signal).toBe(signal);
      expect(result.credentials).toBeUndefined();
    });
  });
});
