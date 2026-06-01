---
name: local-self-signed-tokens
reference: configure-auth-modes
level: intermediate
description: 'Configure a local-mode server that signs its own HS256 JWTs and persists auth state across restarts with SQLite or Redis.'
tags: [config, auth, local, sqlite, redis, auth-modes, modes]
features:
  - "Using `mode: 'local'` so the server signs its own HS256 JWTs (symmetric `JWT_SECRET`, no key pair)"
  - 'Setting `local.issuer` and `expectedAudience` to control token claims'
  - 'Persisting authorization codes and refresh tokens with `tokenStorage: { sqlite: { path } }` so they survive restart'
  - 'Switching the same `tokenStorage` to `{ redis }` for multi-instance deployments'
  - 'Enabling `consent` for tool-authorization enforcement (token claim checked at call time; no picker UI yet)'
---

# Local Self-Signed Tokens

Configure a local-mode server that signs its own HS256 JWTs and persists auth state across restarts with SQLite or Redis.

## Code

```typescript
// src/server.ts
// Set a stable JWT_SECRET (e.g. `openssl rand -hex 32`) so HS256-signed
// tokens survive restart. If unset, a random per-process secret is used.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'manage_users',
  description: 'Manage user accounts',
  inputSchema: { action: z.enum(['list', 'create', 'delete']), userId: z.string().optional() },
  outputSchema: { success: z.boolean(), message: z.string() },
})
class ManageUsersTool extends ToolContext {
  async execute(input: { action: string; userId?: string }) {
    return { success: true, message: `Action ${input.action} completed` };
  }
}

@App({
  name: 'internal-api',
  auth: {
    mode: 'local',
    local: {
      issuer: 'https://mcp.internal.example.com',
    },
    expectedAudience: 'internal-api',
    // Single-node persistence (survives restart, no Redis required).
    // For multiple instances, swap for: { redis: { host: ..., port: 6379 } }
    tokenStorage: { sqlite: { path: './data/auth.sqlite' } },
    consent: { enabled: true },
  },
  tools: [ManageUsersTool],
})
class InternalApi {}

@FrontMcp({
  info: { name: 'local-auth-server', version: '1.0.0' },
  apps: [InternalApi],
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'local'` so the server signs its own HS256 JWTs (symmetric `JWT_SECRET`, no key pair)
- Setting `local.issuer` and `expectedAudience` to control token claims
- Persisting authorization codes and refresh tokens with `tokenStorage: { sqlite: { path } }` so they survive restart
- Switching the same `tokenStorage` to `{ redis }` for multi-instance deployments
- Enabling `consent` for tool-authorization enforcement (token claim checked at call time; no picker UI yet)

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `configure-session` for transport/session storage configuration
