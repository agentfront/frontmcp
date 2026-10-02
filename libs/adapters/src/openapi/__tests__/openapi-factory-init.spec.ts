/**
 * `OpenapiAdapter.init({ name, inject, useFactory })` (#678).
 *
 * The factory returns the adapter's options. Start-up used to treat them as the adapter itself and
 * fail with `Cannot read properties of undefined (reading 'name')`, while a second rejection
 * (`reading 'description'`) escaped unhandled and ended a Node process that had no handler.
 */
import type { OpenAPIV3 } from 'openapi-types';

import { create, type DirectMcpServer } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';
import { createMockLogger } from './fixtures';

const BASE_URL = Symbol('openapi-factory-base-url');

const spec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: { title: 'Factory API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'Get user by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Success' } },
      },
    },
    '/users': {
      post: {
        operationId: 'createUser',
        summary: 'Create a user',
        responses: { '201': { description: 'Created' } },
      },
    },
  },
};

describe('OpenapiAdapter.init({ name, inject, useFactory })', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  let server: DirectMcpServer | undefined;

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    await server?.dispose();
    server = undefined;
  });

  it('builds the adapter from the options the factory returns and serves its tools', async () => {
    server = await create({
      info: { name: 'openapi-factory', version: '1.0.0' },
      providers: [{ name: 'base-url', provide: BASE_URL, useValue: 'https://api.example.com' }],
      adapters: [
        OpenapiAdapter.init({
          name: 'factory-api',
          inject: () => [BASE_URL] as const,
          useFactory: (baseUrl: string) => ({
            name: 'factory-api',
            baseUrl,
            spec,
            logger: createMockLogger(),
          }),
        }),
      ],
    });

    const { tools } = await server.listTools();

    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['getUser', 'createUser']));
    expect(unhandled).toEqual([]);
  });

  it('builds the adapter itself, not a value standing in for it', async () => {
    const record = OpenapiAdapter.init({
      name: 'factory-record',
      inject: () => [] as const,
      useFactory: () => ({ name: 'factory-record', baseUrl: 'https://api.example.com', spec }),
    }) as { useFactory: () => unknown };

    const adapter = record.useFactory();

    expect(adapter).toBeInstanceOf(OpenapiAdapter);
    expect((adapter as OpenapiAdapter).options).toMatchObject({ name: 'factory-record', spec });
  });
});
