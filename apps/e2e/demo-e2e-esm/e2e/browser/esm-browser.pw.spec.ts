/**
 * Browser E2E Tests for ESM Package Loading
 *
 * Uses Playwright to verify that ESM packages can be loaded and executed
 * in a real browser environment — no Node.js-specific APIs (node:fs, node:url).
 *
 * The test serves a local HTML page that:
 * 1. Fetches the CJS bundle from the ESM package server
 * 2. Evaluates it in a sandboxed scope (simulating dynamic import)
 * 3. Calls tools from the loaded manifest
 * 4. Reports results to the DOM
 *
 * Playwright reads the DOM to verify tool execution worked.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { serveHtml, buildEsmTestPage, stopServer } from './helpers';

const ESM_SERVER_PORT = 50413;
let esmServerProcess: ReturnType<typeof spawn> | null = null;

// Start local ESM package server before all tests
test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    esmServerProcess = spawn('npx', ['tsx', 'apps/e2e/demo-e2e-esm/src/esm-package-server/main.ts'], {
      env: { ...process.env, ESM_SERVER_PORT: String(ESM_SERVER_PORT) },
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('ESM server startup timeout'));
    }, 30000);

    esmServerProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('ESM Package Server started') && !started) {
        started = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    esmServerProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[esm-server]', data.toString());
    });

    esmServerProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
});

// Stop ESM package server + HTML server after all tests
test.afterAll(async () => {
  if (esmServerProcess) {
    esmServerProcess.kill('SIGTERM');
    esmServerProcess = null;
  }
  await stopServer();
});

test.describe('ESM Browser Loading', () => {
  test('loads and executes ESM tools in browser', async ({ page }) => {
    const esmServerUrl = `http://127.0.0.1:${ESM_SERVER_PORT}`;
    const html = buildEsmTestPage(esmServerUrl, '@test/esm-tools@1.0.0');
    const url = await serveHtml(html);

    await page.goto(url);

    // Wait for the result to appear
    await page.waitForFunction(
      () => {
        const el = document.getElementById('result');
        return el && el.textContent && el.textContent.length > 0;
      },
      { timeout: 15000 },
    );

    const resultText = await page.textContent('#result');
    const result = JSON.parse(resultText!);

    expect(result.success).toBe(true);
    expect(result.name).toBe('@test/esm-tools');
    expect(result.version).toBe('1.0.0');
    expect(result.toolNames).toContain('echo');
    expect(result.toolNames).toContain('add');
  });

  test('echo tool returns correct result in browser', async ({ page }) => {
    const esmServerUrl = `http://127.0.0.1:${ESM_SERVER_PORT}`;
    const html = buildEsmTestPage(esmServerUrl, '@test/esm-tools@1.0.0');
    const url = await serveHtml(html);

    await page.goto(url);

    await page.waitForFunction(
      () => {
        const el = document.getElementById('result');
        return el && el.textContent && el.textContent.length > 0;
      },
      { timeout: 15000 },
    );

    const resultText = await page.textContent('#result');
    const result = JSON.parse(resultText!);

    expect(result.success).toBe(true);
    // echo tool should echo back the input
    expect(result.results.echo).toBeDefined();
    expect(result.results.echo.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('browser-test'),
        }),
      ]),
    );
  });

  test('add tool computes correctly in browser', async ({ page }) => {
    const esmServerUrl = `http://127.0.0.1:${ESM_SERVER_PORT}`;
    const html = buildEsmTestPage(esmServerUrl, '@test/esm-tools@1.0.0');
    const url = await serveHtml(html);

    await page.goto(url);

    await page.waitForFunction(
      () => {
        const el = document.getElementById('result');
        return el && el.textContent && el.textContent.length > 0;
      },
      { timeout: 15000 },
    );

    const resultText = await page.textContent('#result');
    const result = JSON.parse(resultText!);

    expect(result.success).toBe(true);
    expect(result.results.add).toBeDefined();
    expect(result.results.add.content[0].text).toBe('15'); // 7 + 8
  });

  test('multi-package resources and prompts load in browser', async ({ page }) => {
    const esmServerUrl = `http://127.0.0.1:${ESM_SERVER_PORT}`;

    // Build a page that loads the multi-package
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div id="result"></div>
  <script type="module">
    try {
      const res = await fetch('${esmServerUrl}/@test/esm-multi@1.0.0');
      const bundleText = await res.text();

      const module = { exports: {} };
      const wrappedFn = new Function('module', 'exports', bundleText);
      wrappedFn(module, module.exports);

      const manifest = module.exports.default || module.exports;

      const toolNames = (manifest.tools || []).map(t => t.name);
      const resourceNames = (manifest.resources || []).map(r => r.name);
      const promptNames = (manifest.prompts || []).map(p => p.name);

      document.getElementById('result').textContent = JSON.stringify({
        success: true,
        toolNames,
        resourceNames,
        promptNames,
      });
    } catch (err) {
      document.getElementById('result').textContent = JSON.stringify({
        success: false,
        error: err.message,
      });
    }
  </script>
</body>
</html>`;

    const url = await serveHtml(html);
    await page.goto(url);

    await page.waitForFunction(
      () => {
        const el = document.getElementById('result');
        return el && el.textContent && el.textContent.length > 0;
      },
      { timeout: 15000 },
    );

    const resultText = await page.textContent('#result');
    const result = JSON.parse(resultText!);

    expect(result.success).toBe(true);
    expect(result.toolNames).toContain('greet');
    expect(result.resourceNames).toContain('status');
    expect(result.promptNames).toContain('greeting-prompt');
  });
});
