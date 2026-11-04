// Needs the packages built: `nx run-many -t build -p sdk plugin-skilled-openapi`.
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';
import webpack from 'webpack';

import { mkdtemp, readFile, rm } from '@frontmcp/utils';

import { bundleWithWebpack } from '../../../demo-e2e-bundle-size/e2e/helpers/browser-bundle';

const PAGE_ORIGIN = 'https://app.example';
const API_ORIGIN = 'https://billing.example';
const pageEntry = resolve(__dirname, '../../browser/skilled-page.mjs');

// mcp-from-openapi, under the plugin's OpenAPI runtime, imports these inside try/catch; webpack can't resolve them for a page
const mcpFromOpenApiNodeImports = new webpack.IgnorePlugin({
  resourceRegExp: /^(node:)?(dns|http|https|path|fs\/promises)$/,
  contextRegExp: /mcp-from-openapi/,
});

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };
type SkilledPage = { callSkilledTool(name: string, args: Record<string, unknown>): Promise<ToolResult> };

let pageBundle: string;
let apiRequests: string[];
let framesAttached: number;
let pageErrors: string[];

function serveBillingApi(route: Route): Promise<void> {
  const request = route.request();
  apiRequests.push(`${request.method()} ${request.url()} ${request.headers()['authorization']}`);
  const missing = request.url().endsWith('/missing');
  return route.fulfill({
    status: missing ? 404 : 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': PAGE_ORIGIN },
    body: JSON.stringify(missing ? { error: 'not found' } : { id: '7', total: 42 }),
  });
}

function callTool(page: Page, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return page.evaluate(
    ([toolName, toolArgs]) => (globalThis as unknown as SkilledPage).callSkilledTool(toolName, toolArgs),
    [name, args] as const,
  );
}

test.describe('the Skilled OpenAPI plugin in a web page', () => {
  test.beforeAll(async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-skilled-page-'));
    try {
      const outfile = join(outDir, 'skilled-page.js');
      await bundleWithWebpack('web', pageEntry, outfile, [mcpFromOpenApiNodeImports]);
      pageBundle = await readFile(outfile);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    apiRequests = [];
    framesAttached = 0;
    pageErrors = [];
    page.on('frameattached', () => {
      framesAttached += 1;
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route(`${PAGE_ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Billing</title>' }),
    );
    await page.route(`${API_ORIGIN}/**`, serveBillingApi);
    await page.goto(`${PAGE_ORIGIN}/`);
    await page.addScriptTag({ content: pageBundle });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test('search_skill, load_skill and execute_action reach the API with the credential', async ({ page }) => {
    expect((await callTool(page, 'search_skill', { query: 'invoice' })).structuredContent).toMatchObject({
      skills: [{ skillId: 'invoices', bundleVersion: '1.0.0' }],
    });
    expect((await callTool(page, 'load_skill', { skillId: 'invoices' })).structuredContent).toMatchObject({
      skill: { actions: [{ actionId: 'getInvoice' }] },
    });
    expect(await callTool(page, 'execute_action', { actionId: 'getInvoice', input: { id: '7' } })).toMatchObject({
      structuredContent: { id: '7', total: 42 },
    });
    expect(apiRequests).toEqual([`GET ${API_ORIGIN}/v1/invoices/7 Bearer page-token`]);
  });

  test("run_workflow runs its script in the browser's iframe sandbox, and its callTool reaches the API", async ({
    page,
  }) => {
    const result = await callTool(page, 'run_workflow', {
      script: `
        const invoice = await callTool("getInvoice", { id: "7" });
        const missing = await callTool("getInvoice", { id: "missing" }, { throwOnError: false });
        return { total: invoice.total, missing };`,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      success: true,
      value: { total: 42, missing: { ok: false, status: 404, data: { error: 'not found' } } },
      stats: { toolCalls: 2 },
    });
    expect(apiRequests).toEqual([
      `GET ${API_ORIGIN}/v1/invoices/7 Bearer page-token`,
      `GET ${API_ORIGIN}/v1/invoices/missing Bearer page-token`,
    ]);
    expect(framesAttached).toBeGreaterThan(0);
  });

  test('a failed call ends the workflow with the error it has on Node.js', async ({ page }) => {
    expect(
      await callTool(page, 'run_workflow', { script: 'return await callTool("getInvoice", { id: "missing" });' }),
    ).toMatchObject({
      isError: true,
      structuredContent: { success: false, error: 'action "getInvoice" failed with status 404: {"error":"not found"}' },
    });
  });

  test('a script cannot fetch', async ({ page }) => {
    expect(
      await callTool(page, 'run_workflow', { script: `return await fetch("${API_ORIGIN}/v1/invoices/7");` }),
    ).toMatchObject({
      isError: true,
      structuredContent: { success: false, error: expect.stringContaining('Unknown identifier "__safe_fetch"') },
    });
    expect(apiRequests).toEqual([]);
  });
});
