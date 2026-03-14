import { test, expect } from '@playwright/test';
import { gotoSection } from './helpers';

test.describe('Store Adapter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'store');
  });

  test('shows increment tool as registered', async ({ page }) => {
    const status = page.locator('[data-testid="store-tool-registered"]');
    await expect(status).toHaveText('registered', { timeout: 10_000 });
  });

  test('reads initial state as count 0', async ({ page }) => {
    await expect(page.locator('[data-testid="store-tool-registered"]')).toHaveText('registered', {
      timeout: 10_000,
    });

    const readButton = page.locator('[data-testid="store-read"]');
    const storeValue = page.locator('[data-testid="store-value"]');

    await readButton.click();
    await expect(storeValue).toHaveText('{"count":0}', { timeout: 10_000 });
  });

  test('increments counter and reads updated state', async ({ page }) => {
    await expect(page.locator('[data-testid="store-tool-registered"]')).toHaveText('registered', {
      timeout: 10_000,
    });

    const incrementButton = page.locator('[data-testid="store-increment"]');
    const storeValue = page.locator('[data-testid="store-value"]');

    await incrementButton.click();
    await expect(storeValue).toHaveText('{"count":1}', { timeout: 10_000 });
  });
});
