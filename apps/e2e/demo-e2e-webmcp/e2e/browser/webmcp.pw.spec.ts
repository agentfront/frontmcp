import { expect, test } from '@playwright/test';

import { executeWebMcpTool, hookCalls, openApp, webMcpToolNames, webMcpTools } from './helpers';

/**
 * A page that runs FrontMCP with the WebMCP plugin offers its tools to in-browser agents on
 * `document.modelContext`. Every agent call runs the server's `tools:call-tool` flow.
 */
test.describe('WebMCP', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("registers the tools the 'webmcp' surface offers, with the prefix", async ({ page }) => {
    await expect(page.locator('[data-testid="webmcp-supported"]')).toHaveText('supported');

    await expect
      .poll(() => webMcpToolNames(page))
      .toEqual(['shop.cart_add', 'shop.place_order', 'shop.search_products']);
  });

  test('describes tools with their title and WebMCP hints', async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.place_order');

    const tools = await webMcpTools(page);

    expect(tools.find((tool) => tool.name === 'shop.search_products')).toEqual({
      name: 'shop.search_products',
      title: 'Search products',
      annotations: { readOnlyHint: true },
    });
    expect(tools.find((tool) => tool.name === 'shop.place_order')?.annotations).toEqual({ consequentialHint: true });
  });

  test("runs an agent's call through the server's flow", async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.search_products');

    const result = await executeWebMcpTool(page, 'shop.search_products', { query: 'red' });

    expect(result).toEqual({ results: ['red shoes', 'red hat'] });
    expect(await hookCalls(page)).toEqual(['search_products']);
  });

  test("runs a component's tool, which updates the page", async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.cart_add');

    const result = await executeWebMcpTool(page, 'shop.cart_add', { product: 'green hat' });

    expect(result).toEqual({ content: [{ type: 'text', text: 'Added green hat' }] });
    await expect(page.locator('[data-testid="cart-items"] li')).toHaveText(['green hat']);
    expect(await hookCalls(page)).toEqual(['cart_add']);
  });

  test('rejects a call whose input the component schema refuses', async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.cart_add');

    await expect(executeWebMcpTool(page, 'shop.cart_add', { product: 5 })).rejects.toThrow(/validation_error/);
    await expect(page.locator('[data-testid="cart-items"] li')).toHaveCount(0);
  });

  test("removes a component's tool when it unmounts, and brings it back when it mounts", async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.cart_add');

    await page.locator('[data-testid="toggle-cart"]').click();
    await expect.poll(() => webMcpToolNames(page)).not.toContain('shop.cart_add');

    await page.locator('[data-testid="toggle-cart"]').click();
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.cart_add');
  });

  test('unregisters every tool when the server is disposed', async ({ page }) => {
    await expect.poll(() => webMcpToolNames(page)).toContain('shop.search_products');

    await page.locator('[data-testid="dispose-server"]').click();

    await expect(page.locator('[data-testid="server-status"]')).toHaveText('disposed');
    await expect.poll(() => webMcpToolNames(page)).toEqual([]);
  });
});

test.describe('without WebMCP', () => {
  test('the page and its server work as usual', async ({ page }) => {
    await openApp(page, { withWebMcp: false });

    await expect(page.locator('[data-testid="webmcp-supported"]')).toHaveText('unsupported');
    await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
    await expect(page.locator('[data-testid="server-status"]')).toHaveText('ready');
  });
});
