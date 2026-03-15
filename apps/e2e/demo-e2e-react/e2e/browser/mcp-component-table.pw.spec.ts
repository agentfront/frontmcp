import { test, expect } from '@playwright/test';
import { gotoSection } from './helpers';

test.describe('MCP Component Table', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'mcp-table');
  });

  test('shows fallback initially', async ({ page }) => {
    const fallback = page.locator('[data-testid="table-fallback"]');
    await expect(fallback).toBeVisible({ timeout: 10_000 });
  });

  test('renders table with data after trigger', async ({ page }) => {
    const trigger = page.locator('[data-testid="table-trigger"]');

    // Wait for trigger to be visible (tool registered) instead of arbitrary timeout
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();

    const container = page.locator('[data-testid="table-container"]');
    const table = container.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Check headers
    const headers = table.locator('th');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toHaveText('Name');
    await expect(headers.nth(1)).toHaveText('Age');
    await expect(headers.nth(2)).toHaveText('Role');

    // Check rows
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('td').nth(0)).toHaveText('Alice');
    await expect(rows.nth(1).locator('td').nth(0)).toHaveText('Bob');
  });
});
