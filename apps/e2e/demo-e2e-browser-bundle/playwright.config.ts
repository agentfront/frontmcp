import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  testDir: './e2e/browser',
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    headless: true,
    baseURL: 'http://localhost:4401',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx nx build demo-e2e-browser-bundle && npx vite preview --config ${resolve(__dirname, 'vite.config.ts')} --port 4401`,
    port: 4401,
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
    cwd: root,
  },
});
