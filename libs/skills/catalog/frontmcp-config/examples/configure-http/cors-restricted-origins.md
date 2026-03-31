---
name: cors-restricted-origins
reference: configure-http
level: basic
description: 'Configure CORS to allow only specific frontend origins with credentials.'
tags: [config, browser, http, cors, restricted, origins]
features:
  - 'Restricting CORS to explicit origins instead of the permissive default'
  - 'Enabling `credentials: true` with specific origins (required -- browsers reject `*` with credentials)'
  - 'Setting `maxAge` to reduce preflight request overhead'
  - 'Reading port from an environment variable with a fallback'
---

# CORS with Restricted Origins

Configure CORS to allow only specific frontend origins with credentials.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'my-app' })
class MyApp {}

@FrontMcp({
  info: { name: 'cors-server', version: '1.0.0' },
  apps: [MyApp],
  http: {
    port: Number(process.env['PORT']) || 3001,
    cors: {
      origin: ['https://myapp.com', 'https://staging.myapp.com'],
      credentials: true,
      maxAge: 86400, // cache preflight for 24 hours
    },
  },
})
class Server {}
```

## What This Demonstrates

- Restricting CORS to explicit origins instead of the permissive default
- Enabling `credentials: true` with specific origins (required -- browsers reject `*` with credentials)
- Setting `maxAge` to reduce preflight request overhead
- Reading port from an environment variable with a fallback

## Related

- See `configure-http` for the full HTTP configuration reference
- See `configure-throttle` for rate limiting and IP filtering
