import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.test.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { headless: true, ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
