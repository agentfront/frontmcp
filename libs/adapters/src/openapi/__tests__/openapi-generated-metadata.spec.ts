/**
 * What mcp-from-openapi derives for a tool reaches `tools/list` (#722): the inferred annotations,
 * the title from the operation summary, `_meta` (with `emitMeta`) and the spec's icons. Up to 1.9.1
 * the adapter built the tool from its name, description and schemas only.
 */
import 'reflect-metadata';

import type { OpenAPIV3 } from 'openapi-types';

import { App, FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';
import type { OpenApiAdapterOptions } from '../openapi.types';

const ICON = { src: 'https://example.com/tickets.png', mimeType: 'image/png' };

const spec = {
  openapi: '3.0.0',
  info: { title: 'Desk', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets',
        summary: 'List tickets',
        'x-frontmcp': { icons: [ICON] },
        responses: { '200': { description: 'ok' } },
      },
    },
    '/tickets/{id}': {
      delete: {
        operationId: 'deleteTicket',
        summary: 'Delete a ticket',
        'x-frontmcp': { annotations: { idempotentHint: false } },
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
  },
} as unknown as OpenAPIV3.Document;

let adapterCount = 0;

type ListedTool = Awaited<ReturnType<DirectMcpServer['listTools']>>['tools'][number];

async function listTools(extra: Partial<OpenApiAdapterOptions> = {}): Promise<Map<string, ListedTool>> {
  @App({
    id: 'desk',
    name: 'Desk',
    adapters: [
      OpenapiAdapter.init({ name: `desk-${++adapterCount}`, baseUrl: 'https://api.example.com', spec, ...extra }),
    ],
  })
  class DeskApp {}

  const server = await FrontMcpInstance.createDirect({
    info: { name: 'openapi-generated-metadata', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  });
  try {
    const { tools } = await server.listTools();
    return new Map(tools.map((listed) => [listed.name, listed]));
  } finally {
    await server.dispose();
  }
}

describe('OpenAPI tools carry what the generator derives (#722)', () => {
  it('lists the annotations inferred from the HTTP method', async () => {
    const tools = await listTools();

    expect(tools.get('listTickets')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.get('deleteTicket')?.annotations).toMatchObject({ destructiveHint: true });
  });

  it('lists the operation summary as the title', async () => {
    const tools = await listTools();

    expect(tools.get('listTickets')?.title).toBe('List tickets');
  });

  it('keeps x-frontmcp annotations over the inferred ones', async () => {
    const tools = await listTools();

    expect(tools.get('deleteTicket')?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
  });

  it('keeps toolTransforms annotations over the generated ones', async () => {
    const tools = await listTools({
      toolTransforms: { perTool: { listTickets: { annotations: { readOnlyHint: false } } } },
    });

    expect(tools.get('listTickets')?.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('lists no inferred annotations with inferAnnotations: false', async () => {
    const tools = await listTools({ generateOptions: { inferAnnotations: false } });

    expect(tools.get('listTickets')?.annotations?.readOnlyHint).toBeUndefined();
  });

  it('lists the generator _meta with emitMeta: true', async () => {
    const tools = await listTools({ generateOptions: { emitMeta: true } });

    expect(tools.get('listTickets')?._meta).toHaveProperty(['dev.agentfront.openapi/operation']);
  });

  it('lists no generator _meta by default', async () => {
    const tools = await listTools();

    expect(tools.get('listTickets')?._meta?.['dev.agentfront.openapi/operation']).toBeUndefined();
  });

  it('lists the icons the spec declares', async () => {
    const tools = await listTools();

    expect(tools.get('listTickets')?.icons).toEqual([ICON]);
  });
});
