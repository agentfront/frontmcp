import { test, expect } from '@playwright/test';
import { renderAndWaitForContent, assertNotLoading, assertNoErrorAlert } from './helpers';

// ─── Charts (recharts) ──────────────────────────────────────────────────────

test.describe('Screenshot: Charts', () => {
  for (const [idx, name] of (['bar', 'line', 'area', 'pie'] as const).entries()) {
    test(`charts-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'charts', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('.recharts-wrapper')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500); // animation settle
      await expect(page).toHaveScreenshot(`charts-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── Mermaid ────────────────────────────────────────────────────────────────

test.describe('Screenshot: Mermaid', () => {
  for (const [idx, name] of (['flowchart', 'sequence', 'class', 'er'] as const).entries()) {
    test(`mermaid-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'mermaid', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('svg')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`mermaid-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── Flow (@xyflow/react) ───────────────────────────────────────────────────

test.describe('Screenshot: Flow', () => {
  for (const [idx, name] of (['pipeline', 'branching'] as const).entries()) {
    test(`flow-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'flow', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('.react-flow')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`flow-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── Math (KaTeX) ───────────────────────────────────────────────────────────

test.describe('Screenshot: Math', () => {
  for (const [idx, name] of (['display', 'inline', 'mixed'] as const).entries()) {
    test(`math-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'math', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('.katex').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`math-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── CSV ────────────────────────────────────────────────────────────────────

test.describe('Screenshot: CSV', () => {
  for (const [idx, name] of (['comma', 'tab'] as const).entries()) {
    test(`csv-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'csv', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('table, .MuiTable-root').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`csv-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── MDX ────────────────────────────────────────────────────────────────────

test.describe('Screenshot: MDX', () => {
  for (const [idx, name] of (['headings', 'code-blocks', 'tables'] as const).entries()) {
    test(`mdx-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'mdx', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('h1, h2, h3, pre, table').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`mdx-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});

// ─── HTML ───────────────────────────────────────────────────────────────────

test.describe('Screenshot: HTML', () => {
  for (const [idx, name] of (['styled-div', 'table'] as const).entries()) {
    test(`html-${name}`, async ({ page }) => {
      const w = await renderAndWaitForContent(page, 'html', idx);
      await assertNotLoading(w);
      await assertNoErrorAlert(w);
      await expect(w.locator('h2, table').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`html-${name}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});
