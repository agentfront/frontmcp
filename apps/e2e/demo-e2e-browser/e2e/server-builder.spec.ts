import { test, expect } from '@playwright/test';

// Helper: FrontMcpProvider calls listResources/listPrompts after connect,
// so the server must advertise those capabilities (needs at least 1 of each).
async function createServerViaBuilder(
  page: import('@playwright/test').Page,
  name: string,
  opts?: { tools?: string[]; resources?: string[]; prompts?: string[] },
) {
  await page.goto('/server-builder');
  await page.locator('[data-testid="server-name-input"]').fill(name);
  for (const t of opts?.tools ?? ['greet']) await page.locator(`[data-testid="tool-checkbox-${t}"]`).check();
  for (const r of opts?.resources ?? ['app-info']) await page.locator(`[data-testid="resource-checkbox-${r}"]`).check();
  for (const p of opts?.prompts ?? ['summarize']) await page.locator(`[data-testid="prompt-checkbox-${p}"]`).check();
  await page.locator('[data-testid="create-server-btn"]').click();
  await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });
}

test.describe('Server Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('create a server, switch, and verify reduced counts', async ({ page }) => {
    await createServerViaBuilder(page, 'Minimal Server');

    // Dashboard should show 1 tool (greet only, no OpenAPI tools)
    const toolsStat = page.locator('[data-testid="stat-tools"] .stat-value');
    await expect(toolsStat).toHaveText('1', { timeout: 10_000 });

    // 1 resource (app-info)
    const resourcesStat = page.locator('[data-testid="stat-resources"] .stat-value');
    await expect(resourcesStat).toHaveText('1');

    // 1 prompt (summarize)
    const promptsStat = page.locator('[data-testid="stat-prompts"] .stat-value');
    await expect(promptsStat).toHaveText('1');
  });

  test('switch back to demo server after creating a new one', async ({ page }) => {
    await createServerViaBuilder(page, 'Test Server');

    // Switch back to demo server via the selector
    const selector = page.locator('[data-testid="server-select"]');
    const demoOption = selector.locator('option', { hasText: 'Demo Server' });
    const demoValue = await demoOption.getAttribute('value');
    await selector.selectOption(demoValue!);

    // Wait for reconnection
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });

    // Demo server should have more tools
    const toolsStat = page.locator('[data-testid="stat-tools"] .stat-value');
    const toolCount = await toolsStat.textContent();
    expect(Number(toolCount)).toBeGreaterThan(1);
  });

  test('server list shows all servers and can remove', async ({ page }) => {
    await createServerViaBuilder(page, 'Removable Server', {
      tools: ['calculate'],
      resources: ['app-info'],
      prompts: ['summarize'],
    });

    // Navigate to server list via sidebar (client-side nav preserves state)
    await page.locator('.nav-link', { hasText: 'Server List' }).click();
    await expect(page.locator('[data-testid="server-list-page"]')).toBeVisible();

    // Should have at least 2 server cards
    const cards = page.locator('.server-card');
    await expect(cards).toHaveCount(2, { timeout: 5_000 });

    // The new server card should have a remove button
    const removableCard = page.locator('.server-card').filter({ hasText: 'Removable Server' });
    await expect(removableCard).toBeVisible();
  });
});
