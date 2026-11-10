import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { MailApp } from './apps/mail';

const port = parseInt(process.env['PORT'] ?? '3180', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

/** The mail triage server: callers sign in with the identity provider at IDP_PROVIDER_URL. */
@FrontMcp({
  info: { name: 'Mail Triage', version: '0.1.0' },
  apps: [MailApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
  },
  events: {
    // Only for the local test receiver: a real deployment delivers to https callbacks
    webhook: { unsafeAllowLocalCallbacks: process.env['EVENTS_ALLOW_LOCAL_CALLBACKS'] === 'true' },
  },
})
export default class Server {}
