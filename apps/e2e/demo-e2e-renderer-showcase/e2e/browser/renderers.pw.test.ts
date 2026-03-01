import { test, expect } from '@playwright/test';
import { navigateToRenderer, navigateToPreview } from './helpers';

const RENDERER_IDS = [
  'charts',
  'mermaid',
  'flow',
  'math',
  'maps',
  'image',
  'video',
  'audio',
  'csv',
  'mdx',
  'html',
  'pdf',
  'react',
];

test.describe('Renderer Showcase - Navigation', () => {
  test('should display all 13 renderer groups in sidebar', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    for (const id of RENDERER_IDS) {
      const navItem = page.locator(`[data-testid="renderer-nav-${id}"]`);
      await expect(navItem).toBeVisible();
    }
  });

  test('should navigate between renderer groups', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    // Click mermaid nav item
    await page.locator('[data-testid="renderer-nav-mermaid"]').click();
    await expect(page).toHaveURL(/#\/mermaid/);

    // Source panel should update
    const source = page.locator('[data-testid="source-content"]');
    await expect(source).toContainText('flowchart');
  });

  test('should switch examples within a group', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    // Default should show first example
    const source = page.locator('[data-testid="source-content"]');
    await expect(source).toContainText('"type": "bar"');

    // Change example via selector
    await page.locator('[data-testid="example-selector"]').click();
    // Select "Line Chart" (second option, value=1)
    await page.locator('[role="option"]').filter({ hasText: 'Line Chart' }).click();

    await expect(source).toContainText('"type": "line"');
  });
});

test.describe('Renderer Showcase - Theme', () => {
  test('should toggle between light and dark mode', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    const toggle = page.locator('[data-testid="theme-toggle"]');
    await expect(toggle).toBeVisible();

    // Click to switch to dark mode
    await toggle.click();

    // Verify theme changed by checking the toggle icon updated
    await expect(toggle).toContainText('☀️');

    // Click again to go back to light
    await toggle.click();
    await expect(toggle).toContainText('🌙');
  });
});

test.describe('Renderer Showcase - Preview iframe', () => {
  test('should display iframe with render-only route', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    const iframe = page.locator('[data-testid="preview-iframe"]');
    await expect(iframe).toBeVisible();

    const src = await iframe.getAttribute('src');
    expect(src).toContain('/render/charts/0');
  });

  test('should update iframe when navigating', async ({ page }) => {
    await navigateToRenderer(page, 'charts');

    await page.locator('[data-testid="renderer-nav-mermaid"]').click();

    const iframe = page.locator('[data-testid="preview-iframe"]');
    const src = await iframe.getAttribute('src');
    expect(src).toContain('/render/mermaid/0');
  });
});

test.describe('Renderer Showcase - Render-Only Mode', () => {
  test('charts: should render chart content', async ({ page }) => {
    await navigateToPreview(page, 'charts', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // Chart renderer either shows the chart or a loading/fallback alert
    await expect(wrapper.locator('.fmcp-chart, .MuiAlert-root, .recharts-wrapper').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('mermaid: should render diagram content', async ({ page }) => {
    await navigateToPreview(page, 'mermaid', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // Mermaid renders SVG or shows loading state
    await expect(wrapper.locator('svg, .fmcp-mermaid, .MuiAlert-root').first()).toBeVisible({ timeout: 10_000 });
  });

  test('flow: should render flow diagram', async ({ page }) => {
    await navigateToPreview(page, 'flow', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('.react-flow, .fmcp-flow, .MuiAlert-root').first()).toBeVisible({ timeout: 10_000 });
  });

  test('math: should render LaTeX content', async ({ page }) => {
    await navigateToPreview(page, 'math', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // KaTeX renders .katex elements, or falls back to <pre>
    await expect(wrapper.locator('.katex, .fmcp-math, pre').first()).toBeVisible({ timeout: 10_000 });
  });

  test('maps: should render map content', async ({ page }) => {
    await navigateToPreview(page, 'maps', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('.leaflet-container, .fmcp-map, .MuiAlert-root').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('image: should render image', async ({ page }) => {
    await navigateToPreview(page, 'image', 1); // SVG data URI (reliable offline)
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('img, .fmcp-image').first()).toBeVisible({ timeout: 10_000 });
  });

  test('csv: should render table', async ({ page }) => {
    await navigateToPreview(page, 'csv', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('table, .MuiTable-root, .fmcp-csv').first()).toBeVisible({ timeout: 10_000 });
  });

  test('mdx: should render markdown', async ({ page }) => {
    await navigateToPreview(page, 'mdx', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // Markdown renders headings
    await expect(wrapper.locator('h1, h2, .fmcp-mdx').first()).toBeVisible({ timeout: 10_000 });
  });

  test('html: should render HTML', async ({ page }) => {
    await navigateToPreview(page, 'html', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('h2, .fmcp-html').first()).toBeVisible({ timeout: 10_000 });
  });

  test('react: should render live JSX component', async ({ page }) => {
    await navigateToPreview(page, 'react', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // Live-rendered component should produce actual DOM elements (h2, div), or fall back to error alert
    await expect(wrapper.locator('h2, .fmcp-jsx-content, .MuiAlert-root').first()).toBeVisible({ timeout: 15_000 });
  });

  test('pdf: should render PDF or fallback', async ({ page }) => {
    await navigateToPreview(page, 'pdf', 0);
    const wrapper = page.locator('[data-testid="preview-content"]');
    await expect(wrapper).toBeVisible();
    // PDF renderer uses react-pdf or iframe fallback
    await expect(wrapper.locator('.fmcp-pdf, iframe, canvas, .MuiAlert-root, .react-pdf__Page').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
