import { expect, test } from '@playwright/test';

/**
 * Warmup test — loads the app once to trigger Vite's initial JS compilation.
 * Runs before all other tests via the 'setup' project dependency.
 */
test('warmup: app loads and its server is ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="server-status"]')).toHaveText('ready', { timeout: 60_000 });
});
