import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ProbeApp } from './apps/probe';

const parsedPort = parseInt(process.env['PORT'] ?? '3171', 10);
const port = Number.isNaN(parsedPort) ? 3171 : parsedPort;

const idpProviderUrl = process.env['IDP_PROVIDER_URL'] ?? 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] ?? idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Testing (transparent)', version: '0.1.0' },
  apps: [ProbeApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'mock-idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
    allowAnonymous: false,
  },
  transport: { protocol: { json: true, legacy: true } },
})
export default class Server {}
