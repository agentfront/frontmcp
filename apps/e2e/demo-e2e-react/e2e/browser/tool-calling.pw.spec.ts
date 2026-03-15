import { test, expect } from '@playwright/test';
import { gotoSection } from './helpers';

test.describe('Tool Calling', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'tool-calling');
  });

  test('calls greet tool and shows result', async ({ page }) => {
    const input = page.locator('[data-testid="greet-input"]');
    const button = page.locator('[data-testid="greet-button"]');
    const result = page.locator('[data-testid="greet-result"]');

    await input.fill('World');
    await button.click();
    await expect(result).toHaveText('Hello, World!', { timeout: 10_000 });
  });

  test('calls greet tool with different input', async ({ page }) => {
    const input = page.locator('[data-testid="greet-input"]');
    const button = page.locator('[data-testid="greet-button"]');
    const result = page.locator('[data-testid="greet-result"]');

    await input.fill('Alice');
    await button.click();
    await expect(result).toHaveText('Hello, Alice!', { timeout: 10_000 });
  });
});
