import { test, expect } from '@playwright/test';
import { gotoSection } from './helpers';

test.describe('MCP Component', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'mcp-component');
  });

  test('shows fallback initially', async ({ page }) => {
    const fallback = page.locator('[data-testid="greeting-fallback"]');
    await expect(fallback).toBeVisible({ timeout: 10_000 });
  });

  test('renders greeting card after trigger', async ({ page }) => {
    const trigger = page.locator('[data-testid="greeting-trigger"]');
    const card = page.locator('[data-testid="greeting-card"]');

    // Wait for trigger to be visible (tool registered) instead of arbitrary timeout
    await trigger.waitFor({ state: 'visible' });

    await trigger.click();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('h3')).toHaveText('Welcome');
    await expect(card.locator('p')).toHaveText('Hello from MCP!');
  });
});
