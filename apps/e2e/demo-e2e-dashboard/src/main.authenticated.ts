/**
 * Dashboard on an AUTHENTICATED server.
 *
 * The advisory's core complaint was that the dashboard's MCP scope declared
 * `auth: { mode: 'public' }` unconditionally, so `dashboard:graph` exposed the
 * whole server's inventory to anonymous callers *regardless of how the server
 * itself was authenticated*. This fixture is that case: the server requires a
 * verified token, so the dashboard scope must too.
 */
import DashboardPlugin, { DashboardApp } from '@frontmcp/plugin-dashboard';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { LabApp } from './apps/lab';

const DEFAULT_PORT = 3161;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://mock-idp.local';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Dashboard (authenticated)', version: '0.1.0' },
  apps: [LabApp, DashboardApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  http: { port },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'mock-idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
    allowAnonymous: false,
  },
  plugins: [DashboardPlugin.init({ enabled: true, auth: { enabled: true, token: 'test-dashboard-token' } })],
})
export default class Server {}
