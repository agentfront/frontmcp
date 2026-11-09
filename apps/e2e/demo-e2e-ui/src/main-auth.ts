import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

import DirectUrlForecastTool from './apps/widgets/tools/direct-url-forecast.tool';

const port = parseInt(process.env['PORT'] ?? '3108', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] ?? 'https://idp.example.com';

@App({ name: 'url-widgets', tools: [DirectUrlForecastTool] })
class UrlWidgetsApp {}

const auth =
  process.env['AUTH_MODE'] === 'transparent'
    ? {
        mode: 'transparent' as const,
        provider: idpProviderUrl,
        providerConfig: { name: 'mock-idp', dcrEnabled: false },
        expectedAudience: process.env['IDP_EXPECTED_AUDIENCE'] ?? idpProviderUrl,
        requiredScopes: [],
        allowAnonymous: false,
      }
    : { mode: 'local' as const, tokenStorage: 'memory' as const, allowDefaultPublic: false };

/** A 'direct-url' widget behind an auth mode that requires a token for the MCP endpoint. */
@FrontMcp({
  info: { name: 'Demo E2E UI Auth', version: '0.1.0' },
  apps: [UrlWidgetsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth,
})
export default class Server {}
