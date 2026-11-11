import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { AppointmentsApp } from './apps/appointments';

const port = parseInt(process.env['PORT'] ?? '3160', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

/** The appointments server: callers sign in with the identity provider at IDP_PROVIDER_URL. */
@FrontMcp({
  info: { name: 'Appointments', version: '0.1.0' },
  apps: [AppointmentsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
  },
  authorities: {
    // The business a staff member works for is the tenantId claim of their token
    claimsMapping: { roles: 'roles', tenantId: 'tenantId' },
    profiles: { staff: { roles: { any: ['admin', 'receptionist'] } } },
  },
  events: {
    // Only for the local test receiver: a real deployment delivers to https callbacks
    webhook: { unsafeAllowLocalCallbacks: process.env['EVENTS_ALLOW_LOCAL_CALLBACKS'] === 'true' },
  },
})
export default class Server {}
