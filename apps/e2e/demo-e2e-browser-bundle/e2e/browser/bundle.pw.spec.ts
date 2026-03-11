import { test, expect } from '@playwright/test';

test.describe('Browser bundle integration', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForSelector('[data-testid="summary"]');

    expect(errors).toEqual([]);
  });

  test('all checks pass', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="summary"]');

    const results = await page.evaluate(() => (window as unknown as Record<string, unknown>).__BUNDLE_RESULTS__);

    // Every check should pass
    for (const [name, result] of Object.entries(results as Record<string, { pass: boolean; value: string }>)) {
      expect(result.pass, `Check "${name}" failed: ${result.value}`).toBe(true);
    }
  });

  test('env utilities return browser defaults', async ({ page }) => {
    await page.goto('/');
    const results = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__BUNDLE_RESULTS__,
    )) as Record<string, { pass: boolean; value: string }>;

    expect(results['getCwd'].value).toBe('/');
    expect(results['isProduction'].value).toBe('false');
    expect(results['isDevelopment'].value).toBe('false');
    expect(results['isDebug'].value).toBe('false');
    expect(results['getEnv-default'].value).toBe('fb');
  });

  test('crypto works in browser', async ({ page }) => {
    await page.goto('/');
    const results = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__BUNDLE_RESULTS__,
    )) as Record<string, { pass: boolean; value: string }>;

    // UUID should match pattern
    expect(results['randomUUID'].value).toMatch(/^[0-9a-f-]{36}$/);
    // base64url roundtrip should work
    expect(results['base64url-roundtrip'].value).toBe('true');
  });

  test('decorators work in browser', async ({ page }) => {
    await page.goto('/');
    const results = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__BUNDLE_RESULTS__,
    )) as Record<string, { pass: boolean; value: string }>;

    expect(results['Tool-decorator'].value).toBe('true');
    expect(results['Resource-decorator'].value).toBe('true');
    expect(results['Prompt-decorator'].value).toBe('true');
    expect(results['FrontMcp-decorator'].value).toBe('true');
  });
});
