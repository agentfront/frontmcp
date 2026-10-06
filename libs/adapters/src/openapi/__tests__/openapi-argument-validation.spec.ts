/**
 * An OpenAPI tool checks its arguments against the spec before it sends a request (#767). The SDK
 * passes the arguments of a tool with a raw JSON Schema through unchecked, so up to 1.9.1
 * `listTickets({ status: 'bogus' })` sent `?status=bogus`.
 */
import 'reflect-metadata';

import type { OpenAPIV3 } from 'openapi-types';

import { App, FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';

const spec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: { title: 'Desk', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets',
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'closed'] } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

describe('OpenAPI tool arguments', () => {
  const requestedUrls: string[] = [];
  const realFetch = global.fetch;
  let server: DirectMcpServer;

  beforeAll(async () => {
    global.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    @App({
      id: 'desk',
      name: 'Desk',
      adapters: [OpenapiAdapter.init({ name: 'desk', baseUrl: 'https://api.example.com', spec })],
    })
    class DeskApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'openapi-argument-validation', version: '1.0.0' },
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

  it('refuses a value the spec does not allow, and sends nothing', async () => {
    await expect(server.callTool('listTickets', { status: 'bogus' })).rejects.toThrow(
      /Invalid arguments for tool 'listTickets': status:/,
    );
    expect(requestedUrls).toEqual([]);
  });

  it('sends a request for arguments the spec allows', async () => {
    const result = await server.callTool('listTickets', { status: 'open' });

    expect(result.isError).toBeFalsy();
    expect(requestedUrls).toEqual(['https://api.example.com/tickets?status=open']);
  });
});
