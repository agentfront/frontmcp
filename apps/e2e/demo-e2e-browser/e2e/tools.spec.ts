import { test, expect } from '@playwright/test';

test.describe('Tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('greet tool via hooks page', async ({ page }) => {
    await page.goto('/hooks');

    // Find the greet section and fill in the name input
    const greetSection = page.locator('.section').filter({ hasText: 'useCallTool' }).first();
    const nameInput = greetSection.locator('input[type="text"]');
    await nameInput.fill('Playwright');

    const callButton = greetSection.locator('button').filter({ hasText: /call/i });
    await callButton.click();

    // Wait for result to appear
    await expect(greetSection.locator('pre')).toContainText('Playwright', { timeout: 10_000 });
  });

  test('greet tool via router page', async ({ page }) => {
    await page.goto('/mcp/tools/greet');

    // The ToolRoute renders a form for the tool
    const nameInput = page.locator('input').first();
    await nameInput.fill('E2E');

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Check for output containing the greeting
    await expect(page.locator('[data-testid="output-display"]')).toContainText('E2E', { timeout: 10_000 });
  });

  test('calculate tool via router page', async ({ page }) => {
    await page.goto('/mcp/tools/calculate');

    // Fill in operation, a, b
    // The form fields are generated from the Zod schema
    await page.waitForSelector('input, select', { timeout: 10_000 });

    // Check that the page loaded with a form
    const form = page.locator('form');
    await expect(form).toBeVisible();
  });
});
