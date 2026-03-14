import { test, expect } from '@playwright/test';
import { gotoSection } from './helpers';

test.describe('Dynamic Tool', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'dynamic-tool');
  });

  test('shows registered status', async ({ page }) => {
    const status = page.locator('[data-testid="dynamic-registered"]');
    await expect(status).toHaveText('registered', { timeout: 10_000 });
  });

  test('reverses text input', async ({ page }) => {
    await expect(page.locator('[data-testid="dynamic-registered"]')).toHaveText('registered', {
      timeout: 10_000,
    });

    const input = page.locator('[data-testid="reverse-input"]');
    const button = page.locator('[data-testid="reverse-button"]');
    const result = page.locator('[data-testid="reverse-result"]');

    await input.fill('hello');
    await button.click();
    await expect(result).toHaveText('olleh', { timeout: 10_000 });
  });
});
