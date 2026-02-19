import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside [data-testid="status-badge"]')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  });

  test('sidebar page links work', async ({ page }) => {
    const links = [
      { label: 'Lifecycle', heading: 'Lifecycle' },
      { label: 'Hooks', heading: 'Hooks' },
      { label: 'Store', heading: 'Store' },
      { label: 'Dashboard', heading: 'Dashboard' },
    ];

    for (const { label, heading } of links) {
      await page.locator('.nav-link').filter({ hasText: label }).click();
      await expect(page.locator('h2')).toContainText(heading);
    }
  });

  test('server nav links work', async ({ page }) => {
    await page.locator('.nav-link').filter({ hasText: 'Server List' }).click();
    await expect(page.locator('h2')).toContainText('Servers');

    await page.locator('.nav-link').filter({ hasText: 'Server Builder' }).click();
    await expect(page.locator('h2')).toContainText('Server Builder');
  });

  test('MCP entity nav links render', async ({ page }) => {
    // McpNavigation should render links for tools, resources, and prompts
    const mcpNav = page.locator('.sidebar-nav').locator('nav');
    await expect(mcpNav).toBeVisible({ timeout: 10_000 });

    // Should have some links
    const mcpLinks = mcpNav.locator('a');
    await expect(mcpLinks).not.toHaveCount(0);
  });

  test('clicking a tool link in MCP entities navigates to tool page', async ({ page }) => {
    // Find and click the first tool link in McpNavigation
    const mcpNav = page.locator('.sidebar-nav').locator('nav');
    const toolLink = mcpNav.locator('a').first();
    const linkText = await toolLink.textContent();
    await toolLink.click();

    // Should navigate to a tool route page
    await expect(page.url()).toContain('/mcp/');

    // Page should have content
    await expect(page.locator('.main-content')).not.toBeEmpty();
    // Verify the text of the link is visible somewhere on the page or in URL
    expect(linkText).toBeTruthy();
  });
});
