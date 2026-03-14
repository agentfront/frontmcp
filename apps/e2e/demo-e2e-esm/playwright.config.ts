import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4402',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'npx vite build --config apps/e2e/demo-e2e-esm/browser-app/vite.config.ts && npx vite preview --config apps/e2e/demo-e2e-esm/browser-app/vite.config.ts',
    port: 4402,
    reuseExistingServer: !process.env['CI'],
  },
});
