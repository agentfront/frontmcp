import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

interface ListedTool {
  name: string;
  title?: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>>; required?: string[] };
}

const searchToolMetadata = {
  name: 'search',
  title: 'Search tickets',
  inputSchema: {
    query: z.string(),
    limit: z.number().default(10),
    page: z.number().optional().default(1),
  },
};

@Tool(searchToolMetadata)
class SearchTool extends ToolContext {
  async execute(input: { query: string; limit: number; page: number }) {
    return input;
  }
}

@Tool({
  name: 'tag',
  inputSchema: {
    ticketId: z.string(),
    tags: z
      .string()
      .describe('Comma-separated tags')
      .transform((value) => value.split(',')),
  },
})
class TagTool extends ToolContext {
  async execute(input: { ticketId: string; tags: string[] }) {
    return input;
  }
}

@App({ id: 'desk', name: 'Desk', tools: [SearchTool, TagTool] })
class DeskApp {}

describe('tools/list input schema', () => {
  let server: TestFetchServer;
  let listedTools: Map<string, ListedTool>;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'tools-list-schema', version: '1.0.0' }, apps: [DeskApp] });
    const { message } = await rpc20260728(server.handler, 'tools/list');
    const tools = (message.result?.['tools'] as ListedTool[] | undefined) ?? [];
    listedTools = new Map(tools.map((tool) => [tool.name, tool]));
  });

  it('does not list fields that have a default as required', () => {
    expect(listedTools.get('search')?.inputSchema.required).toEqual(['query']);
  });

  it('describes a transformed field by its input type', () => {
    expect(listedTools.get('tag')?.inputSchema).toMatchObject({
      properties: { tags: { type: 'string', description: 'Comma-separated tags' } },
      required: expect.arrayContaining(['ticketId', 'tags']),
    });
  });

  it('lists the declared tool title', () => {
    expect(listedTools.get('search')?.title).toBe('Search tickets');
  });
});
