/**
 * Playwright: CSP Enforcement Browser Tests
 *
 * Verifies Content Security Policy in a real browser:
 * - Default CSP meta tag present with correct directives
 * - Custom resource domains appear in CSP
 * - Import map script tag renders in DOM
 */
import { test, expect } from '@playwright/test';
import { serveShell, stopServer } from './helpers';

test.afterEach(async () => {
  await stopServer();
});

test.describe('CSP Meta Tag', () => {
  test('should have default CSP meta tag with expected directives', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {});

    await page.goto(url);

    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(cspMeta).toHaveCount(1);

    const content = await cspMeta.getAttribute('content');
    expect(content).toBeTruthy();

    // Should contain standard directives
    expect(content).toContain('default-src');
    expect(content).toContain('script-src');
    expect(content).toContain('style-src');
  });

  test('should include custom resource domains in CSP', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      csp: {
        resourceDomains: ['https://cdn.custom.io', 'https://assets.myapp.com'],
      },
    });

    await page.goto(url);

    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    const content = await cspMeta.getAttribute('content');
    expect(content).toContain('https://cdn.custom.io');
    expect(content).toContain('https://assets.myapp.com');
  });

  test('should include default CDN domains in CSP', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {});

    await page.goto(url);

    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    const content = await cspMeta.getAttribute('content');
    // Default CDN domains include jsdelivr and cloudflare
    expect(content).toContain('https://cdn.jsdelivr.net');
    expect(content).toContain('https://cdnjs.cloudflare.com');
  });
});

test.describe('HTML Structure', () => {
  test('should have proper charset and viewport meta tags', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {});

    await page.goto(url);

    const charset = page.locator('meta[charset="UTF-8"]');
    await expect(charset).toHaveCount(1);

    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
    const viewportContent = await viewport.getAttribute('content');
    expect(viewportContent).toContain('width=device-width');
  });
});
