import { expect, type Page } from '@playwright/test';

/**
 * Navigate to a specific hash section and wait for DOM to load.
 */
export async function navigateTo(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Wait for the provider to reach "connected" status on the current page.
 * Works from any section by waiting for the section-content wrapper
 * (which only renders after the provider connects and server is ready).
 */
export async function waitForConnected(page: Page, timeout = 30_000): Promise<void> {
  const content = page.locator('[data-testid="section-content"]');
  await expect(content).toBeVisible({ timeout });
}

/**
 * Navigate to a section and wait for provider to be ready.
 */
export async function gotoSection(page: Page, hash: string, timeout = 30_000): Promise<void> {
  await navigateTo(page, hash);
  await waitForConnected(page, timeout);
}
