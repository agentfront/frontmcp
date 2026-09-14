/**
 * Jobs/workflows PERMISSION-enforcement server.
 *
 * `auth.mode: 'transparent'` against the mock IdP from `@frontmcp/testing`, so
 * the e2e can mint tokens with (and without) the `admin` role and the
 * `reports:run` scope and assert that per-job `permissions` are actually
 * enforced. No `authorities` block is configured on purpose — that exercises the
 * fallback claim resolution, which is what a server that has not opted into the
 * authorities engine will use.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { PermissionsApp } from './apps/permissions';

const DEFAULT_PORT = 3119;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://mock-idp.local';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Jobs Permissions', version: '0.1.0' },
  apps: [PermissionsApp],
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
  jobs: { enabled: true },
})
export default class Server {}
