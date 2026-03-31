---
name: multi-app-auth
reference: configure-auth
level: advanced
description: 'Configure a single FrontMCP server with multiple apps, each using a different auth mode -- public for open endpoints and remote for admin endpoints.'
tags: [config, auth, security, multi-app, remote, multi]
features:
  - 'Hosting multiple `@App` instances on a single FrontMCP server with different auth modes'
  - 'Using `public` mode for open-access endpoints alongside `remote` mode for admin-only endpoints'
  - 'Isolating tools per app so each security posture governs only its own tools'
---

# Multi-App Auth with Different Security Postures

Configure a single FrontMCP server with multiple apps, each using a different auth mode -- public for open endpoints and remote for admin endpoints.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'public_search',
  description: 'Search public records',
  inputSchema: { query: z.string() },
  outputSchema: { results: z.array(z.string()) },
})
class PublicSearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return { results: [`Public result: ${input.query}`] };
  }
}

@Tool({
  name: 'admin_config',
  description: 'Modify server configuration (admin only)',
  inputSchema: { key: z.string(), value: z.string() },
  outputSchema: { updated: z.boolean() },
})
class AdminConfigTool extends ToolContext {
  async execute(input: { key: string; value: string }) {
    // Only authenticated admins can reach this tool
    return { updated: true };
  }
}

@App({
  name: 'public-api',
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['read'],
  },
  tools: [PublicSearchTool],
})
class PublicApi {}

@App({
  name: 'admin-api',
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env['ADMIN_OAUTH_CLIENT_ID'] ?? 'admin-client',
  },
  tools: [AdminConfigTool],
})
class AdminApi {}

@FrontMcp({
  info: { name: 'multi-app-server', version: '1.0.0' },
  apps: [PublicApi, AdminApi],
})
class Server {}
```

## What This Demonstrates

- Hosting multiple `@App` instances on a single FrontMCP server with different auth modes
- Using `public` mode for open-access endpoints alongside `remote` mode for admin-only endpoints
- Isolating tools per app so each security posture governs only its own tools

## Related

- See `configure-auth` for individual auth mode configuration details
- See `configure-auth-modes` for a feature comparison table across all modes
