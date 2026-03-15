import { test, expect } from '@playwright/test';

/**
 * Warmup test — navigates to the app root to trigger Vite's initial JS compilation.
 * Runs before all other tests via the 'setup' project dependency.
 */
test('warmup: app loads and connects', async ({ page }) => {
  await page.goto('/#provider');
  await page.waitForLoadState('domcontentloaded');
  const content = page.locator('[data-testid="section-content"]');
  await expect(content).toBeVisible({ timeout: 60_000 });
  const status = page.locator('[data-testid="status"]');
  await expect(status).toHaveText('connected', { timeout: 30_000 });
});
