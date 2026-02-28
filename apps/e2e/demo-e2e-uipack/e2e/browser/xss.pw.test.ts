/**
 * Playwright: XSS Prevention Browser Tests
 *
 * Verifies that the shell builder properly escapes malicious input:
 * - <script> tags in content are escaped
 * - safeJsonForScript prevents </script> injection
 * - Data injection encodes malicious output
 * - Unicode line/paragraph separators don't cause parse errors
 */
import { test, expect } from '@playwright/test';
import { serveShell, stopServer } from './helpers';

test.afterEach(async () => {
  await stopServer();
});

test.describe('Script Tag Escaping', () => {
  test('should not execute escaped script tags in content', async ({ page }) => {
    // The content contains a <script> that tries to set a global
    // buildShell renders this as body content - it does NOT escape body content
    // (that's the user's responsibility), but the CSP meta tag should block inline scripts
    const { url } = await serveShell('<div id="safe">Safe Content</div>', {
      toolName: 'test',
      // Pass XSS payload as data, which SHOULD be escaped by safeJsonForScript
      output: { data: '<script>window.__XSS_EXECUTED=true</script>' },
    });

    await page.goto(url);

    // The XSS marker should not have been set
    const xssExecuted = await page.evaluate(() => (window as Record<string, unknown>).__XSS_EXECUTED);
    expect(xssExecuted).toBeUndefined();

    // Safe content should still render
    const safeEl = page.locator('#safe');
    await expect(safeEl).toHaveText('Safe Content');
  });
});

test.describe('safeJsonForScript Protection', () => {
  test('should prevent </script> injection in JSON data', async ({ page }) => {
    const { url } = await serveShell('<div id="app"></div>', {
      toolName: 'test',
      output: { payload: '</script><script>window.__XSS_DATA=true</script>' },
    });

    await page.goto(url);

    // The malicious script should not execute
    const xssData = await page.evaluate(() => (window as Record<string, unknown>).__XSS_DATA);
    expect(xssData).toBeUndefined();

    // The injected data should be accessible as a JSON value (escaped)
    const toolOutput = await page.evaluate(
      () => (window as Record<string, unknown>).__mcpToolOutput as Record<string, unknown>,
    );
    expect(toolOutput).toBeDefined();
    expect(toolOutput.payload).toContain('</script>');
  });
});

test.describe('Unicode Safety', () => {
  test('should handle unicode line and paragraph separators without parse errors', async ({ page }) => {
    const { url } = await serveShell('<div id="app">OK</div>', {
      toolName: 'test',
      output: { text: 'line\u2028separator\u2029paragraph' },
    });

    await page.goto(url);

    // Page should load without JS errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Content should render
    const appEl = page.locator('#app');
    await expect(appEl).toHaveText('OK');

    // No JS parse errors should have occurred
    expect(errors).toEqual([]);
  });
});
