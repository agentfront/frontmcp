---
name: local-self-signed-tokens
reference: configure-auth-modes
level: intermediate
description: 'Configure a server that signs its own JWT tokens with consent and incremental auth enabled.'
tags: [config, auth, redis, local, auth-modes, modes]
features:
  - "Using `mode: 'local'` so the server signs its own JWTs"
  - 'Setting `local.issuer` and `local.audience` to control token claims'
  - 'Enabling `consent` for explicit user authorization flow'
  - 'Enabling `incrementalAuth` to request additional scopes progressively'
  - 'Using Redis for token storage in production'
---

# Local Self-Signed Tokens

Configure a server that signs its own JWT tokens with consent and incremental auth enabled.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
      issuer: 'my-internal-server',
      audience: 'internal-api',
    },
    tokenStorage: 'redis',
    consent: { enabled: true },
    incrementalAuth: { enabled: true },
  },
  tools: [ManageUsersTool],
})
class InternalApi {}

@FrontMcp({
  info: { name: 'local-auth-server', version: '1.0.0' },
  apps: [InternalApi],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: 6379,
  },
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'local'` so the server signs its own JWTs
- Setting `local.issuer` and `local.audience` to control token claims
- Enabling `consent` for explicit user authorization flow
- Enabling `incrementalAuth` to request additional scopes progressively
- Using Redis for token storage in production

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `configure-session` for session storage configuration
