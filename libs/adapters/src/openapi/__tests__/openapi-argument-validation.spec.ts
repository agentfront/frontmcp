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
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'object', properties: { name: { type: 'string' }, meows: { type: 'boolean' } } },
                  { type: 'object', properties: { name: { type: 'string' }, barks: { type: 'boolean' } } },
                ],
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
    '/hosts/{hostId}': {
      get: {
        operationId: 'getHost',
        parameters: [
          { name: 'hostId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'hostname', in: 'query', schema: { type: 'string', format: 'hostname' } },
        ],
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

  it('sends a body that matches more than one open oneOf branch', async () => {
    const result = await server.callTool('createPet', { body: { name: 'rex', barks: true } });

    expect(result.isError).toBeFalsy();
    expect(requestedUrls).toEqual(['https://api.example.com/tickets']);
  });

  it.each([
    ['a UUID with version nibble 0', '6ba7b810-9dad-01d1-80b4-00c04fd430c8'],
    ['a UUID of repeated digits', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ['a UUID the JSON Schema test suite counts as valid', '99c17cbb-656f-fcfb-a8b7-1df4b6c28c0b'],
  ])('treats format as an annotation and sends %s', async (_label, hostId) => {
    const result = await server.callTool('getHost', { hostId, hostname: 'my_host.internal' });

    expect(result.isError).toBeFalsy();
    expect(requestedUrls).toEqual([`https://api.example.com/hosts/${hostId}?hostname=my_host.internal`]);
  });
});
