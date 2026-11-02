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

  test('another session gets "not found", never the data', async ({ mcp, server }) => {
    const folded = await mcp.tools.call('export-orders', { count: 500 });
    const { handle } = folded.raw.structuredContent as unknown as FoldedAnswer;

    const other = await server.createClient();
    try {
      const result = await other.tools.call('result_query', { handle, path: 'orders', limit: 1 });
      expect(result.isError).toBe(true);
      expect(result.raw._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
      expect(JSON.stringify(result.raw)).not.toContain('Order 0 note');
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
