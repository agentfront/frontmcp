/**
 * Playwright: Shell Builder Browser Tests
 *
 * Renders buildShell() output in a real Chromium browser and verifies:
 * - DOM structure (title, #app, CSP meta)
 * - CSP meta tag directives
 * - Data injection globals (window.__mcpToolName, etc.)
 * - Bridge exclusion
 * - Shell-less mode
 */
import { test, expect } from '@playwright/test';
import { serveShell, serveHtml, stopServer } from './helpers';

test.afterEach(async () => {
  await stopServer();
});

test.describe('Shell DOM Structure', () => {
  test('should render full HTML document with correct title', async ({ page }) => {
    const { url } = await serveShell('<div id="app">Content</div>', {
      title: 'Test Widget',
    });

    await page.goto(url);
    expect(await page.title()).toBe('Test Widget');
    const appEl = page.locator('#app');
    await expect(appEl).toHaveText('Content');
  });

  test('should have CSP meta tag present', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {});

    await page.goto(url);
    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(cspMeta).toHaveCount(1);
    const content = await cspMeta.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toContain('default-src');
  });

  test('should contain CSP directives with expected values', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      csp: { resourceDomains: ['https://cdn.example.com'] },
    });

    await page.goto(url);
    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    const content = await cspMeta.getAttribute('content');
    expect(content).toContain('https://cdn.example.com');
  });
});

test.describe('Data Injection', () => {
  test('should inject tool name, input, and output as window globals', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      toolName: 'chart-tool',
      input: { query: 'temperature' },
      output: { value: 42 },
    });

    await page.goto(url);

    const toolName = await page.evaluate(() => (window as Record<string, unknown>).__mcpToolName);
    expect(toolName).toBe('chart-tool');

    const toolInput = await page.evaluate(() => (window as Record<string, unknown>).__mcpToolInput);
    expect(toolInput).toEqual({ query: 'temperature' });

    const toolOutput = await page.evaluate(() => (window as Record<string, unknown>).__mcpToolOutput);
    expect(toolOutput).toEqual({ value: 42 });
  });
});

test.describe('Bridge Inclusion', () => {
  test('should not have bridge when disabled', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      includeBridge: false,
    });

    await page.goto(url);
    const bridge = await page.evaluate(() => (window as Record<string, unknown>).FrontMcpBridge);
    expect(bridge).toBeUndefined();
  });
});

test.describe('Shell-less Mode', () => {
  test('should serve content without HTML wrapper', async ({ page }) => {
    const { buildShell } = await import('@frontmcp/uipack');
    const result = buildShell('<div id="inline">Inline Content</div>', {
      toolName: 'test',
      withShell: false,
    });

    // Shell-less HTML won't have <html> wrapper, browser will add one
    const url = await serveHtml(result.html);
    await page.goto(url);

    // The raw HTML should not contain <!DOCTYPE html> from buildShell
    expect(result.html).not.toContain('<!DOCTYPE html>');

    // But the content should still render
    const inlineEl = page.locator('#inline');
    await expect(inlineEl).toHaveText('Inline Content');
  });
});
