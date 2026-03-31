---
name: transparent-jwt-validation
reference: configure-auth-modes
level: basic
description: 'Validate externally-issued JWTs without managing token lifecycle on the server.'
tags: [config, auth, transparent, auth-modes, modes, jwt]
features:
  - "Using `mode: 'transparent'` to validate tokens from an external identity provider"
  - 'Setting `expectedAudience` to restrict which tokens are accepted'
  - 'The server fetches JWKS from `{provider}/.well-known/jwks.json` automatically'
---

# Transparent JWT Validation

Validate externally-issued JWTs without managing token lifecycle on the server.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_profile',
  description: 'Get the authenticated user profile',
  inputSchema: { userId: z.string() },
  outputSchema: { id: z.string(), email: z.string() },
})
class GetProfileTool extends ToolContext {
  async execute(input: { userId: string }) {
    return { id: input.userId, email: `${input.userId}@example.com` };
  }
}

@App({
  name: 'api',
  auth: {
    mode: 'transparent',
    provider: 'https://auth.example.com',
    expectedAudience: 'my-api',
    clientId: 'my-client-id',
  },
  tools: [GetProfileTool],
})
class ApiApp {}

@FrontMcp({
  info: { name: 'transparent-server', version: '1.0.0' },
  apps: [ApiApp],
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'transparent'` to validate tokens from an external identity provider
- Setting `expectedAudience` to restrict which tokens are accepted
- The server fetches JWKS from `{provider}/.well-known/jwks.json` automatically

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `configure-auth` for the full authentication setup guide
