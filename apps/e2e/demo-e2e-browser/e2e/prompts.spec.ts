import { test, expect } from '@playwright/test';

test.describe('Prompts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('get summarize prompt via hooks page', async ({ page }) => {
    await page.goto('/hooks');

    // Find the prompt section
    const promptSection = page.locator('.section').filter({ hasText: 'useGetPrompt' });
    const textInput = promptSection.locator('input[type="text"], textarea').first();
    await textInput.fill('This is a test paragraph to summarize.');

    const getButton = promptSection.locator('button').filter({ hasText: /get/i });
    await getButton.click();

    // Verify the response contains messages
    await expect(promptSection.locator('pre')).toContainText('messages', { timeout: 10_000 });
  });

  test('summarize prompt via router page', async ({ page }) => {
    await page.goto('/mcp/prompts/summarize');

    // The PromptRoute renders a form
    const textInput = page.locator('input, textarea').first();
    await textInput.fill('Testing prompt with Playwright');

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Check for output
    await expect(page.locator('[data-testid="output-display"]')).toContainText('summarize', {
      timeout: 10_000,
      ignoreCase: true,
    });
  });
});
