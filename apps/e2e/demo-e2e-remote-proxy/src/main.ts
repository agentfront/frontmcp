/**
 * Remote OAuth Proxy E2E Server
 *
 * Demonstrates `mode: 'remote'`: FrontMCP runs a local OAuth 2.1 server that
 * proxies user authentication to a SINGLE mandatory upstream IdP. The contract:
 *
 * - `/oauth/authorize` redirects STRAIGHT to the upstream IdP (no in-tree login
 *   page, no provider-selection page).
 * - The upstream IdP returns to `/oauth/provider/{id}/callback`; FrontMCP
 *   exchanges the code, stores the upstream tokens (encrypted), derives the
 *   session identity from the upstream user, and mints an HS256 FrontMCP token.
 * - Tools read the upstream token via `this.orchestration.getToken('upstream')`.
 *
 * The upstream issuer + client id are injected via environment variables so the
 * E2E can point them at a per-test `MockOAuthServer`. The provider id is pinned
 * to `'upstream'` via `providerConfig.id` so the tool can read it by a stable id.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ProfileApp } from './apps/profile';

const parsedPort = parseInt(process.env['PORT'] ?? '3133', 10);
const port = Number.isNaN(parsedPort) ? 3133 : parsedPort;

// The upstream IdP base URL (a MockOAuthServer issuer in tests). Falls back to a
// placeholder so the module still imports without the env set.
const upstreamIssuer = process.env['UPSTREAM_ISSUER'] ?? 'https://idp.example.com';
const upstreamClientId = process.env['UPSTREAM_CLIENT_ID'] ?? 'remote-proxy-client';
const upstreamClientSecret = process.env['UPSTREAM_CLIENT_SECRET'];

@FrontMcp({
  info: { name: 'Demo Remote OAuth Proxy', version: '0.1.0' },
  apps: [ProfileApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'remote',
    provider: upstreamIssuer,
    clientId: upstreamClientId,
    clientSecret: upstreamClientSecret,
    scopes: ['openid', 'profile', 'email'],
    tokenStorage: 'memory',
    providerConfig: {
      // Pin a stable upstream provider id so tools can read its token by id.
      id: 'upstream',
      // The MockOAuthServer serves /oauth/authorize + /oauth/token + /userinfo,
      // which differ from FrontMCP's default OIDC-path derivation (/authorize,
      // /token, /userinfo). Override them explicitly — this also exercises the
      // `providerConfig` endpoint-override path for non-standard IdPs.
      authEndpoint: `${upstreamIssuer}/oauth/authorize`,
      tokenEndpoint: `${upstreamIssuer}/oauth/token`,
      userInfoEndpoint: `${upstreamIssuer}/userinfo`,
    },
  },
  transport: {
    sessionMode: 'stateful',
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: false,
      strictSession: false,
    },
  },
})
export default class RemoteProxyServer {}
