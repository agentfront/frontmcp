import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useApiClient } from '../useApiClient';
import type { ApiClientOptions, HttpClient } from '../api.types';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import type { FrontMcpContextValue } from '../../types';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';

function createMockContext(): FrontMcpContextValue {
  return {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry: new DynamicRegistry(),
    connect: jest.fn(),
  };
}

function createWrapper(ctx: FrontMcpContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>;
  };
}

const sampleOps = [
  {
    operationId: 'getUser',
    description: 'Get a user',
    method: 'GET',
    path: '/users/{id}',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  },
];

describe('useApiClient', () => {
  // ─── Custom HttpClient injection ──────────────────────────────────────

  describe('custom client injection', () => {
    it('calls client.request() with correct config for GET', async () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, statusText: 'OK', data: { name: 'Alice' } }),
      };

      const options: ApiClientOptions = {
        baseUrl: 'https://api.example.com',
        operations: sampleOps,
        client: mockClient,
      };

      renderHook(() => useApiClient(options), { wrapper: createWrapper(ctx) });

      // The tool should be registered
      const tools = ctx.dynamicRegistry.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('api_getUser');

      // Execute the registered tool
      const result = await tools[0].execute({ id: '42' });
      expect(mockClient.request).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://api.example.com/users/42',
        headers: { 'Content-Type': 'application/json' },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe(200);
      expect(parsed.data).toEqual({ name: 'Alice' });
      expect(result.isError).toBe(false);
    });

    it('calls client.request() with body for POST', async () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 201, statusText: 'Created', data: { id: '1' } }),
      };

      const options: ApiClientOptions = {
        baseUrl: 'https://api.example.com',
        operations: [
          {
            operationId: 'createUser',
            description: 'Create a user',
            method: 'POST',
            path: '/users',
            inputSchema: { type: 'object' },
          },
        ],
        client: mockClient,
      };

      renderHook(() => useApiClient(options), { wrapper: createWrapper(ctx) });

      const tools = ctx.dynamicRegistry.getTools();
      await tools[0].execute({ body: { name: 'Alice' } });

      expect(mockClient.request).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Alice' },
      });
    });

    it('sets isError true when status >= 400', async () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 500, statusText: 'Server Error', data: 'boom' }),
      };

      renderHook(
        () => useApiClient({ baseUrl: 'https://api.example.com', operations: sampleOps, client: mockClient }),
        { wrapper: createWrapper(ctx) },
      );

      const result = await ctx.dynamicRegistry.getTools()[0].execute({ id: '1' });
      expect(result.isError).toBe(true);
    });
  });

  // ─── Backward compat: fetch option ────────────────────────────────────

  describe('backward compat: fetch option', () => {
    it('uses the provided fetch function when no client is given', async () => {
      const ctx = createMockContext();
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        text: () => Promise.resolve('{"result":"ok"}'),
      });

      renderHook(
        () =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            fetch: mockFetch as unknown as typeof globalThis.fetch,
          }),
        { wrapper: createWrapper(ctx) },
      );

      await ctx.dynamicRegistry.getTools()[0].execute({ id: '1' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/users/1');
    });
  });

  // ─── Default behavior ─────────────────────────────────────────────────

  describe('default behavior', () => {
    it('uses globalThis.fetch when neither client nor fetch is provided', async () => {
      const ctx = createMockContext();
      const original = globalThis.fetch;
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        text: () => Promise.resolve('"default"'),
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      try {
        renderHook(() => useApiClient({ baseUrl: 'https://api.example.com', operations: sampleOps }), {
          wrapper: createWrapper(ctx),
        });

        await ctx.dynamicRegistry.getTools()[0].execute({ id: '1' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  // ─── Headers factory ──────────────────────────────────────────────────

  describe('headers', () => {
    it('calls headers factory fresh per request', async () => {
      const ctx = createMockContext();
      let callCount = 0;
      const headersFactory = () => {
        callCount++;
        return { Authorization: `Bearer token-${callCount}` };
      };

      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: {} }),
      };

      renderHook(
        () =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            headers: headersFactory,
            client: mockClient,
          }),
        { wrapper: createWrapper(ctx) },
      );

      const tool = ctx.dynamicRegistry.getTools()[0];
      await tool.execute({ id: '1' });
      await tool.execute({ id: '2' });

      const firstCall = (mockClient.request as jest.Mock).mock.calls[0][0];
      const secondCall = (mockClient.request as jest.Mock).mock.calls[1][0];

      expect(firstCall.headers.Authorization).toBe('Bearer token-1');
      expect(secondCall.headers.Authorization).toBe('Bearer token-2');
    });

    it('merges static headers with defaults', async () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: {} }),
      };

      renderHook(
        () =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            headers: { 'X-Custom': 'test' },
            client: mockClient,
          }),
        { wrapper: createWrapper(ctx) },
      );

      await ctx.dynamicRegistry.getTools()[0].execute({ id: '1' });
      const config = (mockClient.request as jest.Mock).mock.calls[0][0];
      expect(config.headers['Content-Type']).toBe('application/json');
      expect(config.headers['X-Custom']).toBe('test');
    });
  });

  // ─── Client ref updates between renders ───────────────────────────────

  describe('client ref updates', () => {
    it('uses the latest client ref on each request (no stale closure)', async () => {
      const ctx = createMockContext();
      const client1: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: 'v1' }),
      };
      const client2: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: 'v2' }),
      };

      const { rerender } = renderHook(
        ({ client }: { client: HttpClient }) =>
          useApiClient({ baseUrl: 'https://api.example.com', operations: sampleOps, client }),
        { wrapper: createWrapper(ctx), initialProps: { client: client1 } },
      );

      // First call uses client1
      const tools = ctx.dynamicRegistry.getTools();
      await tools[0].execute({ id: '1' });
      expect(client1.request).toHaveBeenCalledTimes(1);

      // Rerender with client2 — the ref should update
      rerender({ client: client2 });
      await tools[0].execute({ id: '2' });
      expect(client2.request).toHaveBeenCalledTimes(1);
    });
  });

  // ─── client takes precedence over fetch ───────────────────────────────

  describe('precedence', () => {
    it('client takes precedence over fetch when both are provided', async () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: 'client' }),
      };
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        text: () => Promise.resolve('"fetch"'),
      });

      renderHook(
        () =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            client: mockClient,
            fetch: mockFetch as unknown as typeof globalThis.fetch,
          }),
        { wrapper: createWrapper(ctx) },
      );

      await ctx.dynamicRegistry.getTools()[0].execute({ id: '1' });
      expect(mockClient.request).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ─── Cleanup on unmount ───────────────────────────────────────────────

  describe('cleanup', () => {
    it('unregisters tools on unmount', () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: {} }),
      };

      const { unmount } = renderHook(
        () => useApiClient({ baseUrl: 'https://api.example.com', operations: sampleOps, client: mockClient }),
        { wrapper: createWrapper(ctx) },
      );

      expect(ctx.dynamicRegistry.getTools()).toHaveLength(1);
      unmount();
      expect(ctx.dynamicRegistry.getTools()).toHaveLength(0);
    });
  });

  // ─── Tool naming ──────────────────────────────────────────────────────

  describe('tool naming', () => {
    it('uses custom prefix in tool names', () => {
      const ctx = createMockContext();
      const mockClient: HttpClient = {
        request: jest.fn().mockResolvedValue({ status: 200, data: {} }),
      };

      renderHook(
        () =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            prefix: 'myApi',
            client: mockClient,
          }),
        { wrapper: createWrapper(ctx) },
      );

      expect(ctx.dynamicRegistry.getTools()[0].name).toBe('myApi_getUser');
    });
  });
});
