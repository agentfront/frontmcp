import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    headless: true,
    baseURL: 'http://localhost:50340',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx tsx apps/e2e/demo-e2e-guard/src/main.ts',
    port: 50340,
    timeout: 30_000,
    reuseExistingServer: !process.env['CI'],
    cwd: root,
    env: { PORT: '50340' },
  },
});
