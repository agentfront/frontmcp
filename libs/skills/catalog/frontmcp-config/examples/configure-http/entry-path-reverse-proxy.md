---
name: entry-path-reverse-proxy
reference: configure-http
level: intermediate
description: 'Mount the MCP server under a URL prefix for reverse proxy or multi-service setups.'
tags: [config, nx, http, entry, path, reverse]
features:
  - 'Using `entryPath` to mount the server under a URL prefix (no trailing slash)'
  - 'All MCP endpoints are prefixed: `/api/mcp/sse`, `/api/mcp/`, etc.'
  - 'Using a dynamic CORS origin function to allow wildcard subdomains'
  - 'Suitable for running behind nginx, Caddy, or other reverse proxies'
---

# Entry Path Prefix Behind a Reverse Proxy

Mount the MCP server under a URL prefix for reverse proxy or multi-service setups.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'health_check',
  description: 'Check service health',
  inputSchema: {},
  outputSchema: { status: z.string() },
})
class HealthCheckTool extends ToolContext {
  async execute() {
    return { status: 'ok' };
  }
}

@App({
  name: 'api',
  tools: [HealthCheckTool],
})
class ApiApp {}

@FrontMcp({
  info: { name: 'proxy-server', version: '1.0.0' },
  apps: [ApiApp],
  http: {
    port: 3001,
    entryPath: '/api/mcp', // no trailing slash
    cors: {
      origin: (origin: string) => {
        // allow any *.myapp.com subdomain
        return origin.endsWith('.myapp.com');
      },
      credentials: true,
    },
  },
})
class Server {}
// Endpoints become: /api/mcp/sse, /api/mcp/, etc.
```

## What This Demonstrates

- Using `entryPath` to mount the server under a URL prefix (no trailing slash)
- All MCP endpoints are prefixed: `/api/mcp/sse`, `/api/mcp/`, etc.
- Using a dynamic CORS origin function to allow wildcard subdomains
- Suitable for running behind nginx, Caddy, or other reverse proxies

## Related

- See `configure-http` for the full HTTP configuration reference
- See `configure-transport` for protocol options behind a proxy
