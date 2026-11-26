/** E2E tests for @frontmcp/plugin-result-handles: fold before the budget, query slices, session binding, TTL. */
import { expect, test } from '@frontmcp/testing';

const TTL_SECONDS = 4;

interface FoldedAnswer {
  preview: { orders: Array<{ id: number }>; total: number };
  shape: { type: string; keys: Record<string, { type: string; length?: number }> };
  handle: string;
}

test.describe('Result handles E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-answer-shaping/src/main.ts',
    project: 'demo-e2e-answer-shaping',
    publicMode: true,
  });

  test('folds a large answer into a preview, a shape and a handle, before the budget', async ({ mcp }) => {
    const result = await mcp.tools.call('export-orders', { count: 500 });
    expect(result).toBeSuccessful();

    const folded = result.raw.structuredContent as unknown as FoldedAnswer;
    expect(folded.preview.orders.map((order) => order.id)).toEqual([0, 1, 2]);
    expect(folded.preview.total).toBe(500);
    expect(folded.shape.keys['orders']).toMatchObject({ type: 'array', length: 500 });
    expect(folded.handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(result.raw._meta?.['frontmcp/result-handle']).toMatchObject({
      handle: folded.handle,
      ttlSeconds: TTL_SECONDS,
    });
    expect(result.raw._meta?.['frontmcp/budget']).toBeUndefined();
  });

  test('result_query reads slices of the folded answer', async ({ mcp }) => {
    const folded = await mcp.tools.call('export-orders', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;

    const range = await mcp.tools.call('result_query', {
      handle,
      path: 'orders',
      offset: 100,
      limit: 5,
      fields: ['id', 'status'],
    });
    expect(range.raw.structuredContent).toEqual({
      path: 'orders',
      value: [100, 101, 102, 103, 104].map((id) => ({ id, status: id % 2 === 0 ? 'open' : 'shipped' })),
      total: 500,
      offset: 100,
      nextOffset: 105,
    });

    const lastPage = await mcp.tools.call('result_query', { handle, path: '/orders', page: 50, limit: 10 });
    expect(lastPage.raw.structuredContent).toMatchObject({ offset: 490, total: 500 });
    expect(lastPage.raw.structuredContent?.['nextOffset']).toBeUndefined();

    const note = await mcp.tools.call('result_query', { handle, path: '$.orders[7].note', limit: 12 });
    expect(note.raw.structuredContent).toMatchObject({ value: 'Order 7 note' });
  });

  test("the one listed result_query reads the handles of another app's copy of the plugin", async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools.filter((tool) => tool.name === 'result_query')).toHaveLength(1);

    const folded = await mcp.tools.call('export-archive', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;
    const slice = await mcp.tools.call('result_query', { handle, path: '/orders/250/id' });
    expect(slice.raw.structuredContent).toEqual({ path: '/orders/250/id', value: 250 });
  });

  test('another session gets "not found", never the data', async ({ mcp, server }) => {
    const folded = await mcp.tools.call('export-orders', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;

    const other = await server.createClient();
    try {
      const result = await other.tools.call('result_query', { handle, path: 'orders', limit: 1 });
      expect(result.isError).toBe(true);
      expect(result.raw._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
      expect(JSON.stringify(result.raw)).not.toContain('Order 0 note');
      expect(JSON.stringify(result.raw)).not.toContain(handle);
    } finally {
      await other.disconnect();
    }
  });

  test('the handle expires after its TTL', async ({ mcp }) => {
    const folded = await mcp.tools.call('export-orders', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;

    await new Promise((resolve) => setTimeout(resolve, (TTL_SECONDS + 1) * 1000));

    const result = await mcp.tools.call('result_query', { handle, path: 'total' });
    expect(result.isError).toBe(true);
    expect(result.raw._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
  });

  test('result_query filters, sorts, searches and counts a folded answer', async ({ mcp }) => {
    const folded = await mcp.tools.call('export-orders', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;

    const shipped = await mcp.tools.call('result_query', {
      handle,
      path: 'orders',
      where: [
        { field: 'status', op: 'eq', value: 'shipped' },
        { field: 'id', op: 'lt', value: 20 },
      ],
      sort: [{ field: 'id', order: 'desc' }],
      limit: 3,
      fields: ['id'],
    });
    expect(shipped.raw.structuredContent).toEqual({
      path: 'orders',
      value: [{ id: 19 }, { id: 17 }, { id: 15 }],
      total: 10,
      offset: 0,
      nextOffset: 3,
    });

    const counted = await mcp.tools.call('result_query', {
      handle,
      path: 'orders',
      grep: { pattern: '^Order 4\\d note', regex: true, field: 'note' },
      count: true,
    });
    expect(counted.raw.structuredContent).toEqual({ path: 'orders', value: 10 });
  });

  test('folds a large resource read on an app with resources on, and result_query reads it', async ({ mcp }) => {
    const read = await mcp.resources.read('results://orders');
    const [content, note] = read.raw.contents as Array<{ uri: string; mimeType?: string; text: string }>;
    const folded = JSON.parse(content.text) as FoldedAnswer;

    expect(content.mimeType).toBe('application/json');
    expect(folded.shape.keys['orders']).toMatchObject({ type: 'array', length: 500 });
    expect(note).toMatchObject({ uri: 'results://orders', mimeType: 'text/plain' });
    expect(note.text).toContain(`handle "${folded.handle}"`);
    expect(read.raw._meta?.['frontmcp/result-handle']).toMatchObject({
      handle: folded.handle,
      ttlSeconds: TTL_SECONDS,
    });

    const open = await mcp.tools.call('result_query', {
      handle: folded.handle,
      path: 'orders',
      where: [{ field: 'status', op: 'eq', value: 'open' }],
      count: true,
    });
    expect(open.raw.structuredContent).toEqual({ path: 'orders', value: 250 });
  });

  test('a resource handle answers another session "not found"', async ({ mcp, server }) => {
    const read = await mcp.resources.read('results://orders');
    const { handle } = JSON.parse((read.raw.contents as Array<{ text: string }>)[0].text) as FoldedAnswer;

    const other = await server.createClient();
    try {
      const result = await other.tools.call('result_query', { handle, path: 'orders', limit: 1 });
      expect(result.raw._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
      expect(JSON.stringify(result.raw)).not.toContain('Order 0 note');
    } finally {
      await other.disconnect();
    }
  });

  test('with slidingTtl, each read keeps the handle for another TTL', async ({ mcp }) => {
    const folded = await mcp.tools.call('export-archive', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;
    const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    for (let read = 0; read < 2; read++) {
      await wait(TTL_SECONDS - 1.5);
      const slice = await mcp.tools.call('result_query', { handle, path: 'total' });
      expect(slice.raw.structuredContent).toEqual({ path: 'total', value: 500 });
    }
    await wait(TTL_SECONDS + 1);
    const expired = await mcp.tools.call('result_query', { handle, path: 'total' });
    expect(expired.raw._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
  });

  test('a tool whose output schema cannot admit the folded form is left to the budget', async ({ mcp }) => {
    const result = await mcp.tools.call('strict-orders', { count: 500 });
    expect(result).toBeSuccessful();

    const answer = result.raw.structuredContent as { orders: Array<{ id: number }>; total: number };
    expect(answer.total).toBe(500);
    expect(answer.orders[answer.orders.length - 1].id).toBe(499);
    expect(result.raw._meta?.['frontmcp/result-handle']).toBeUndefined();
    expect(result.raw._meta?.['frontmcp/budget']).toBeDefined();
  });
});
