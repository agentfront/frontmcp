import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AuthoritiesApp } from './apps/authorities';

const port = parseInt(process.env['PORT'] ?? '3140', 10);
const authMode = process.env['AUTH_MODE'] ?? 'transparent';
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

const authConfig =
  authMode === 'public'
    ? { mode: 'public' as const }
    : {
        mode: 'transparent' as const,
        provider: idpProviderUrl,
        providerConfig: { name: 'mock-idp', dcrEnabled: false },
        expectedAudience,
        requiredScopes: [],
        allowAnonymous: false,
      };

@FrontMcp({
  info: { name: 'Demo E2E Authorities', version: '0.1.0' },
  apps: [AuthoritiesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: authConfig,
  authorities: {
    claimsMapping: {
      roles: 'roles',
      permissions: 'permissions',
      tenantId: 'tenantId',
    },
    profiles: {
      admin: { roles: { any: ['admin', 'superadmin'] } },
      authenticated: {
        attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] },
      },
      editor: { permissions: { any: ['content:write', 'content:publish'] } },
      matchTenant: {
        attributes: {
          conditions: [
            { path: 'claims.tenantId', op: 'eq', value: { fromInput: 'tenantId' } },
          ],
        },
      },
    },
  },
})
export default class Server {}
