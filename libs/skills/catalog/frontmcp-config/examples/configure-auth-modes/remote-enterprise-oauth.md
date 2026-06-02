---
name: remote-enterprise-oauth
reference: configure-auth-modes
level: advanced
description: 'Proxy authentication to one mandatory upstream IdP, mint a FrontMCP session, and read the upstream token in tools.'
tags: [config, oauth, auth, redis, remote, auth-modes]
features:
  - "Using `mode: 'remote'` to proxy authentication to a single mandatory upstream IdP"
  - 'Loading `clientId` and `clientSecret` from environment variables (never hardcoded)'
  - 'Configuring Redis-backed token storage for production persistence'
  - '`GET /oauth/authorize` redirects straight to the upstream IdP (no in-tree login page)'
  - 'Session identity (sub/email/name) is derived from the upstream user'
  - 'Tools read the upstream token via `this.orchestration.getToken(providerId)`'
---

# Remote Enterprise OAuth

Proxy authentication to one mandatory upstream IdP, mint a FrontMCP session, and read the upstream token in tools.

FrontMCP runs a local OAuth 2.1 server: `GET /oauth/authorize` redirects straight
to the IdP (no FrontMCP login page), exchanges the returned code, stores the
upstream tokens encrypted in Redis, derives the session identity from the upstream
user, and mints its own HS256 session token.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'query_data',
  description: 'Query the enterprise data warehouse on behalf of the user',
  inputSchema: { sql: z.string() },
  outputSchema: { rows: z.array(z.record(z.string(), z.unknown())), rowCount: z.number() },
})
class QueryDataTool extends ToolContext {
  async execute(input: { sql: string }) {
    // The upstream IdP token is stored server-side (encrypted) and read by id.
    // 'enterprise-idp' is providerConfig.id below (defaults to the provider host).
    const token = await this.orchestration.tryGetToken('enterprise-idp');
    if (!token) {
      // Once the upstream token expires the user must re-authenticate
      // (upstream auto-refresh is not yet wired).
      throw new Error('Upstream token unavailable — please re-authenticate');
    }
    // A real tool would call the warehouse API with `token`.
    return { rows: [{ id: 1, name: 'example' }], rowCount: 1 };
  }
}

@FrontMcp({
  info: { name: 'enterprise-server', version: '1.0.0' },
  apps: [{ name: 'enterprise-api', tools: [QueryDataTool] }],
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env['OAUTH_CLIENT_ID']!, // pre-registered (DCR not yet wired)
    clientSecret: process.env['OAUTH_CLIENT_SECRET'],
    scopes: ['openid', 'profile', 'email'],
    tokenStorage: {
      redis: {
        host: process.env['REDIS_HOST'] ?? 'redis.internal',
        port: Number(process.env['REDIS_PORT'] ?? 6379),
        password: process.env['REDIS_PASSWORD'],
      },
    },
    // Pin a stable provider id (and override endpoints for non-standard IdPs).
    providerConfig: { id: 'enterprise-idp' },
  },
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'remote'` to proxy authentication to a single mandatory upstream IdP
- Loading `clientId` and `clientSecret` from environment variables (never hardcoded)
- Configuring Redis-backed token storage for production persistence
- `GET /oauth/authorize` redirects straight to the upstream IdP (no in-tree login page)
- Session identity (sub/email/name) is derived from the upstream user
- Tools read the upstream token via `this.orchestration.getToken(providerId)`

## Not Yet Wired

- **Dynamic Client Registration** (`providerConfig.dcrEnabled`): a pre-registered `clientId` is required.
- **Upstream token auto-refresh**: when the upstream access token expires the user must re-authenticate (FrontMCP's own session token still refreshes via the `refresh_token` grant).

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `setup-redis` for Redis provisioning details
