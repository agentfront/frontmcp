import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import { ComponentRegistry } from '../../components/ComponentRegistry';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import type { ApiClientOptions, ApiOperation, ApiParameter, HttpClient, HttpRequestConfig } from '../api.types';
import { parseOpenApiSpec } from '../parseOpenApiSpec';
import { useApiClient } from '../useApiClient';

function createMockContext(): FrontMcpContextValue {
  const dynamicRegistry = new DynamicRegistry();
  return {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
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

  // ─── Query and header parameters (#681) ───────────────────────────────

  describe('declared parameters', () => {
    const searchOp: ApiOperation = {
      operationId: 'searchUsers',
      description: 'Search users',
      method: 'GET',
      path: '/orgs/{org}/users',
      inputSchema: {
        type: 'object',
        properties: {
          org: { type: 'string' },
          q: { type: 'string' },
          tag: { type: 'array', items: { type: 'string' } },
          filter: { type: 'object' },
          limit: { type: 'integer' },
          'X-Trace': { type: 'string' },
        },
      },
      parameters: [
        { name: 'org', in: 'path' },
        { name: 'q', in: 'query' },
        { name: 'tag', in: 'query' },
        { name: 'filter', in: 'query' },
        { name: 'limit', in: 'query' },
        { name: 'X-Trace', in: 'header' },
        { name: 'session', in: 'cookie' },
      ],
    };

    function setup(baseUrl = 'https://api.example.com') {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: [] }) };
      renderHook(() => useApiClient({ baseUrl, operations: [searchOp], client }), { wrapper: createWrapper(ctx) });
      return { tool: ctx.dynamicRegistry.getTools()[0], request: client.request as jest.Mock };
    }

    it('sends the query parameters in the query string and header parameters as headers', async () => {
      const { tool, request } = setup();

      await tool.execute({
        org: 'acme co',
        q: 'a&b',
        tag: ['x', 'y'],
        filter: { active: true },
        limit: 5,
        'X-Trace': 't-1',
        session: 's',
      });

      const config = request.mock.calls[0][0];
      const url = new URL(config.url);
      expect(url.pathname).toBe('/orgs/acme%20co/users');
      expect(url.searchParams.get('q')).toBe('a&b');
      expect(url.searchParams.getAll('tag')).toEqual(['x', 'y']);
      expect(url.searchParams.get('active')).toBe('true');
      expect(url.searchParams.has('filter')).toBe(false);
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.has('session')).toBe(false);
      expect(config.headers).toEqual({ 'Content-Type': 'application/json', 'X-Trace': 't-1' });
    });

    it('leaves out query and header parameters that were not given', async () => {
      const { tool, request } = setup();

      await tool.execute({ org: 'acme', q: null });

      expect(request.mock.calls[0][0].url).toBe('https://api.example.com/orgs/acme/users');
      expect(request.mock.calls[0][0].headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('appends to a base URL that already has a query string', async () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: [] }) };
      const op: ApiOperation = { ...searchOp, path: '/users?v=2', parameters: [{ name: 'q', in: 'query' }] };
      renderHook(() => useApiClient({ baseUrl: 'https://api.example.com', operations: [op], client }), {
        wrapper: createWrapper(ctx),
      });

      await ctx.dynamicRegistry.getTools()[0].execute({ q: 'x' });

      expect((client.request as jest.Mock).mock.calls[0][0].url).toBe('https://api.example.com/users?v=2&q=x');
    });

    it('sends the query parameters of an operation read from an OpenAPI spec', async () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: [] }) };
      const operations = parseOpenApiSpec({
        paths: {
          '/pets': {
            get: { operationId: 'listPets', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }] },
          },
        },
      });
      renderHook(() => useApiClient({ baseUrl: 'https://pets.example.com', operations, client }), {
        wrapper: createWrapper(ctx),
      });

      await ctx.dynamicRegistry.getTools()[0].execute({ limit: 3 });

      expect((client.request as jest.Mock).mock.calls[0][0].url).toBe('https://pets.example.com/pets?limit=3');
    });
  });

  describe('OpenAPI parameter serialization', () => {
    async function requestFor(parameter: ApiParameter, value: unknown): Promise<HttpRequestConfig> {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: null }) };
      const operation: ApiOperation = {
        operationId: 'listItems',
        description: 'List items',
        method: 'GET',
        path: '/items',
        inputSchema: { type: 'object' },
        parameters: [parameter],
      };
      renderHook(() => useApiClient({ baseUrl: 'https://api.example.com', operations: [operation], client }), {
        wrapper: createWrapper(ctx),
      });
      await ctx.dynamicRegistry.getTools()[0].execute({ [parameter.name]: value });
      return (client.request as jest.Mock).mock.calls[0][0];
    }

    type Serialization = Pick<ApiParameter, 'style' | 'explode'>;

    it.each<[string, Serialization, unknown, string]>([
      ['form array', {}, ['x', 'y'], 'v=x&v=y'],
      ['form object', {}, { a: 1, b: 'c d' }, 'a=1&b=c%20d'],
      ['non-exploded form array', { explode: false }, ['a,b', 'c'], 'v=a%2Cb,c'],
      ['non-exploded form object', { explode: false }, { a: 1, b: 2 }, 'v=a,1,b,2'],
      ['spaceDelimited array', { style: 'spaceDelimited' }, ['x', 'y'], 'v=x%20y'],
      ['pipeDelimited array', { style: 'pipeDelimited' }, ['x', 'y'], 'v=x%7Cy'],
      ['deepObject object', { style: 'deepObject', explode: true }, { role: 'admin' }, 'v%5Brole%5D=admin'],
    ])('writes a %s query argument', async (_label, serialization, value, expectedQuery) => {
      const config = await requestFor({ name: 'v', in: 'query', ...serialization }, value);

      expect(config.url).toBe(`https://api.example.com/items?${expectedQuery}`);
    });

    it.each<[string, Serialization, unknown, string]>([
      ['array', {}, ['x', 'y'], 'x,y'],
      ['object', {}, { a: 1, b: 2 }, 'a,1,b,2'],
      ['exploded object', { explode: true }, { a: 1, b: 2 }, 'a=1,b=2'],
    ])('writes a %s header argument comma-separated', async (_label, serialization, value, expectedHeader) => {
      const config = await requestFor({ name: 'X-Values', in: 'header', ...serialization }, value);

      expect(config.headers['X-Values']).toBe(expectedHeader);
    });

    it('uses the style an OpenAPI spec declares', async () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: null }) };
      const operations = parseOpenApiSpec({
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              parameters: [
                { name: 'filter', in: 'query', style: 'deepObject', explode: true, schema: { type: 'object' } },
                { name: 'X-Ids', in: 'header', schema: { type: 'array', items: { type: 'string' } } },
              ],
            },
          },
        },
      });
      renderHook(() => useApiClient({ baseUrl: 'https://api.example.com', operations, client }), {
        wrapper: createWrapper(ctx),
      });

      await ctx.dynamicRegistry.getTools()[0].execute({ filter: { owner: 'ada' }, 'X-Ids': ['1', '2'] });

      const config = (client.request as jest.Mock).mock.calls[0][0];
      expect(config.url).toBe('https://api.example.com/items?filter%5Bowner%5D=ada');
      expect(config.headers['X-Ids']).toBe('1,2');
    });
  });

  // ─── Inline options (#681) ────────────────────────────────────────────

  describe('inline options', () => {
    it('does not register the tools again when the options are recreated on every render', () => {
      const ctx = createMockContext();
      const registerSpy = jest.spyOn(ctx.dynamicRegistry, 'registerTool');
      const { rerender } = renderHook(
        ({ baseUrl }: { baseUrl: string }) =>
          useApiClient({
            baseUrl,
            operations: sampleOps.map((op) => ({ ...op })),
            client: { request: async () => ({ status: 200, data: null }) },
            headers: { 'X-A': '1' },
          }),
        { wrapper: createWrapper(ctx), initialProps: { baseUrl: 'https://a.example.com' } },
      );

      rerender({ baseUrl: 'https://b.example.com' });
      rerender({ baseUrl: 'https://b.example.com' });

      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    it('calls the base URL of the latest render', async () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: null }) };
      const { rerender } = renderHook(
        ({ baseUrl }: { baseUrl: string }) => useApiClient({ baseUrl, operations: sampleOps, client }),
        { wrapper: createWrapper(ctx), initialProps: { baseUrl: 'https://a.example.com' } },
      );

      rerender({ baseUrl: 'https://b.example.com' });
      await ctx.dynamicRegistry.getTools()[0].execute({ id: '7' });

      expect((client.request as jest.Mock).mock.calls[0][0].url).toBe('https://b.example.com/users/7');
    });

    it('calls the fetch of the latest render when no client is given', async () => {
      const ctx = createMockContext();
      const fetchResponse = { status: 200, statusText: 'OK', ok: true, text: () => Promise.resolve('null') };
      const firstFetch = jest.fn().mockResolvedValue(fetchResponse);
      const latestFetch = jest.fn().mockResolvedValue(fetchResponse);
      const { rerender } = renderHook(
        ({ fetchFn }: { fetchFn: jest.Mock }) =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: sampleOps,
            fetch: fetchFn as unknown as typeof globalThis.fetch,
          }),
        { wrapper: createWrapper(ctx), initialProps: { fetchFn: firstFetch } },
      );

      rerender({ fetchFn: latestFetch });
      await ctx.dynamicRegistry.getTools()[0].execute({ id: '7' });

      expect(firstFetch).not.toHaveBeenCalled();
      expect(latestFetch).toHaveBeenCalledWith('https://api.example.com/users/7', expect.anything());
    });

    it('keeps calling the committed base URL while a newer render is suspended', async () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn().mockResolvedValue({ status: 200, data: null }) };
      const neverSettles = new Promise<never>(() => undefined);
      function ApiTools({ baseUrl, suspend }: { baseUrl: string; suspend: boolean }) {
        useApiClient({ baseUrl, operations: sampleOps, client });
        if (suspend) throw neverSettles;
        return null;
      }
      const Wrapper = createWrapper(ctx);
      const tree = (baseUrl: string, suspend: boolean) => (
        <Wrapper>
          <React.Suspense fallback={null}>
            <ApiTools baseUrl={baseUrl} suspend={suspend} />
          </React.Suspense>
        </Wrapper>
      );
      const { rerender } = render(tree('https://a.example.com', false));

      await act(async () => {
        React.startTransition(() => rerender(tree('https://b.example.com', true)));
      });
      await ctx.dynamicRegistry.getTools()[0].execute({ id: '7' });

      expect((client.request as jest.Mock).mock.calls[0][0].url).toBe('https://a.example.com/users/7');
    });

    it('registers the tools again when an operation changes', () => {
      const ctx = createMockContext();
      const client: HttpClient = { request: jest.fn() };
      const { rerender } = renderHook(
        ({ description }: { description: string }) =>
          useApiClient({
            baseUrl: 'https://api.example.com',
            operations: [{ ...sampleOps[0], description }],
            client,
          }),
        { wrapper: createWrapper(ctx), initialProps: { description: 'first' } },
      );

      rerender({ description: 'second' });

      expect(ctx.dynamicRegistry.getTools().map((tool) => tool.description)).toEqual(['second']);
    });
  });
});
