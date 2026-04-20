---
name: public-mode-setup
reference: configure-auth
level: basic
description: 'Set up a FrontMCP server with public (unauthenticated) access and anonymous scopes.'
tags: [config, auth, session, public, mode, setup]
features:
  - "Configuring `mode: 'public'` for unauthenticated access"
  - 'Setting `sessionTtl` to control anonymous session lifetime'
  - 'Granting `anonymousScopes` so tools can check scope-based permissions even without auth'
---

# Public Auth Mode Setup

Set up a FrontMCP server with public (unauthenticated) access and anonymous scopes.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'search',
  description: 'Search public records',
  inputSchema: { query: z.string() },
  outputSchema: { results: z.array(z.string()) },
})
class SearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return { results: [`Result for: ${input.query}`] };
  }
}

@App({
  name: 'public-api',
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['read'],
  },
  tools: [SearchTool],
})
class PublicApi {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [PublicApi],
})
class Server {}
```

## What This Demonstrates

- Configuring `mode: 'public'` for unauthenticated access
- Setting `sessionTtl` to control anonymous session lifetime
- Granting `anonymousScopes` so tools can check scope-based permissions even without auth

## Related

- See `configure-auth` for all four auth modes
- See `configure-auth-modes` for a detailed comparison of modes
