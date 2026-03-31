---
name: authenticated-adapter-with-polling
reference: official-adapters
level: intermediate
description: 'Demonstrates configuring authentication (API key and bearer token) and automatic spec polling for OpenAPI adapters.'
tags: [development, auth, openapi, security, adapters, authenticated]
features:
  - 'Three authentication methods: `staticAuth.apiKey`, `staticAuth.jwt`, and dynamic `securityResolver`'
  - 'Using `securityResolver` for per-request dynamic authentication based on the calling context'
  - 'Enabling `polling` to automatically refresh tool definitions when the upstream spec changes'
  - 'Loading secrets from environment variables instead of hardcoding them'
  - 'Each adapter has a unique `name` to avoid tool naming collisions'
---

# Authenticated Adapter with Spec Polling

Demonstrates configuring authentication (API key and bearer token) and automatic spec polling for OpenAPI adapters.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'integrations',
  adapters: [
    // API key authentication via staticAuth
    OpenapiAdapter.init({
      name: 'analytics-api',
      url: 'https://api.analytics.example.com/openapi.json',
      baseUrl: 'https://api.analytics.example.com',
      staticAuth: {
        apiKey: process.env.ANALYTICS_API_KEY!,
      },
    }),

    // Bearer token authentication via staticAuth
    OpenapiAdapter.init({
      name: 'crm-api',
      url: 'https://crm.example.com/openapi.json',
      baseUrl: 'https://crm.example.com',
      staticAuth: {
        jwt: process.env.CRM_API_TOKEN!,
      },
    }),

    // Dynamic auth with spec polling
    OpenapiAdapter.init({
      name: 'evolving-api',
      url: 'https://api.example.com/openapi.json',
      baseUrl: 'https://api.example.com',
      securityResolver: (tool, ctx) => {
        return { jwt: ctx.authInfo?.token };
      },
      polling: {
        intervalMs: 300000, // Re-fetch spec every 5 minutes
      },
    }),
  ],
})
class IntegrationsApp {}

@FrontMcp({
  info: { name: 'integration-hub', version: '1.0.0' },
  apps: [IntegrationsApp],
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- Three authentication methods: `staticAuth.apiKey`, `staticAuth.jwt`, and dynamic `securityResolver`
- Using `securityResolver` for per-request dynamic authentication based on the calling context
- Enabling `polling` to automatically refresh tool definitions when the upstream spec changes
- Loading secrets from environment variables instead of hardcoding them
- Each adapter has a unique `name` to avoid tool naming collisions

## Related

- See `official-adapters` for inline specs, multiple adapter registration, and troubleshooting
- See `decorators-guide` for the full `@App` and `@FrontMcp` field reference
