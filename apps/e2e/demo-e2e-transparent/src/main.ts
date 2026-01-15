import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { TasksApp } from './apps/tasks';

const port = parseInt(process.env['PORT'] ?? '3109', 10);

// The IdP provider URL is set via environment variable
// For E2E testing, this points to a MockOAuthServer instance
// For production, this should be your real IdP (e.g., Frontegg, Auth0, etc.)
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Transparent', version: '0.1.0' },
  apps: [TasksApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'transparent',
    remote: {
      provider: idpProviderUrl,
      name: 'mock-idp',
      dcrEnabled: false,
    },
    expectedAudience,
    requiredScopes: [],
    allowAnonymous: false,
  },
  transport: {
    protocol: { json: true, legacy: true },
  },
})
export default class Server {}
