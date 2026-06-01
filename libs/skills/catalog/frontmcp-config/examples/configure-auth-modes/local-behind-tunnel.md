---
name: local-behind-tunnel
reference: configure-auth-modes
level: intermediate
description: 'Expose a local-mode server through a tunnel or TLS proxy by aligning the token issuer with the public URL clients actually reach.'
tags: [config, auth, local, tunnel, proxy, issuer, auth-modes]
features:
  - 'Relying on request-host-derived OAuth discovery, which works behind a tunnel or under an http.entryPath without extra config'
  - 'Setting `local.issuer` to a full public HTTPS URL so the token `iss` matches what clients reach through the proxy'
  - 'Knowing `FRONTMCP_PUBLIC_HOST` overrides only the discovery host (scheme/port still come from the HTTP config or local.issuer)'
---

# Local Mode Behind a Tunnel

Expose a local-mode server through a tunnel or TLS proxy by aligning the token issuer with the public URL clients actually reach.

## Code

```typescript
// src/server.ts
// OAuth discovery (.well-known/*) is derived from the incoming request host at
// runtime and advertises /oauth/* at the root, so it works behind a tunnel or
// reverse proxy with no extra config. `local.issuer` only aligns the boot-time
// `iss` claim with the public HTTPS URL clients reach.
//
// `FRONTMCP_PUBLIC_HOST=mcp.example.com` would set only the discovery HOST
// (scheme stays http, port stays the HTTP port) — use `local.issuer` when you
// need a different scheme/port, as below.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'ping',
  description: 'Ping the server',
  inputSchema: {},
  outputSchema: { pong: z.boolean() },
})
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({
  name: 'tunneled-api',
  auth: {
    mode: 'local',
    local: {
      // Public URL exposed by the tunnel / TLS proxy.
      issuer: 'https://mcp.example.com',
    },
    tokenStorage: { sqlite: { path: './data/auth.sqlite' } },
  },
  tools: [PingTool],
})
class TunneledApi {}

@FrontMcp({
  info: { name: 'tunneled-server', version: '1.0.0' },
  apps: [TunneledApi],
})
class Server {}
```

## What This Demonstrates

- Relying on request-host-derived OAuth discovery, which works behind a tunnel or under an http.entryPath without extra config
- Setting `local.issuer` to a full public HTTPS URL so the token `iss` matches what clients reach through the proxy
- Knowing `FRONTMCP_PUBLIC_HOST` overrides only the discovery host (scheme/port still come from the HTTP config or local.issuer)

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `local-self-signed-tokens` for token persistence options
