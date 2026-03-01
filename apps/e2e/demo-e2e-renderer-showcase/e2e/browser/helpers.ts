import type { Page } from '@playwright/test';

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
