/**
 * Browser E2E Tests for Full FrontMCP with Dynamic ESM Tool Loading
 *
 * Uses Playwright to verify that a complete FrontMCP DirectClient runs in the browser,
 * loading ESM tool packages on the fly from a local ESM package server.
 *
 * The browser app (browser-app/main.ts) boots a real FrontMCP instance via connect()
 * with loadFrom() ESM apps, then reports results to window.__ESM_RESULTS__.
 *
 * Prerequisites:
 * - ESM package server must be running on the configured port
 * - Vite preview server must be serving the browser app
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { ESM_SERVER_PORT } from './helpers';

let esmServerProcess: ChildProcess | null = null;

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
      if (data.toString().includes('ESM Package Server started') && !started) {
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

// Stop ESM package server after all tests
test.afterAll(async () => {
  if (esmServerProcess) {
    try {
      esmServerProcess.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
    esmServerProcess = null;
  }
});

test.describe('Full FrontMCP in Browser with ESM Loading', () => {
  test('loads and reports ESM tools successfully', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);

    // Wait for FrontMCP to finish loading (window.__ESM_RESULTS__ becomes defined)
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; error?: string; toolNames: string[] };

    expect(r.success).toBe(true);
    expect(r.toolNames).toContain('esm:echo');
    expect(r.toolNames).toContain('esm:add');
    expect(r.toolNames).toContain('multi:greet');
  });

  test('ESM echo tool executes correctly in browser', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; echoResult: { content: Array<{ text: string }> } };

    expect(r.success).toBe(true);
    expect(r.echoResult.content[0].text).toContain('browser-hello');
  });

  test('ESM add tool computes correctly in browser', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; addResult: { content: Array<{ text: string }> } };

    expect(r.success).toBe(true);
    expect(r.addResult.content[0].text).toBe('12'); // 5 + 7
  });

  test('ESM multi-package greet tool works in browser', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; greetResult: { content: Array<{ text: string }> } };

    expect(r.success).toBe(true);
    expect(r.greetResult.content[0].text).toContain('Browser');
  });

  test('ESM resources are discoverable in browser', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; resourceUris: string[] };

    expect(r.success).toBe(true);
    expect(r.resourceUris).toContain('esm://status');
  });

  test('ESM prompts are discoverable in browser', async ({ page }) => {
    await page.goto(`/?esmServer=http://127.0.0.1:${ESM_SERVER_PORT}`);
    await page.waitForFunction(() => (window as unknown as { __ESM_RESULTS__?: unknown }).__ESM_RESULTS__, {
      timeout: 60000,
    });

    const results = await page.evaluate(() => (window as unknown as { __ESM_RESULTS__: unknown }).__ESM_RESULTS__);
    const r = results as { success: boolean; promptNames: string[] };

    expect(r.success).toBe(true);
    expect(r.promptNames).toContain('multi:greeting-prompt');
  });
});
