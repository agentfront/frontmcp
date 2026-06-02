import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { SkillsE2EApp, SkillsE2EAuthoritiesApp } from './apps/skills';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// When AUTHORITIES_MODE is set, boot with a transparent IdP + an authorities
// engine so `@Skill({ authorities })` enforcement is exercised. Otherwise keep
// the long-standing public-mode server (no authorities) so all existing skills
// e2es behave exactly as before.
const authoritiesMode = process.env['AUTHORITIES_MODE'] === '1';

if (authoritiesMode) {
  const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
  const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

  @FrontMcp({
    info: { name: 'Demo E2E Skills (authorities)', version: '0.1.0' },
    apps: [SkillsE2EAuthoritiesApp],
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
    authorities: {
      claimsMapping: {
        roles: 'roles',
        permissions: 'permissions',
      },
      profiles: {
        admin: { roles: { any: ['admin', 'superadmin'] } },
      },
    },
    transport: {
      protocol: { json: true, legacy: true, strictSession: false },
    },
    skillsConfig: {
      enabled: true,
      auth: 'inherit',
      mcpResources: true,
    },
  })
  class AuthoritiesServer {}
  void AuthoritiesServer;
} else {
  @FrontMcp({
    info: { name: 'Demo E2E Skills', version: '0.1.0' },
    apps: [SkillsE2EApp],
    logging: { level: LogLevel.Info },
    http: { port },
    auth: {
      mode: 'public',
      sessionTtl: 3600,
      anonymousScopes: ['anonymous'],
    },
    transport: {
      protocol: { json: true, legacy: true, strictSession: false },
    },
    skillsConfig: {
      enabled: true,
      auth: 'public', // Single auth config for all HTTP endpoints
      mcpResources: true, // Enable SEP-2640 skill:// MCP resource templates
    },
  })
  class Server {}
  void Server;
}
