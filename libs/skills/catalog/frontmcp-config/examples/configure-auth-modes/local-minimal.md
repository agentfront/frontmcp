---
name: local-minimal
reference: configure-auth-modes
level: basic
description: 'Stand up the built-in local OAuth 2.1 server with the minimum configuration: HS256 signing via JWT_SECRET and in-memory token storage.'
tags: [config, auth, local, hs256, auth-modes, modes]
features:
  - "Using `mode: 'local'` with no other auth options to run the built-in OAuth 2.1 server"
  - 'Relying on `JWT_SECRET` for HS256 token signing (symmetric secret, no key pair)'
  - 'Accepting the default in-memory `tokenStorage` for local development (state is lost on restart)'
---

# Minimal Local Mode

Stand up the built-in local OAuth 2.1 server with the minimum configuration: HS256 signing via JWT_SECRET and in-memory token storage.

## Code

```typescript
// src/server.ts
// Set JWT_SECRET in the environment, e.g. `export JWT_SECRET=$(openssl rand -hex 32)`.
// If unset, FrontMCP uses a random per-process secret and tokens are invalidated on restart.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'whoami',
  description: 'Return the authenticated subject',
  inputSchema: {},
  outputSchema: { sub: z.string() },
})
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: String(this.auth.claims['sub'] ?? 'unknown') };
  }
}

@App({
  name: 'internal-api',
  auth: {
    mode: 'local',
  },
  tools: [WhoAmITool],
})
class InternalApi {}

@FrontMcp({
  info: { name: 'local-minimal', version: '1.0.0' },
  apps: [InternalApi],
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'local'` with no other auth options to run the built-in OAuth 2.1 server
- Relying on `JWT_SECRET` for HS256 token signing (symmetric secret, no key pair)
- Accepting the default in-memory `tokenStorage` for local development (state is lost on restart)

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `local-self-signed-tokens` for persisting tokens with SQLite or Redis
