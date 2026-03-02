import { test, expect } from '@playwright/test';

test.describe('Resources', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('read app://info resource via hooks page', async ({ page }) => {
    await page.goto('/hooks');

    // Find the resource section
    const resourceSection = page.locator('.section').filter({ hasText: 'useReadResource' });
    const uriInput = resourceSection.locator('input[type="text"]');
    await uriInput.fill('app://info');

    const readButton = resourceSection.locator('button').filter({ hasText: /read/i });
    await readButton.click();

    // Verify the response contains expected JSON fields
    await expect(resourceSection.locator('pre')).toContainText('FrontMCP Browser Demo', { timeout: 10_000 });
  });

  test('read resource via router page', async ({ page }) => {
    await page.goto('/mcp/resources/app://info');

    // The ResourceRoute auto-reads and displays resource content
    await expect(page.locator('[data-testid="resource-viewer"]')).toContainText('FrontMCP', { timeout: 10_000 });
  });
});
