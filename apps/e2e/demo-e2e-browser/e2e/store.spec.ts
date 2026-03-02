import { test, expect } from '@playwright/test';

test.describe('Store Plugin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('counter increment and decrement', async ({ page }) => {
    await page.goto('/store');

    // Wait for counter section to load
    const counterSection = page.locator('.section').filter({ hasText: 'Counter Store' });
    await expect(counterSection).toBeVisible();

    // Get initial count
    const countDisplay = counterSection.locator('span').filter({ hasText: /^\d+$/ }).first();
    await expect(countDisplay).toBeVisible({ timeout: 10_000 });

    // Click increment
    const incrementBtn = counterSection.locator('button.primary').filter({ hasText: '+' });
    await incrementBtn.click();

    // Verify count changed
    await expect(countDisplay).toHaveText('1', { timeout: 5_000 });

    // Click increment again
    await incrementBtn.click();
    await expect(countDisplay).toHaveText('2', { timeout: 5_000 });

    // Click decrement
    const decrementBtn = counterSection.locator('button.primary').filter({ hasText: '-' });
    await decrementBtn.click();
    await expect(countDisplay).toHaveText('1', { timeout: 5_000 });

    // Reset
    const resetBtn = counterSection.locator('button').filter({ hasText: 'Reset' });
    await resetBtn.click();
    await expect(countDisplay).toHaveText('0', { timeout: 5_000 });
  });

  test('todo list toggles', async ({ page }) => {
    await page.goto('/store');

    const todoSection = page.locator('.section').filter({ hasText: 'Todo Store' });
    await expect(todoSection).toBeVisible();

    // Verify todos are displayed
    const todoItems = todoSection.locator('li');
    await expect(todoItems).not.toHaveCount(0, { timeout: 10_000 });

    // Click a todo item to toggle it
    const firstTodo = todoItems.first();
    await firstTodo.click();

    // The full state JSON should update
    await expect(todoSection.locator('pre')).toContainText('done', { timeout: 5_000 });
  });
});
