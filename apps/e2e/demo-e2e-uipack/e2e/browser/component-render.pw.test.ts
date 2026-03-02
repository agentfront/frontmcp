/**
 * Playwright: Component Rendering E2E Tests
 *
 * Validates the full rendering pipeline:
 *   renderComponent() -> HTML with import maps -> browser loads @frontmcp/ui
 *   from local esm.sh -> React mounts -> component renders
 *
 * Requires Docker (Verdaccio + esm.sh). Tests skip gracefully when Docker
 * is unavailable — controlled by SKIP_COMPONENT_RENDER_TESTS env var set
 * in global-setup.ts.
 */
import { test, expect } from '@playwright/test';
import { serveComponent, stopServer } from './helpers';

const SKIP = process.env['SKIP_COMPONENT_RENDER_TESTS'] === 'true';
const MOUNT_TIMEOUT = 60_000;

test.afterEach(async () => {
  await stopServer();
});

test.describe('Component Rendering', () => {
  test.skip(() => SKIP, 'Docker infrastructure not available');

  test('Card renders with title and children', async ({ page }) => {
    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Card', exportName: 'Card' },
      },
      {
        toolName: 'card-test',
        output: { title: 'Weather Report', children: 'Sunny with a high of 25C' },
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiCard-root') !== null, { timeout: MOUNT_TIMEOUT });

    const title = page.locator('.MuiCardHeader-title');
    await expect(title).toHaveText('Weather Report');

    const content = page.locator('.MuiCardContent-root');
    await expect(content).toContainText('Sunny with a high of 25C');
  });

  test('Alert renders with severity and title', async ({ page }) => {
    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Alert', exportName: 'Alert' },
      },
      {
        toolName: 'alert-test',
        output: { severity: 'warning', title: 'Rate Limit', children: 'You have 3 requests remaining' },
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiAlert-root') !== null, { timeout: MOUNT_TIMEOUT });

    const alert = page.locator('.MuiAlert-root');
    await expect(alert).toBeVisible();

    const alertTitle = page.locator('.MuiAlert-message .MuiAlertTitle-root');
    await expect(alertTitle).toHaveText('Rate Limit');

    await expect(alert).toContainText('You have 3 requests remaining');
  });

  test('Button renders with label', async ({ page }) => {
    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Button', exportName: 'Button' },
      },
      {
        toolName: 'button-test',
        output: { children: 'Submit', variant: 'primary' },
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiButton-root') !== null, { timeout: MOUNT_TIMEOUT });

    const button = page.locator('.MuiButton-root');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Submit');
  });

  test('data injection works with component', async ({ page }) => {
    const output = { title: 'Data Test', children: 'Injected content' };

    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Card', exportName: 'Card' },
      },
      {
        toolName: 'data-injection-tool',
        output,
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiCard-root') !== null, { timeout: MOUNT_TIMEOUT });

    // Verify window globals are set
    const toolName = await page.evaluate(() => (window as Record<string, unknown>).__mcpToolName);
    expect(toolName).toBe('data-injection-tool');

    const toolOutput = await page.evaluate(() => (window as Record<string, unknown>).__mcpToolOutput);
    expect(toolOutput).toEqual(output);

    // Verify component renders the output data as props
    const title = page.locator('.MuiCardHeader-title');
    await expect(title).toHaveText('Data Test');

    const content = page.locator('.MuiCardContent-root');
    await expect(content).toContainText('Injected content');
  });

  test('import map points to local esm.sh', async ({ page }) => {
    const { html } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Card', exportName: 'Card' },
      },
      {
        toolName: 'import-map-test',
        output: { children: 'test' },
      },
    );

    // Verify import map contains local esm.sh URLs
    const importMapMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
    expect(importMapMatch).toBeTruthy();

    const importMap = JSON.parse(importMapMatch![1]);
    expect(importMap.imports).toBeDefined();

    // Core dependencies should point to localhost:8088
    const imports = importMap.imports as Record<string, string>;
    for (const [specifier, url] of Object.entries(imports)) {
      expect(url).toContain('localhost:8088');
      expect(specifier).toBeTruthy();
    }
  });

  test('no JS errors during render', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Card', exportName: 'Card' },
      },
      {
        toolName: 'error-test',
        output: { title: 'Error Free', children: 'No errors here' },
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiCard-root') !== null, { timeout: MOUNT_TIMEOUT });

    // Allow a short settle time for any async errors
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('bridge coexists with component', async ({ page }) => {
    const { url } = await serveComponent(
      {
        source: { npm: '@frontmcp/ui/components/Card', exportName: 'Card' },
        includeBridge: true,
      },
      {
        toolName: 'bridge-test',
        output: { title: 'Bridge Test', children: 'With bridge' },
        includeBridge: true,
      },
    );

    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.MuiCard-root') !== null, { timeout: MOUNT_TIMEOUT });

    // Verify bridge initialized
    const bridgeInitialized = await page.evaluate(
      () =>
        (window as Record<string, unknown>).FrontMcpBridge != null &&
        ((window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown>).initialized === true,
    );
    expect(bridgeInitialized).toBe(true);

    // Verify component also renders
    const title = page.locator('.MuiCardHeader-title');
    await expect(title).toHaveText('Bridge Test');
  });
});
