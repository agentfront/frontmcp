/**
 * `generateOptions` filters choose which operations become tools.
 *
 * In 1.8.7 the adapter passed `mcp-from-openapi` only the generate options it listed by name, so
 * `includeTags`, `excludeTags`, `includeMethods`, `excludeMethods`, `includePaths`, `excludePaths`
 * and `readOnlyOnly` (and every other option it didn't list) were accepted and ignored: every
 * operation became a tool.
 */
import type { OpenAPIV3 } from 'openapi-types';

import { FrontMcpToolTokens } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';
import type { OpenApiAdapterOptions } from '../openapi.types';
import { createMockLogger } from './fixtures';

const ok = { '200': { description: 'ok' } };

const spec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: { title: 'Shop API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: { operationId: 'listUsers', tags: ['users'], responses: ok },
      post: { operationId: 'createUser', tags: ['users'], responses: ok },
    },
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getUser', tags: ['users'], responses: ok },
      delete: { operationId: 'deleteUser', tags: ['users', 'admin'], responses: ok },
    },
    '/orders': {
      get: { operationId: 'listOrders', tags: ['orders'], responses: ok },
      put: { operationId: 'replaceOrders', tags: ['orders'], responses: ok },
    },
    '/admin/audit/events': {
      get: { operationId: 'listAuditEvents', tags: ['admin'], responses: ok },
    },
  },
};

async function toolNames(generateOptions: OpenApiAdapterOptions['generateOptions']): Promise<string[]> {
  const adapter = new OpenapiAdapter({
    name: 'shop',
    baseUrl: 'https://api.example.com',
    spec,
    logger: createMockLogger(),
    generateOptions,
  });
  const { tools } = await adapter.fetch();
  return (tools ?? [])
    .map((tool) => (tool as unknown as Record<symbol, { name: string } | undefined>)[FrontMcpToolTokens.metadata])
    .map((metadata) => metadata?.name ?? '')
    .sort();
}

describe('OpenapiAdapter generateOptions filters', () => {
  it('generates every operation when no filter is set', async () => {
    expect(await toolNames(undefined)).toEqual(
      ['createUser', 'deleteUser', 'getUser', 'listAuditEvents', 'listOrders', 'listUsers', 'replaceOrders'].sort(),
    );
  });

  it('includeTags keeps only operations carrying one of the tags', async () => {
    expect(await toolNames({ includeTags: ['orders'] })).toEqual(['listOrders', 'replaceOrders']);
  });

  it('excludeTags drops operations carrying any of the tags', async () => {
    expect(await toolNames({ excludeTags: ['admin'] })).toEqual(
      ['createUser', 'getUser', 'listOrders', 'listUsers', 'replaceOrders'].sort(),
    );
  });

  it('includeMethods keeps only those HTTP methods', async () => {
    expect(await toolNames({ includeMethods: ['get'] })).toEqual(
      ['getUser', 'listAuditEvents', 'listOrders', 'listUsers'].sort(),
    );
  });

  it('excludeMethods drops those HTTP methods', async () => {
    expect(await toolNames({ excludeMethods: ['delete', 'put', 'post'] })).toEqual(
      ['getUser', 'listAuditEvents', 'listOrders', 'listUsers'].sort(),
    );
  });

  it('includePaths keeps only paths matching a glob', async () => {
    expect(await toolNames({ includePaths: ['/users/*'] })).toEqual(['deleteUser', 'getUser']);
    expect(await toolNames({ includePaths: ['/admin/**', '/orders'] })).toEqual(
      ['listAuditEvents', 'listOrders', 'replaceOrders'].sort(),
    );
  });

  it('excludePaths drops paths matching a glob', async () => {
    expect(await toolNames({ excludePaths: ['/users/**', '/users', '/admin/**'] })).toEqual([
      'listOrders',
      'replaceOrders',
    ]);
  });

  it('readOnlyOnly keeps only read-only operations', async () => {
    expect(await toolNames({ readOnlyOnly: true })).toEqual(
      ['getUser', 'listAuditEvents', 'listOrders', 'listUsers'].sort(),
    );
  });

  it('combines filters with each other and with the operation-id filters', async () => {
    expect(await toolNames({ includeTags: ['users'], readOnlyOnly: true, excludeOperations: ['getUser'] })).toEqual([
      'listUsers',
    ]);
  });

  it('passes the options it does not filter on to the generator too (maxToolNameLength)', async () => {
    const names = await toolNames({ includeOperations: ['listAuditEvents'], maxToolNameLength: 8 });
    expect(names).toHaveLength(1);
    expect(names[0]?.length).toBeLessThanOrEqual(8);
  });
});
