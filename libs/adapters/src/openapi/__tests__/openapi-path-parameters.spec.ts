import 'reflect-metadata';

import type { McpOpenAPITool } from 'mcp-from-openapi';
import type { OpenAPIV3 } from 'openapi-types';

import { App, FrontMcpInstance, LogLevel, PublicMcpError, type DirectMcpServer } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';
import { buildRequest } from '../openapi.utils';

const BASE_URL = 'https://api.example.com/v1';
const noSecurity = { headers: {}, query: {}, cookies: {} };

function toolFor(path: string, keys: string[]): McpOpenAPITool {
  return {
    name: 'replyToTicket',
    description: 'Reply to a ticket',
    inputSchema: { type: 'object', properties: {} },
    mapper: keys.map((key) => ({ inputKey: key, type: 'path' as const, key, required: true })),
    metadata: { path, method: 'post', servers: [{ url: BASE_URL }] },
  };
}

function buildError(path: string, input: Record<string, unknown>): unknown {
  try {
    buildRequest(toolFor(path, Object.keys(input)), input, noSecurity, BASE_URL);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('path parameters in buildRequest', () => {
  it.each(['..', '.'])('refuses a path parameter equal to %j', (value) => {
    const error = buildError('/tickets/{id}/replies', { id: value });

    expect(error).toBeInstanceOf(PublicMcpError);
    expect((error as PublicMcpError).code).toBe('INVALID_PATH_PARAMETER');
  });

  it('refuses adjacent path parameters that together form a dot segment', () => {
    const error = buildError('/tickets/{a}{b}/replies', { a: '.', b: '.' });

    expect(error).toBeInstanceOf(PublicMcpError);
  });

  it('names the parameter in the refusal', () => {
    const error = buildError('/tickets/{id}/replies', { id: '..' });

    expect((error as PublicMcpError).getPublicMessage()).toBe(
      "Path parameter 'id' of operation 'replyToTicket' cannot be '.' or '..'",
    );
  });

  it.each([
    ['...', '/v1/tickets/.../replies'],
    ['v1.2', '/v1/tickets/v1.2/replies'],
    ['%2e%2e', '/v1/tickets/%252e%252e/replies'],
    ['..%2Fadmin', '/v1/tickets/..%252Fadmin/replies'],
    [' .. ', '/v1/tickets/%20..%20/replies'],
    ['..\t', '/v1/tickets/..%09/replies'],
    ['.\n.', '/v1/tickets/.%0A./replies'],
  ])('sends %j encoded, not resolved as a dot segment', (value, pathname) => {
    const { url } = buildRequest(toolFor('/tickets/{id}/replies', ['id']), { id: value }, noSecurity, BASE_URL);

    expect(new URL(url).pathname).toBe(pathname);
  });

  it.each([
    [7, '/v1/tickets/7/replies'],
    [true, '/v1/tickets/true/replies'],
  ])('sends a non-string value %j as it did before', (value, pathname) => {
    const { url } = buildRequest(toolFor('/tickets/{id}/replies', ['id']), { id: value }, noSecurity, BASE_URL);

    expect(new URL(url).pathname).toBe(pathname);
  });

  it('builds an operation without path parameters under the base path', () => {
    const { url } = buildRequest(toolFor('/tickets', []), {}, noSecurity, BASE_URL);

    expect(url).toBe('https://api.example.com/v1/tickets');
  });

  it('keeps a template that names the same parameter twice', () => {
    const { url } = buildRequest(toolFor('/users/{id}/posts/{id}', ['id']), { id: 'u-1' }, noSecurity, BASE_URL);

    expect(url).toBe('https://api.example.com/v1/users/u-1/posts/u-1');
  });
});

const spec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: { title: 'Desk', version: '1.0.0' },
  servers: [{ url: BASE_URL }],
  paths: {
    '/tickets/{id}/replies': {
      post: {
        operationId: 'replyToTicket',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

describe('an OpenAPI tool with a dot-segment path parameter', () => {
  const requestedUrls: string[] = [];
  const realFetch = global.fetch;
  let server: DirectMcpServer;

  beforeAll(async () => {
    global.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    @App({
      id: 'desk',
      name: 'Desk',
      adapters: [OpenapiAdapter.init({ name: 'desk', baseUrl: BASE_URL, spec, staticAuth: { jwt: 'desk-token' } })],
    })
    class DeskApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'openapi-path-parameters', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await server.dispose();
  });

  beforeEach(() => {
    requestedUrls.length = 0;
  });

  it.each(['..', '.'])('sends nothing for an id of %j', async (id) => {
    const outcome = await server.callTool('replyToTicket', { id }).catch((error: unknown) => error);

    expect(requestedUrls).toEqual([]);
    expect(outcome).toBeInstanceOf(PublicMcpError);
    expect((outcome as PublicMcpError).code).toBe('INVALID_PATH_PARAMETER');
  });

  it.each([
    ['..%2Fadmin', 'https://api.example.com/v1/tickets/..%252Fadmin/replies'],
    ['%2e%2e', 'https://api.example.com/v1/tickets/%252e%252e/replies'],
  ])('sends %j encoded, as before', async (id, url) => {
    await server.callTool('replyToTicket', { id });

    expect(requestedUrls).toEqual([url]);
  });
});
