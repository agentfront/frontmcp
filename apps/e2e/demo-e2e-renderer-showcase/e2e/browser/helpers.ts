import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Navigate to the showcase view for a specific renderer group and example.
 */
export async function navigateToRenderer(page: Page, groupId: string, exampleIndex = 0): Promise<void> {
  await page.goto(`/#/${groupId}?example=${exampleIndex}`);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Navigate directly to the render-only (iframe) view for isolated testing.
 */
export async function navigateToPreview(page: Page, groupId: string, exampleIndex = 0): Promise<void> {
  await page.goto(`/#/render/${groupId}/${exampleIndex}`);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Get the preview iframe from the showcase layout and return its frame.
 */
export async function getPreviewFrame(page: Page) {
  const iframe = page.locator('[data-testid="preview-iframe"]');
  await iframe.waitFor({ state: 'attached' });
  const frame = await iframe.contentFrame();
  return frame;
}

/** Navigate to render-only view, wait for the preview-content wrapper. */
export async function renderAndWaitForContent(
  page: Page,
  groupId: string,
  exampleIndex: number,
  timeout = 15_000,
): Promise<Locator> {
  await navigateToPreview(page, groupId, exampleIndex);
  const wrapper = page.locator('[data-testid="preview-content"]');
  await expect(wrapper).toBeVisible({ timeout });
  return wrapper;
}

/** Assert that no "Loading..." text remains — proves the library finished loading. */
export async function assertNotLoading(wrapper: Locator, timeout = 15_000): Promise<void> {
  await expect(wrapper.getByText(/^Loading\b/)).toHaveCount(0, { timeout });
}

/** Assert that no MUI error Alert is visible. */
export async function assertNoErrorAlert(wrapper: Locator): Promise<void> {
  await expect(wrapper.locator('.MuiAlert-standardError')).toHaveCount(0);
}
