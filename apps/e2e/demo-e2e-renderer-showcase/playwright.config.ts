import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.test.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  use: {
    headless: true,
    baseURL: 'http://localhost:4400',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx nx serve demo-e2e-renderer-showcase',
    port: 4400,
    timeout: 60_000,
    reuseExistingServer: !process.env['CI'],
  },
});
