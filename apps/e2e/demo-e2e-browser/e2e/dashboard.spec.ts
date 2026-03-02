import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('shows the page title', async ({ page }) => {
    await expect(page.locator('h2')).toHaveText('Dashboard');
  });

  test('displays stat cards with non-zero counts', async ({ page }) => {
    const toolsStat = page.locator('[data-testid="stat-tools"] .stat-value');
    await expect(toolsStat).not.toHaveText('0');

    const resourcesStat = page.locator('[data-testid="stat-resources"] .stat-value');
    await expect(resourcesStat).not.toHaveText('0');

    const promptsStat = page.locator('[data-testid="stat-prompts"] .stat-value');
    await expect(promptsStat).not.toHaveText('0');
  });

  test('shows connected status badge', async ({ page }) => {
    const badge = page.locator('aside [data-testid="status-badge"]');
    await expect(badge).toContainText('Connected');
    await expect(badge).toHaveAttribute('data-status', 'connected');
  });

  test('displays feature cards', async ({ page }) => {
    const featureCards = page.locator('.feature-card');
    await expect(featureCards).not.toHaveCount(0);
  });
});
