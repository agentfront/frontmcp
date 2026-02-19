import { test, expect } from '@playwright/test';

test.describe('Lifecycle Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('shows connected status', async ({ page }) => {
    await page.goto('/lifecycle');

    // The lifecycle page shows current status
    await expect(page.locator('.page')).toContainText('connected', { ignoreCase: true });
  });

  test('shows status history with transitions', async ({ page }) => {
    await page.goto('/lifecycle');

    // The timeline should have entries
    const timeline = page.locator('.timeline');
    await expect(timeline).toBeVisible({ timeout: 10_000 });

    const entries = timeline.locator('.timeline-entry');
    await expect(entries).not.toHaveCount(0);
  });
});
