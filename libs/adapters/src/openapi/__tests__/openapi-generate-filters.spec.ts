/**
 * `generateOptions` filters choose which operations become tools.
 *
 * In 1.8.7 the adapter passed `mcp-from-openapi` only the generate options it listed by name, so
 * `includeTags`, `excludeTags`, `includeMethods`, `excludeMethods`, `includePaths`, `excludePaths`
 * and `readOnlyOnly` (and every other option it didn't list) were accepted and ignored: every
 * operation became a tool.
 */
import { OpenAPIToolGenerator } from 'mcp-from-openapi';
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

describe('OpenapiAdapter options that 1.9.1 ignored (#767)', () => {
  const specWithAnonymousOperation: OpenAPIV3.Document = {
    ...spec,
    paths: { ...spec.paths, '/health': { get: { summary: 'Health check', responses: ok } } },
  };

  function adapterFor(options: Partial<OpenApiAdapterOptions>): OpenapiAdapter {
    return new OpenapiAdapter({
      name: 'shop',
      baseUrl: 'https://api.example.com',
      spec: specWithAnonymousOperation,
      logger: createMockLogger(),
      ...options,
    } as OpenApiAdapterOptions);
  }

  async function namesOf(adapter: OpenapiAdapter): Promise<string[]> {
    const { tools } = await adapter.fetch();
    return (tools ?? [])
      .map((tool) => (tool as unknown as Record<symbol, { name: string } | undefined>)[FrontMcpToolTokens.metadata])
      .map((metadata) => metadata?.name ?? '')
      .sort();
  }

  it('matches excludeMethods and includeMethods whatever their case', async () => {
    const excludeUpper = ['DELETE', 'Put', 'POST'] as unknown as NonNullable<
      OpenApiAdapterOptions['generateOptions']
    >['excludeMethods'];

    expect(await namesOf(adapterFor({ generateOptions: { excludeMethods: excludeUpper } }))).not.toContain(
      'deleteUser',
    );
    expect(
      await namesOf(adapterFor({ generateOptions: { includeMethods: ['DELETE'] as unknown as ['delete'] } })),
    ).toEqual(['deleteUser']);
  });

  it('refuses a method name that is not an HTTP method', () => {
    expect(() => adapterFor({ generateOptions: { excludeMethods: ['remove'] as unknown as ['delete'] } })).toThrow(
      /generateOptions.excludeMethods lists "remove", which is not an HTTP method/,
    );
  });

  it('includeOperations leaves out an operation that has no operationId', async () => {
    expect(await namesOf(adapterFor({ generateOptions: { includeOperations: ['listUsers'] } }))).toEqual(['listUsers']);
  });

  it('still applies filterFn together with includeOperations', async () => {
    const adapter = adapterFor({
      generateOptions: {
        includeOperations: ['listUsers', 'getUser'],
        filterFn: (operation) => operation.method === 'get' && operation.path === '/users',
      },
    });

    expect(await namesOf(adapter)).toEqual(['listUsers']);
  });

  it('applies loadOptions.overlays', async () => {
    const adapter = adapterFor({
      descriptionMode: 'full',
      generateOptions: { includeOperations: ['listUsers'] },
      loadOptions: {
        overlays: {
          overlay: '1.0.0',
          actions: [{ target: "$.paths['/users'].get", update: { description: 'Lists every customer account' } }],
        },
      },
    });
    const { tools } = await adapter.fetch();
    const metadata = (tools?.[0] as unknown as Record<symbol, { description?: string } | undefined>)[
      FrontMcpToolTokens.metadata
    ];

    expect(metadata?.description).toContain('Lists every customer account');
  });

  it('passes loadOptions.secureDefaults to the generator', async () => {
    const fromJSON = jest.spyOn(OpenAPIToolGenerator, 'fromJSON');
    try {
      await adapterFor({ loadOptions: { secureDefaults: true } }).fetch();
      expect(fromJSON).toHaveBeenCalledWith(
        specWithAnonymousOperation,
        expect.objectContaining({ secureDefaults: true }),
      );
    } finally {
      fromJSON.mockRestore();
    }
  });
});
