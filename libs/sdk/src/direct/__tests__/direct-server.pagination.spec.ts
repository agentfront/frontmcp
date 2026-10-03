/**
 * List pagination on the server `create()` returns (#678).
 *
 * `tools/list` pages at 40 tools by default. `DirectMcpServer.listTools()` returned the first page
 * and a `nextCursor`, with no way to pass the cursor back, so a server with more tools could not
 * list them all. The list methods now read every page, as `DirectClient` does, unless given a
 * `cursor`: then they return that one page and its `nextCursor`.
 */
import 'reflect-metadata';

import type { CallToolResult } from '@frontmcp/protocol';

import { Tool, ToolContext, type ToolType } from '../../common';
import { clearCreateCache, create } from '../create';
import type { DirectMcpServer } from '../direct.types';

function makeTools(count: number): ToolType[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `tool_${String(i).padStart(3, '0')}`;

    @Tool({ name, description: `Tool ${i}`, inputSchema: {} })
    class GeneratedTool extends ToolContext {
      async execute(): Promise<CallToolResult> {
        return { content: [{ type: 'text', text: name }] };
      }
    }

    return GeneratedTool;
  });
}

describe('DirectMcpServer list pagination', () => {
  let server: DirectMcpServer | undefined;

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
    clearCreateCache();
  });

  it('lists every tool when there are more than one page holds', async () => {
    server = await create({ info: { name: 'many-tools', version: '1.0.0' }, tools: makeTools(45) });

    const result = await server.listTools();

    expect(result.tools).toHaveLength(45);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns the page a cursor points at, with the cursor of the next one', async () => {
    server = await create({
      info: { name: 'paged-tools', version: '1.0.0' },
      tools: makeTools(5),
      pagination: { tools: { mode: true, pageSize: 2, autoThreshold: 1 } },
    });

    const all = await server.listTools();
    expect(all.tools.map((t) => t.name)).toEqual(['tool_000', 'tool_001', 'tool_002', 'tool_003', 'tool_004']);
    expect(all.nextCursor).toBeUndefined();

    const first = await server.listTools({ paginate: true });
    const pages: string[][] = [first.tools.map((t) => t.name)];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await server.listTools({ cursor });
      pages.push(page.tools.map((t) => t.name));
      cursor = page.nextCursor;
    }

    expect(pages).toEqual([['tool_000', 'tool_001'], ['tool_002', 'tool_003'], ['tool_004']]);
  });

  it('reads one page when asked to, even with a cursor and `paginate: false`', async () => {
    server = await create({
      info: { name: 'paged-explicit', version: '1.0.0' },
      tools: makeTools(3),
      pagination: { tools: { mode: true, pageSize: 2, autoThreshold: 1 } },
    });

    const first = await server.listTools({ paginate: true });
    expect(first.tools.map((t) => t.name)).toEqual(['tool_000', 'tool_001']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await server.listTools({ paginate: false, cursor: first.nextCursor });
    expect(second.tools.map((t) => t.name)).toEqual(['tool_002']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('keeps the auth context of the call on every page it reads', async () => {
    server = await create({
      info: { name: 'paged-auth', version: '1.0.0' },
      tools: makeTools(3),
      pagination: { tools: { mode: true, pageSize: 1, autoThreshold: 1 } },
    });

    const result = await server.listTools({ authContext: { sessionId: 'pager', user: { sub: 'u-1' } } });

    expect(result.tools.map((t) => t.name)).toEqual(['tool_000', 'tool_001', 'tool_002']);
  });

  it('accepts a cursor on the resource, resource-template and prompt lists', async () => {
    server = await create({ info: { name: 'list-cursors', version: '1.0.0' }, tools: makeTools(1) });

    await expect(server.listResources()).resolves.toMatchObject({ resources: [] });
    await expect(server.listResourceTemplates()).resolves.toMatchObject({ resourceTemplates: [] });
    await expect(server.listPrompts()).resolves.toMatchObject({ prompts: [] });
    await expect(server.listResources({ cursor: 'c' })).resolves.toMatchObject({ resources: [] });
    await expect(server.listResourceTemplates({ cursor: 'c' })).resolves.toMatchObject({ resourceTemplates: [] });
    await expect(server.listPrompts({ cursor: 'c' })).resolves.toMatchObject({ prompts: [] });
  });
});
