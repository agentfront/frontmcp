import { expect, test } from '@playwright/test';

import { gotoSection } from './helpers';

test.describe('Tool Listing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'tool-listing');
  });

  test('shows greet and add tools', async ({ page }) => {
    const greet = page.locator('[data-testid="tool-greet"]');
    const add = page.locator('[data-testid="tool-add"]');

    await expect(greet).toBeVisible({ timeout: 10_000 });
    await expect(add).toBeVisible();
  });

  test('reports tools count >= 2', async ({ page }) => {
    const count = page.locator('[data-testid="tools-count"]');
    await expect(count).toBeVisible();
    // The listing arrives once the client connects, after the section renders
    await expect.poll(async () => Number(await count.textContent()), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });
});
