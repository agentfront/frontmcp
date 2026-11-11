import { expect, test } from '@playwright/test';

import { gotoSection } from './helpers';

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await gotoSection(page, 'events');
  });

  test('subscribes by push in the page, and receives what the page publishes', async ({ page }) => {
    await expect(page.locator('[data-testid="events-status"]')).toHaveText('active (push)', { timeout: 10_000 });

    await page.locator('[data-testid="events-publish-button"]').click();
    await page.locator('[data-testid="events-dom-button"]').click();

    await expect(page.locator('[data-testid="events-notes"] li')).toHaveText(['from the hook', 'from a click'], {
      timeout: 10_000,
    });
  });
});
