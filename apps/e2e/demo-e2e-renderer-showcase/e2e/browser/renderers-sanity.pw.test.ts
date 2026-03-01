import { test, expect } from '@playwright/test';
import { renderAndWaitForContent, assertNotLoading, assertNoErrorAlert, navigateToRenderer } from './helpers';

// ─── A. Charts (recharts) ────────────────────────────────────────────────────

test.describe('Sanity: Charts', () => {
  test('charts: fixture 0 - Bar Chart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'charts', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.recharts-wrapper')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Monthly Sales & Revenue')).toBeVisible();
    await expect(w.locator('.recharts-cartesian-axis-tick-value').first()).toBeVisible();
    await expect(w.locator('.recharts-bar').first()).toBeVisible();
  });

  test('charts: fixture 1 - Line Chart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'charts', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.recharts-wrapper')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Weekly Traffic')).toBeVisible();
    await expect(w.locator('.recharts-line')).toHaveCount(2, { timeout: 5_000 });
  });

  test('charts: fixture 2 - Area Chart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'charts', 2);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.recharts-wrapper')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Platform Usage by Quarter')).toBeVisible();
    await expect(w.locator('.recharts-area')).toHaveCount(2, { timeout: 5_000 });
  });

  test('charts: fixture 3 - Pie Chart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'charts', 3);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.recharts-wrapper')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Browser Market Share')).toBeVisible();
    await expect(w.locator('.recharts-pie')).toBeVisible();
    await expect(w.getByText('Chrome')).toBeVisible();
  });
});

// ─── B. Mermaid ──────────────────────────────────────────────────────────────

test.describe('Sanity: Mermaid', () => {
  test('mermaid: fixture 0 - Flowchart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mermaid', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    const svg = w.locator('svg');
    await expect(svg).toBeVisible({ timeout: 15_000 });
    await expect(w.getByText('Start')).toBeVisible();
    await expect(w.getByText('Debug')).toBeVisible();
  });

  test('mermaid: fixture 1 - Sequence Diagram', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mermaid', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('svg')).toBeVisible({ timeout: 15_000 });
    await expect(w.getByText('Client')).toBeVisible();
    await expect(w.getByText('Server')).toBeVisible();
  });

  test('mermaid: fixture 2 - Class Diagram', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mermaid', 2);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('svg')).toBeVisible({ timeout: 15_000 });
    await expect(w.getByText('Animal')).toBeVisible();
    await expect(w.getByText('Dog')).toBeVisible();
  });

  test('mermaid: fixture 3 - ER Diagram', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mermaid', 3);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('svg')).toBeVisible({ timeout: 15_000 });
    await expect(w.getByText('USER')).toBeVisible();
    await expect(w.getByText('ORDER')).toBeVisible();
  });
});

// ─── C. Flow (@xyflow/react) ────────────────────────────────────────────────

test.describe('Sanity: Flow', () => {
  test('flow: fixture 0 - Simple Pipeline', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'flow', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.react-flow')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Input')).toBeVisible();
    await expect(w.getByText('Process')).toBeVisible();
    await expect(w.getByText('Output')).toBeVisible();
    await expect(w.getByText('Data Pipeline')).toBeVisible();
  });

  test('flow: fixture 1 - Branching Flow', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'flow', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.react-flow')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Start')).toBeVisible();
    await expect(w.getByText('Validate')).toBeVisible();
    await expect(w.getByText('Success Path')).toBeVisible();
    const edges = w.locator('.react-flow__edge');
    await expect(edges).toHaveCount(5, { timeout: 5_000 });
  });

  test('flow: CSS injection present', async ({ page }) => {
    await renderAndWaitForContent(page, 'flow', 0);
    const cssLink = page.locator('#fmcp-xyflow-css');
    await expect(cssLink).toBeAttached({ timeout: 10_000 });
  });
});

// ─── D. Math (KaTeX) ────────────────────────────────────────────────────────

test.describe('Sanity: Math', () => {
  test('math: fixture 0 - Display Math', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'math', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.katex').first()).toBeVisible({ timeout: 10_000 });
  });

  test('math: fixture 1 - Inline Math', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'math', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.katex').first()).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText("Euler's identity")).toBeVisible();
  });

  test('math: fixture 2 - Mixed Text and Math', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'math', 2);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    const katexElements = w.locator('.katex');
    await expect(katexElements.first()).toBeVisible({ timeout: 10_000 });
    await expect(katexElements).toHaveCount(2, { timeout: 5_000 });
    await expect(w.getByText('Gaussian integral')).toBeVisible();
  });
});

// ─── E. Maps (Leaflet) ──────────────────────────────────────────────────────

test.describe('Sanity: Maps', () => {
  test('maps: fixture 0 - Markers', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'maps', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
    await expect(w.locator('.leaflet-tile').first()).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('NYC Landmarks')).toBeVisible();
  });

  test('maps: fixture 1 - GeoJSON', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'maps', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── F. Images ───────────────────────────────────────────────────────────────

test.describe('Sanity: Images', () => {
  test('image: fixture 0 - URL Image', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'image', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    const img = w.locator('img');
    await expect(img).toBeVisible({ timeout: 10_000 });
    await expect(img).toHaveAttribute('src', /picsum\.photos/);
  });

  test('image: fixture 1 - SVG Data URI', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'image', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    const img = w.locator('img');
    await expect(img).toBeVisible({ timeout: 10_000 });
    await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);
  });
});

// ─── G. Video ────────────────────────────────────────────────────────────────

test.describe('Sanity: Video', () => {
  test('video: fixture 0 - YouTube', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'video', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('iframe[src*="youtube"], video').first()).toBeVisible({ timeout: 15_000 });
  });

  test('video: fixture 1 - MP4', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'video', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('video, [class*="react-player"]').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ─── H. Audio ────────────────────────────────────────────────────────────────

test.describe('Sanity: Audio', () => {
  test('audio: fixture 0 - MP3', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'audio', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('audio, [class*="react-player"]').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ─── I. CSV ──────────────────────────────────────────────────────────────────

test.describe('Sanity: CSV', () => {
  test('csv: fixture 0 - Comma-Delimited', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'csv', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('table, .MuiTable-root').first()).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Name')).toBeVisible();
    await expect(w.getByText('Age')).toBeVisible();
    await expect(w.getByText('City')).toBeVisible();
    await expect(w.getByText('Score')).toBeVisible();
    await expect(w.getByText('Alice')).toBeVisible();
    await expect(w.getByText('95')).toBeVisible();
  });

  test('csv: fixture 1 - Tab-Delimited (TSV)', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'csv', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('table, .MuiTable-root').first()).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Product')).toBeVisible();
    await expect(w.getByText('Price')).toBeVisible();
    await expect(w.getByText('Widget A')).toBeVisible();
    await expect(w.getByText('$9.99')).toBeVisible();
  });
});

// ─── J. Markdown/MDX ─────────────────────────────────────────────────────────

test.describe('Sanity: MDX', () => {
  test('mdx: fixture 0 - Headings & Lists', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mdx', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.getByText('Getting Started')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('npm')).toBeVisible();
    await expect(w.getByText('yarn')).toBeVisible();
  });

  test('mdx: fixture 1 - Code Blocks', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mdx', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.getByText('Code Example')).toBeVisible({ timeout: 10_000 });
    await expect(w.locator('pre').first()).toBeVisible();
    await expect(w.getByText('registerAllRenderers')).toBeVisible();
  });

  test('mdx: fixture 2 - Tables', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'mdx', 2);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.getByText('Renderer Comparison')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('recharts')).toBeVisible();
    await expect(w.locator('table').first()).toBeVisible();
  });
});

// ─── K. HTML ─────────────────────────────────────────────────────────────────

test.describe('Sanity: HTML', () => {
  test('html: fixture 0 - Styled Div', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'html', 0);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('h2')).toBeVisible({ timeout: 10_000 });
    await expect(w.getByText('Welcome to FrontMCP')).toBeVisible();
  });

  test('html: fixture 1 - Table', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'html', 1);
    await assertNotLoading(w);
    await assertNoErrorAlert(w);
    await expect(w.locator('table')).toBeVisible({ timeout: 10_000 });
    await expect(w.locator('th').first()).toBeVisible();
    await expect(w.getByText('Status')).toBeVisible();
    await expect(w.getByText('Passed')).toBeVisible();
    await expect(w.getByText('142')).toBeVisible();
  });
});

// ─── L. PDF ──────────────────────────────────────────────────────────────────

test.describe('Sanity: PDF', () => {
  test('pdf: fixture 0 - Minimal PDF', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'pdf', 0);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('canvas, iframe, .react-pdf__Page').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ─── M. React/JSX (Babel + esm.sh) ──────────────────────────────────────────

test.describe('Sanity: React/JSX', () => {
  test.describe.configure({ timeout: 30_000 });

  test('react: fixture 0 - Dashboard Card', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'react', 0, 20_000);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('.fmcp-jsx-content')).toBeVisible({ timeout: 20_000 });
    await expect(w.getByText('Active Users')).toBeVisible();
    await expect(w.getByText('$48.2K')).toBeVisible();
  });

  test('react: fixture 1 - Todo List (hooks prove no dual-React)', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'react', 1, 20_000);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('.fmcp-jsx-content')).toBeVisible({ timeout: 20_000 });
    await expect(w.getByText('Tasks')).toBeVisible();
    await expect(w.locator('input[placeholder*="Add"]')).toBeVisible();
  });

  test('react: fixture 2 - Data Table', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'react', 2, 20_000);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('.fmcp-jsx-content')).toBeVisible({ timeout: 20_000 });
    await expect(w.locator('th').filter({ hasText: 'Name' }).first()).toBeVisible();
    await expect(w.locator('th').filter({ hasText: 'Library' }).first()).toBeVisible();
    await expect(w.getByText('Charts Renderer')).toBeVisible();
  });

  test('react: fixture 3 - Theme Switcher', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'react', 3, 20_000);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('.fmcp-jsx-content')).toBeVisible({ timeout: 20_000 });
    await expect(w.getByText('Ocean', { exact: false })).toBeVisible();
    await expect(w.getByText('Forest', { exact: false })).toBeVisible();
  });

  test('react: fixture 4 - Mini Chart', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'react', 4, 20_000);
    await assertNotLoading(w, 20_000);
    await assertNoErrorAlert(w);
    await expect(w.locator('.fmcp-jsx-content')).toBeVisible({ timeout: 20_000 });
    await expect(w.getByText('Monthly Performance')).toBeVisible();
    await expect(w.getByText('Jan')).toBeVisible();
  });
});

// ─── N. Theme Switching ──────────────────────────────────────────────────────

test.describe('Sanity: Theme', () => {
  test('theme toggle changes background color', async ({ page }) => {
    await navigateToRenderer(page, 'charts');
    const body = page.locator('body');
    const bgBefore = await body.evaluate((el) => getComputedStyle(el).backgroundColor);

    const toggle = page.locator('[data-testid="theme-toggle"]');
    await toggle.click();

    // Wait for theme transition and get new bg
    await page.waitForTimeout(500);
    const bgAfter = await body.evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(bgBefore).not.toBe(bgAfter);
  });
});

// ─── O. Error Handling ───────────────────────────────────────────────────────

test.describe('Sanity: Error Handling', () => {
  test('unknown renderer group shows error', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'nonexistent', 0);
    await expect(w).toContainText('Unknown renderer');
  });

  test('out-of-range fixture index shows error', async ({ page }) => {
    const w = await renderAndWaitForContent(page, 'charts', 99);
    await expect(w).toContainText('Unknown renderer');
  });
});
