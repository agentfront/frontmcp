/**
 * Persistent questions: `elicitation.persistent` keeps a question for the signed-in caller that asked it, and people
 * auth serves the inbox where a person signed in for that caller answers it. `auth.mode: 'transparent'` against the
 * mock IdP from `@frontmcp/testing` gives each caller a real subject, which a later session of the same user shares.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { QuestionsApp } from './apps/questions';

const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : 3123;

const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://mock-idp.local';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Persistent Questions', version: '0.1.0' },
  apps: [QuestionsApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  http: { port, auth: { people: 'loopback-token' } },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'mock-idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
    allowAnonymous: false,
  },
  elicitation: { enabled: true, persistent: true },
})
export default class Server {}
