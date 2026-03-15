import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  use: {
    headless: true,
    baseURL: 'http://localhost:4402',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.pw\.spec\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testMatch: /^(?!.*global-setup).*\.pw\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx nx serve demo-e2e-react',
    port: 4402,
    timeout: 60_000,
    reuseExistingServer: !process.env['CI'],
  },
});
