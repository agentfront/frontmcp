import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './e2e/browser/global-setup.ts',
  globalTeardown: './e2e/browser/global-teardown.ts',
  testDir: './e2e/browser',
  testMatch: '**/*.pw.test.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { headless: true, ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
