import { createFetchClient } from '../createFetchClient';
import type { HttpClient, HttpRequestConfig } from '../api.types';

describe('createFetchClient', () => {
  it('returns an HttpClient with a request method', () => {
    const client = createFetchClient(jest.fn());
    expect(typeof client.request).toBe('function');
  });

  it('calls the provided fetch function with correct URL and options', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{"ok":true}'),
    });

    const client: HttpClient = createFetchClient(mockFetch as unknown as typeof globalThis.fetch);

    const config: HttpRequestConfig = {
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: { name: 'Alice' },
    };

    await client.request(config);

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ name: 'Alice' }),
    });
  });

  it('parses JSON response data', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{"id":1,"name":"Alice"}'),
    });

    const client = createFetchClient(mockFetch as unknown as typeof globalThis.fetch);
    const response = await client.request({ method: 'GET', url: '/users/1', headers: {} });

    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      data: { id: 1, name: 'Alice' },
    });
  });

  it('returns plain text when response is not valid JSON', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('Hello, world!'),
    });

    const client = createFetchClient(mockFetch as unknown as typeof globalThis.fetch);
    const response = await client.request({ method: 'GET', url: '/hello', headers: {} });

    expect(response.data).toBe('Hello, world!');
  });

  it('does not set body when config.body is undefined', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{}'),
    });

    const client = createFetchClient(mockFetch as unknown as typeof globalThis.fetch);
    await client.request({ method: 'GET', url: '/items', headers: {} });

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.body).toBeUndefined();
  });

  it('preserves status and statusText from the fetch response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('{"error":"not found"}'),
    });

    const client = createFetchClient(mockFetch as unknown as typeof globalThis.fetch);
    const response = await client.request({ method: 'GET', url: '/missing', headers: {} });

    expect(response.status).toBe(404);
    expect(response.statusText).toBe('Not Found');
    expect(response.data).toEqual({ error: 'not found' });
  });

  it('uses globalThis.fetch when no fetch function is provided', async () => {
    const original = globalThis.fetch;
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('"ok"'),
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    try {
      const client = createFetchClient();
      await client.request({ method: 'GET', url: '/test', headers: {} });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
