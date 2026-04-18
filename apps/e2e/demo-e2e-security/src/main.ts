/**
 * Security smoke-test server.
 *
 * Exposes a deliberately diverse set of gated entry points so the e2e suite
 * can probe every auth boundary:
 *  - a public tool (RBAC bypass — any authenticated caller)
 *  - an admin-only tool (RBAC role check)
 *  - a tenant-scoped tool (ABAC attribute check with input binding)
 *  - an admin-only tool with `execution.taskSupport: 'optional'` so task-
 *    augmented `tools/call` takes the same synchronous auth path
 *
 * Auth mode is `transparent` with `allowAnonymous: false` + a mock OAuth IdP
 * provided by `@frontmcp/testing`. Tokens are minted with arbitrary claims
 * per test. Tasks are enabled (memory store — the suite doesn't need
 * cross-process persistence).
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { SecurityApp } from './apps/security';

const DEFAULT_PORT = 3150;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
// Clamp to a valid TCP port range — out-of-range values would otherwise fail
// opaquely at bind time. Anything invalid falls back to DEFAULT_PORT.
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://mock-idp.local';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Security', version: '0.1.0' },
  apps: [SecurityApp],
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
      tenantId: 'tenantId',
    },
    profiles: {
      admin: { roles: { any: ['admin'] } },
      // Attribute-based: input.tenantId must match the caller's JWT claim.
      matchTenant: {
        attributes: {
          conditions: [{ path: 'claims.tenantId', op: 'eq', value: { fromInput: 'tenantId' } }],
        },
      },
    },
  },
  tasks: {
    enabled: true,
    defaultTtlMs: 60_000,
    maxTtlMs: 300_000,
    defaultPollIntervalMs: 200,
  },
  // Enable the server→client elicit path so the `elicit-secret` tool can
  // issue `elicitation/create` requests. The cross-session test then tries
  // to spoof a peer's pending elicit and must fail.
  elicitation: { enabled: true },
})
export default class Server {}
