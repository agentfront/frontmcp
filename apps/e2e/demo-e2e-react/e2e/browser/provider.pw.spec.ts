import { expect, test } from '@playwright/test';

import { gotoSection } from './helpers';

test.describe('Provider Status', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'provider');
  });

  test('shows connected status', async ({ page }) => {
    const status = page.locator('[data-testid="status"]');
    await expect(status).toHaveText('connected', { timeout: 15_000 });
  });

  test('displays server name', async ({ page }) => {
    const serverName = page.locator('[data-testid="server-name"]');
    await expect(serverName).toHaveText('default');
  });

  test('reports tool count >= 2', async ({ page }) => {
    const toolCount = page.locator('[data-testid="tool-count"]');
    // The listing arrives once the client connects, after the section renders
    await expect.poll(async () => Number(await toolCount.textContent()), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test('reports resource count', async ({ page }) => {
    const resourceCount = page.locator('[data-testid="resource-count"]');
    await expect(resourceCount).toBeVisible();
  });
});
