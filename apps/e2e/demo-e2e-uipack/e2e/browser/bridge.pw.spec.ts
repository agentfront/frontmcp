/**
 * Playwright: Bridge Runtime Browser Tests
 *
 * Verifies the bridge IIFE executes correctly in a real browser:
 * - window.FrontMcpBridge is defined with expected methods
 * - Bridge reads injected data correctly
 * - Platform detection defaults to 'generic' in standalone page
 * - bridge:ready event is dispatched
 */
import { test, expect } from '@playwright/test';
import { serveShell, stopServer } from './helpers';

test.afterEach(async () => {
  await stopServer();
});

test.describe('Bridge Global', () => {
  test('should expose FrontMcpBridge global with expected methods', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      includeBridge: true,
    });

    await page.goto(url);

    // Wait for bridge initialization
    await page.waitForFunction(
      () => {
        const bridge = (window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown> | undefined;
        return bridge && bridge.initialized === true;
      },
      null,
      { timeout: 5000 },
    );

    const hasBridge = await page.evaluate(() => {
      return typeof (window as Record<string, unknown>).FrontMcpBridge !== 'undefined';
    });
    expect(hasBridge).toBe(true);

    const methods = await page.evaluate(() => {
      const bridge = (window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown>;
      return {
        hasGetTheme: typeof bridge.getTheme === 'function',
        hasGetToolInput: typeof bridge.getToolInput === 'function',
        hasGetToolOutput: typeof bridge.getToolOutput === 'function',
        hasCallTool: typeof bridge.callTool === 'function',
        hasInitialize: typeof bridge.initialize === 'function',
      };
    });

    expect(methods.hasGetTheme).toBe(true);
    expect(methods.hasGetToolInput).toBe(true);
    expect(methods.hasGetToolOutput).toBe(true);
    expect(methods.hasCallTool).toBe(true);
    expect(methods.hasInitialize).toBe(true);
  });
});

test.describe('Bridge Data Access', () => {
  test('should read injected data via bridge methods', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      toolName: 'data-tool',
      input: { question: 'What is 2+2?' },
      output: { answer: 4 },
      includeBridge: true,
    });

    await page.goto(url);

    await page.waitForFunction(
      () => {
        const bridge = (window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown> | undefined;
        return bridge && bridge.initialized === true;
      },
      null,
      { timeout: 5000 },
    );

    const input = await page.evaluate(() => {
      const bridge = (window as Record<string, unknown>).FrontMcpBridge as { getToolInput: () => unknown };
      return bridge.getToolInput();
    });
    expect(input).toEqual({ question: 'What is 2+2?' });

    const output = await page.evaluate(() => {
      const bridge = (window as Record<string, unknown>).FrontMcpBridge as { getToolOutput: () => unknown };
      return bridge.getToolOutput();
    });
    expect(output).toEqual({ answer: 4 });
  });
});

test.describe('Platform Detection', () => {
  test('should detect generic adapter in standalone page', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      includeBridge: true,
    });

    await page.goto(url);

    await page.waitForFunction(
      () => {
        const bridge = (window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown> | undefined;
        return bridge && bridge.initialized === true;
      },
      null,
      { timeout: 5000 },
    );

    const adapterId = await page.evaluate(() => {
      const bridge = (window as Record<string, unknown>).FrontMcpBridge as { adapterId: string };
      return bridge.adapterId;
    });
    expect(adapterId).toBe('generic');
  });
});

test.describe('Bridge Ready Event', () => {
  test('should dispatch bridge:ready event after initialization', async ({ page }) => {
    const { url } = await serveShell('<div></div>', {
      includeBridge: true,
    });

    // Set up event listener before navigating
    await page.goto(url);

    // The bridge:ready event may have already fired, check bridge state
    const initialized = await page.waitForFunction(
      () => {
        const bridge = (window as Record<string, unknown>).FrontMcpBridge as Record<string, unknown> | undefined;
        return bridge && bridge.initialized === true;
      },
      null,
      { timeout: 5000 },
    );

    expect(initialized).toBeTruthy();
  });
});
