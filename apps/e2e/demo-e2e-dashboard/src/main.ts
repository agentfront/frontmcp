/**
 * Dashboard plugin server with authentication CONFIGURED.
 *
 * The operator asks for a token-protected dashboard, which is exactly the
 * configuration GHSA-rgxj-434m-vxh3 reported as unenforced: the token was never
 * checked, and the operator's options never reached the middleware at all.
 */
import DashboardPlugin, { DashboardApp } from '@frontmcp/plugin-dashboard';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { LabApp } from './apps/lab';

const DEFAULT_PORT = 3160;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

/** Synthetic test token — not a real secret. */
export const DASHBOARD_TOKEN = 'test-dashboard-token';

@FrontMcp({
  info: { name: 'Demo E2E Dashboard', version: '0.1.0' },
  apps: [LabApp, DashboardApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  http: { port },
  plugins: [
    DashboardPlugin.init({
      enabled: true,
      auth: { enabled: true, token: DASHBOARD_TOKEN },
    }),
  ],
})
export default class Server {}
